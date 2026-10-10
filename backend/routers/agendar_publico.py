"""Página pública de agendamento: /agendar/{slug} (empresa) e /agendar/{slug}/{profissional}.

Sem login. O slug resolve a empresa pelo índice `controle.agenda_index`, como o site da imobiliária.
O cliente escolhe serviço, profissional (ou "qualquer um"), dia e horário, e recebe um link próprio
para ver ou cancelar a reserva.
"""

from __future__ import annotations

import base64
import re
import time
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from lib.agenda_online import agora_local, config, horarios_livres, minutos, validar_data
from lib.db import controle, db, definir_empresa
from lib.planos import recurso_liberado
from models.common import now_utc, utc_aware

router = APIRouter(prefix="/publico/agenda", tags=["publico"])
_SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")


async def _entrar(slug: str) -> dict:
    slug = (slug or "").lower()
    if not _SLUG.match(slug):
        raise HTTPException(404, "Agenda não encontrada")
    indice = await controle.agenda_index.find_one({"_id": slug})
    if not indice:
        raise HTTPException(404, "Agenda não encontrada")
    empresa = await controle.empresas.find_one({"db_name": indice["db_name"]})
    if not empresa or not empresa.get("ativo", True):
        raise HTTPException(404, "Agenda não encontrada")
    from lib.assinatura import bloqueio

    if bloqueio(empresa.get("assinatura")):
        raise HTTPException(404, "Agenda temporariamente indisponível")
    definir_empresa(indice["db_name"])
    cfg = await config()
    if not cfg.get("ativo") or not await recurso_liberado("agenda_online"):
        raise HTTPException(404, "Agenda online desligada")
    return {"empresa": empresa, "cfg": cfg}


def _prof_publico(u: dict, slug: str) -> dict:
    return {"id": u["id"], "nome": u["nome"], "slug": u.get("agenda_slug"), "especialidade": u.get("especialidade"),
            "registro": u.get("registro"), "foto_url": f"/api/publico/agenda/{slug}/foto/{u['id']}?v={u.get('foto_v', 0)}" if u.get("tem_foto") else None,
            "unidade_ids": u.get("unidade_ids") or []}


async def _profissionais(servico: dict | None = None) -> list[dict]:
    docs = [u for u in await db.usuarios.find({"ativo": {"$ne": False}, "papel": {"$ne": "sysadmin"}}).to_list(300)
            if u.get("atende") and u.get("agenda_online", True)]
    if servico and servico.get("profissionais"):
        docs = [u for u in docs if u["id"] in servico["profissionais"]]
    return sorted(docs, key=lambda u: u["nome"])


@router.get("/{slug}")
async def pagina(slug: str):
    ctx = await _entrar(slug)
    cfg, empresa = ctx["cfg"], ctx["empresa"]
    marca = await db.configuracoes.find_one({"id": "singleton"}, {"cor_primaria": 1, "logo_base64": 1, "nome_software": 1}) or {}
    servicos = [s for s in await db.servicos.find({"ativo": {"$ne": False}, "online": {"$ne": False}}).to_list(300)]
    servicos.sort(key=lambda s: (s.get("categoria") or "", s["nome"]))
    unidades = await db.unidades.find({"ativa": {"$ne": False}}).to_list(50)
    from lib.segmentos import info, segmento_de

    seg = info(segmento_de(empresa))
    return {
        "empresa": empresa["nome"], "cor": marca.get("cor_primaria") or "#4a03a2",
        "logo_url": f"/api/publico/agenda/{slug}/logo" if marca.get("logo_base64") else None,
        "mensagem": cfg.get("mensagem") or "", "pedir_email": bool(cfg.get("pedir_email")), "janela_dias": cfg["janela_dias"],
        "termos": seg["termos"], "segmento": seg["chave"],
        "servicos": [{"id": s["id"], "nome": s["nome"], "duracao_min": s["duracao_min"], "preco": s["preco"], "categoria": s.get("categoria"),
                      "descricao": s.get("descricao"), "profissionais": s.get("profissionais") or []} for s in servicos],
        "profissionais": [_prof_publico(u, slug) for u in await _profissionais()],
        "unidades": [{"id": u["id"], "nome": u["nome"], "endereco": u.get("endereco"), "cidade": u.get("cidade")} for u in unidades],
    }


@router.get("/{slug}/horarios")
async def horarios(slug: str, servico_id: str, data: str, profissional_id: str | None = None):
    ctx = await _entrar(slug)
    cfg = ctx["cfg"]
    dia = validar_data(data)
    hoje = agora_local().date()
    if dia < hoje or dia > hoje + timedelta(days=int(cfg["janela_dias"])):
        return {"horarios": []}
    servico = await db.servicos.find_one({"id": servico_id, "ativo": {"$ne": False}, "online": {"$ne": False}})
    if not servico:
        raise HTTPException(404, "Serviço indisponível")
    profs = await _profissionais(servico)
    if profissional_id:
        profs = [u for u in profs if u["id"] == profissional_id]
    por_hora: dict[str, list[str]] = {}
    for u in profs:
        for h in await horarios_livres(u, dia, int(servico["duracao_min"]), cfg):
            por_hora.setdefault(h, []).append(u["id"])
    return {"horarios": [{"hora": h, "profissionais": ids} for h, ids in sorted(por_hora.items())]}


class Reserva(BaseModel):
    servico_id: str
    profissional_id: str | None = None  # vazio = qualquer profissional livre
    data: str
    inicio: str
    nome: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=10, max_length=20)
    email: str | None = Field(default=None, max_length=120)
    observacao: str | None = Field(default=None, max_length=500)
    site: str | None = None  # isca para robôs


_TENTATIVAS: dict[str, list[float]] = {}


@router.post("/{slug}/reservar", status_code=201)
async def reservar(slug: str, input: Reserva, request: Request):
    ctx = await _entrar(slug)
    if input.site:
        raise HTTPException(400, "Pedido inválido")
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    agora = time.monotonic()
    recentes = [t for t in _TENTATIVAS.get(f"{slug}:{ip}", []) if agora - t < 600]
    if len(recentes) >= 6:
        raise HTTPException(429, "Muitas reservas seguidas. Tente de novo em alguns minutos.")
    _TENTATIVAS[f"{slug}:{ip}"] = [*recentes, agora]
    from lib.assinatura import so_digitos
    from routers.atendimentos import _cliente, criar_agendamento

    if not 10 <= len(so_digitos(input.telefone)) <= 11:
        raise HTTPException(422, "Informe o WhatsApp com DDD.")
    servico = await db.servicos.find_one({"id": input.servico_id, "ativo": {"$ne": False}, "online": {"$ne": False}})
    if not servico:
        raise HTTPException(404, "Serviço indisponível")
    dia = validar_data(input.data)
    hoje = agora_local().date()
    if dia < hoje or dia > hoje + timedelta(days=int(ctx["cfg"]["janela_dias"])):
        raise HTTPException(422, "Data fora do período de agendamento")
    profs = await _profissionais(servico)
    if input.profissional_id:
        profs = [u for u in profs if u["id"] == input.profissional_id]
    if not profs:
        raise HTTPException(404, "Profissional indisponível")
    segmento = (ctx["empresa"].get("segmento") or "imobiliaria")
    cliente = await _cliente(None, input.nome, input.telefone, "paciente" if segmento in ("terapia", "odontologia") else "cliente", publico=True)
    if input.email and not cliente.get("email") and cliente.get("created_at") and (now_utc() - utc_aware(cliente["created_at"])).total_seconds() < 60:
        await db.pessoas.update_one({"id": cliente["id"]}, {"$set": {"email": input.email.strip().lower()}})
    ultimo_erro = None
    for prof in profs:
        if input.inicio not in await horarios_livres(prof, dia, int(servico["duracao_min"]), ctx["cfg"]):
            continue
        try:
            a = await criar_agendamento(prof=prof, servicos=[servico], dia=dia, inicio=input.inicio, cliente=cliente,
                                        unidade_id=None, observacoes=input.observacao, status="agendado", origem="online",
                                        criado_por="Agenda online", cliente_nome=input.nome.strip()[:120])
        except HTTPException as e:
            ultimo_erro = e
            continue
        return {"token": a["token_cliente"], "data": a["data"], "inicio": a["inicio"], "fim": a["fim"],
                "profissional": prof["nome"], "servico": servico["nome"], "preco": servico["preco"]}
    raise ultimo_erro or HTTPException(409, "Esse horário acabou de ser ocupado. Escolha outro.")


@router.get("/{slug}/reserva/{token}")
async def ver_reserva(slug: str, token: str):
    ctx = await _entrar(slug)
    a = await db.agendamentos.find_one({"token_cliente": token})
    if not a or len(token) < 16:
        raise HTTPException(404, "Reserva não encontrada")
    inicio = agora_local().replace(tzinfo=None)
    from datetime import datetime

    quando = datetime.fromisoformat(f"{a['data']}T{a['inicio']}")
    pode_cancelar = a["status"] in ("agendado", "confirmado") and quando - inicio >= timedelta(hours=int(ctx["cfg"]["cancelamento_horas"]))
    return {"status": a["status"], "data": a["data"], "inicio": a["inicio"], "fim": a["fim"], "profissional": a["profissional_nome"],
            "servicos": [s["nome"] for s in a["servicos"]], "cliente": a["cliente_nome"], "empresa": ctx["empresa"]["nome"],
            "pode_cancelar": pode_cancelar, "cancelamento_horas": ctx["cfg"]["cancelamento_horas"]}


@router.post("/{slug}/reserva/{token}/cancelar")
async def cancelar_reserva(slug: str, token: str):
    info = await ver_reserva(slug, token)
    if not info["pode_cancelar"]:
        raise HTTPException(409, f"Cancelamento pelo link só até {info['cancelamento_horas']} h antes. Fale com a equipe.")
    a = await db.agendamentos.find_one({"token_cliente": token})
    from lib.agenda_online import destravar

    await destravar(a)
    await db.agendamentos.update_one({"id": a["id"]}, {"$set": {"status": "cancelado", "cancelado_pelo_cliente": True, "updated_at": now_utc()}})
    return {"ok": True}


@router.get("/{slug}/logo")
async def logo(slug: str):
    await _entrar(slug)
    from routers.match import logo_empresa

    return await logo_empresa()


@router.get("/{slug}/foto/{usuario_id}")
async def foto(slug: str, usuario_id: str):
    await _entrar(slug)
    u = await db.usuarios.find_one({"id": usuario_id}, {"atende": 1})
    f = await db.fotos_usuario.find_one({"_id": usuario_id}) if u and u.get("atende") else None
    if not f or not f.get("base64"):
        raise HTTPException(404, "Sem foto")
    return Response(base64.b64decode(f["base64"]), media_type=f.get("mime") or "image/jpeg",
                    headers={"Cache-Control": "public, max-age=86400"})
