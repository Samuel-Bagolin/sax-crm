"""Agenda de Visitas — calendário semanal, aviso do dia anterior e lembrete por e-mail.

RBAC: o corretor vê/agenda apenas as próprias visitas (predicado de query + L3 na escrita);
o admin vê todas. O lembrete do dia anterior é disparado pelo cron da plataforma.
"""

import hmac
import logging
import os
from datetime import datetime, timedelta
from html import escape
from typing import List
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query

from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.db import controle, db, definir_empresa, empresa_atual_db
from lib.integrity import reference, audit
from lib.validation import patch_data
from lib.email import send_email
from models.agenda import AvisoVisitas, LembreteResultado, Visita, VisitaCreate, VisitaUpdate
from models.common import now_utc, utc_aware

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/visitas", tags=["agenda"])
cron_router = APIRouter(prefix="/cron", tags=["cron"])


def _tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("APP_TZ", "America/Sao_Paulo"))


def _hoje() -> str:
    return datetime.now(_tz()).strftime("%Y-%m-%d")


def _amanha() -> str:
    return (datetime.now(_tz()) + timedelta(days=1)).strftime("%Y-%m-%d")


def to_visita(doc: dict) -> Visita:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    data["lembrete_enviado_em"] = utc_aware(data.get("lembrete_enviado_em"))
    data["lembrete_cliente_em"] = utc_aware(data.get("lembrete_cliente_em"))
    return Visita(**data)


@router.get("", response_model=List[Visita])
async def list_visitas(
    inicio: str | None = Query(None, description="YYYY-MM-DD (inclusive)"),
    fim: str | None = Query(None, description="YYYY-MM-DD (inclusive)"),
    corretor_id: str | None = Query(None, description="gestor: agenda de um corretor"),
    lead_id: str | None = Query(None, description="visitas de um negócio"),
    principal: Principal = Depends(require("visita:read")),
):
    filtro: dict = dict(filtro_do_principal(principal, "visitas"))
    if corretor_id and principal.is_admin:
        filtro["corretor_id"] = corretor_id
    if lead_id:
        negocio = await db.leads.find_one({"id": lead_id})
        if not negocio:
            raise HTTPException(status_code=404, detail="Negócio não encontrado")
        authorize(principal, "lead:read", negocio)
        filtro.pop("corretor_id", None)
        filtro["lead_id"] = lead_id
    if inicio or fim:
        faixa: dict = {}
        if inicio:
            faixa["$gte"] = inicio
        if fim:
            faixa["$lte"] = fim
        filtro["data"] = faixa
    docs = await db.visitas.find(filtro).sort([("data", 1), ("hora", 1)]).to_list(None)
    return [to_visita(d) for d in docs]


@router.get("/aviso", response_model=AvisoVisitas)
async def aviso(principal: Principal = Depends(require("visita:read"))):
    """Aviso no topo do sistema: visitas de hoje e de amanhã (datas ancoradas no servidor)."""
    base = dict(filtro_do_principal(principal, "visitas"))
    hoje, amanha = _hoje(), _amanha()
    docs = await db.visitas.find(
        {**base, "status": "agendada", "data": {"$in": [hoje, amanha]}}
    ).sort([("data", 1), ("hora", 1)]).to_list(None)
    de_hoje = [to_visita(d) for d in docs if d["data"] == hoje]
    de_amanha = [to_visita(d) for d in docs if d["data"] == amanha]
    return AvisoVisitas(
        amanha=amanha,
        total_amanha=len(de_amanha),
        total_hoje=len(de_hoje),
        visitas_amanha=de_amanha,
        visitas_hoje=de_hoje,
    )


@router.post("", response_model=Visita, status_code=201)
async def create_visita(input: VisitaCreate, background: BackgroundTasks, principal: Principal = Depends(require("visita:write"))):
    data = input.model_dump()
    # Dono vem do principal: um corretor não agenda em nome de outro.
    if not principal.is_admin:
        data["corretor_id"] = principal.pessoa_id
    if not data.get("corretor_id") and input.lead_id:
        lead = await db.leads.find_one({"id": input.lead_id})
        if lead:
            data["corretor_id"] = lead.get("corretor_id")
    if not data.get("cliente_id") and input.lead_id:
        lead = await db.leads.find_one({"id": input.lead_id})
        if lead:
            data["cliente_id"] = lead.get("cliente_id")
    await _validar_visita(data, principal)
    visita = Visita(**data)
    await db.visitas.insert_one(visita.model_dump())
    if visita.lead_id:
        from lib.crm import registrar
        await registrar(visita.lead_id, "visita", f"Visita agendada para {visita.data[8:10]}/{visita.data[5:7]} às {visita.hora}: {visita.titulo}", principal)
    from routers.google import agendar, sincronizar_visita
    agendar(background, sincronizar_visita, visita.id)
    return visita


@router.patch("/{visita_id}", response_model=Visita)
async def update_visita(
    visita_id: str, input: VisitaUpdate, background: BackgroundTasks, principal: Principal = Depends(require("visita:write"))
):
    doc = await db.visitas.find_one({"id": visita_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Visita não encontrada")
    authorize(principal, "visita:write", doc)

    data = patch_data(input, ("titulo", "data", "hora", "duracao_min", "status"))
    if not principal.is_admin:
        data.pop("corretor_id", None)
    await _validar_visita({**doc, **data}, principal, visita_id)
    if any(k in data and data[k] != doc.get(k) for k in ("data", "hora", "cliente_id", "corretor_id")):
        data["lembrete_enviado_em"] = None  # remarcou: o lembrete volta a valer
        data["lembrete_cliente_em"] = None
    if data:
        data["updated_at"] = now_utc()
        await db.visitas.update_one({"id": visita_id}, {"$set": data})
    atual = await db.visitas.find_one({"id": visita_id})
    from routers.google import agendar, sincronizar_visita
    agendar(background, sincronizar_visita, visita_id)
    return to_visita(atual)


@router.delete("/{visita_id}", status_code=204)
async def delete_visita(visita_id: str, background: BackgroundTasks, principal: Principal = Depends(require("visita:write"))):
    doc = await db.visitas.find_one({"id": visita_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Visita não encontrada")
    authorize(principal, "visita:write", doc)
    await db.visitas.delete_one({"id": visita_id})
    from routers.google import agendar, remover_evento
    agendar(background, remover_evento, doc.get("google_usuario"), doc.get("google_evento_id"))
    return None


# ----------------------------------------------------------------- lembretes por e-mail


async def _logo_html(app_url: str) -> str:
    """Logotipo do configurador no topo do e-mail (URL https absoluta — exigência do gate G3)."""
    doc = await db.configuracoes.find_one({"id": "singleton"}, {"logo_base64": 1})
    if not doc or not doc.get("logo_base64"):
        return ""
    company = await controle.empresas.find_one({"db_name": empresa_atual_db()})
    suffix = "?empresa=" + company["slug"] if company else ""
    return (
        f"<p style='margin:0 0 14px'><img src='{app_url}/api/configuracoes/logo{suffix}' "
        "alt='' height='40' style='height:40px'></p>"
    )


async def _rotulo_visita(v: dict) -> str:
    partes = [f"{v['data'][8:10]}/{v['data'][5:7]} às {v.get('hora', '')}", v.get("titulo", "Visita")]
    if v.get("imovel_id"):
        imovel = await db.imoveis.find_one({"id": v["imovel_id"]})
        if imovel:
            partes.append(f"{imovel['titulo']} — {imovel.get('endereco', '')}")
    if v.get("local"):
        partes.append(v["local"])
    return " · ".join(p for p in partes if p)


async def enviar_lembretes(data_alvo: str) -> LembreteResultado:
    """Agrupa as visitas do dia alvo por corretor e envia um e-mail para cada um."""
    docs = await db.visitas.find(
        {"data": data_alvo, "status": "agendada", "lembrete_enviado_em": None}
    ).sort("hora", 1).to_list(None)

    por_corretor: dict[str, list[dict]] = {}
    for d in docs:
        if d.get("corretor_id"):
            por_corretor.setdefault(d["corretor_id"], []).append(d)

    from lib.invites import app_url as configured_url
    app_url = configured_url()

    enviados, detalhes = 0, []
    for corretor_id, visitas in por_corretor.items():
        # Destinatário vem do banco (conta do corretor), nunca do chamador (G4).
        usuario = await db.usuarios.find_one({"pessoa_id": corretor_id, "ativo": True})
        if not usuario or not usuario.get("email"):
            detalhes.append(f"{corretor_id}: sem conta de usuário ativa — e-mail não enviado")
            continue

        itens = []
        for v in visitas:
            itens.append(f"<li style='margin-bottom:6px'>{escape(await _rotulo_visita(v))}</li>")
        linhas = "".join(itens)
        html = (
            "<table role='presentation' width='100%'><tr><td style=\"padding:24px;"
            "font-family:Arial,sans-serif;color:#1c1c1c\">"
            + await _logo_html(app_url)
            + f"<h2 style='margin:0 0 12px'>Suas visitas de amanhã ({data_alvo[8:10]}/{data_alvo[5:7]})</h2>"
            f"<p>Olá {escape(usuario['nome'])}, você tem {len(visitas)} visita(s) agendada(s) para amanhã:</p>"
            f"<ul style='padding-left:18px'>{linhas}</ul>"
            f"<p><a href='{app_url}/agenda' style='color:#4a03a2'>Abrir a agenda no CedroNexxo</a></p>"
            "<p style='font-size:12px;color:#888'>Enviado pelo CedroNexxo. "
            "Nunca pedimos senhas ou dados de cartão por e-mail.</p>"
            "</td></tr></table>"
        )
        try:
            await send_email(
                to=usuario["email"],
                subject=f"Lembrete: {len(visitas)} visita(s) amanhã — CedroNexxo",
                html=html,
            )
        except Exception as e:  # um e-mail inválido não pode derrubar o lote inteiro
            logger.error(f"lembrete não enviado para {usuario['email']}: {e}")
            detalhes.append(f"{usuario['email']}: falha no envio (verifique o e-mail do corretor)")
            continue
        agora = now_utc()
        await db.visitas.update_many(
            {"id": {"$in": [v["id"] for v in visitas]}}, {"$set": {"lembrete_enviado_em": agora}}
        )
        enviados += 1
        detalhes.append(f"{usuario['email']}: {len(visitas)} visita(s)")

    enviados_cliente, detalhes_cliente = await _lembretes_clientes(data_alvo, app_url)
    return LembreteResultado(
        data_alvo=data_alvo,
        visitas_encontradas=len(docs),
        emails_enviados=enviados + enviados_cliente,
        detalhes=detalhes + detalhes_cliente,
    )


async def _lembretes_clientes(data_alvo: str, app_url: str) -> tuple[int, list[str]]:
    """Confirmação de véspera para o cliente, com local e horário (e-mail do cadastro de Pessoas)."""
    docs = await db.visitas.find(
        {"data": data_alvo, "status": "agendada", "lembrete_cliente_em": None}
    ).sort("hora", 1).to_list(None)

    enviados, detalhes = 0, []
    for v in docs:
        if not v.get("cliente_id"):
            continue
        pessoa = await db.pessoas.find_one({"id": v["cliente_id"]})
        if not pessoa or not pessoa.get("email"):
            detalhes.append(f"cliente da visita {v['titulo']}: sem e-mail cadastrado")
            continue

        corretor_nome = ""
        if v.get("corretor_id"):
            c = await db.pessoas.find_one({"id": v["corretor_id"]})
            corretor_nome = c["nome"] if c else ""
        detalhe = escape(await _rotulo_visita(v))
        html = (
            "<table role='presentation' width='100%'><tr><td style=\"padding:24px;"
            "font-family:Arial,sans-serif;color:#1c1c1c\">"
            + await _logo_html(app_url)
            + "<h2 style='margin:0 0 12px'>Confirmação da sua visita de amanhã</h2>"
            f"<p>Olá {escape(pessoa['nome'])}, lembrete da visita agendada para amanhã:</p>"
            f"<p style='font-size:15px'><strong>{detalhe}</strong></p>"
            + (f"<p>Corretor responsável: {escape(corretor_nome)}</p>" if corretor_nome else "")
            + f"<p><a href='{app_url}' style='color:#4a03a2'>CedroNexxo</a></p>"
            "<p style='font-size:12px;color:#888'>Enviado pelo CedroNexxo. "
            "Nunca pedimos senhas ou dados de cartão por e-mail.</p>"
            "</td></tr></table>"
        )
        try:
            await send_email(
                to=pessoa["email"],
                subject=f"Sua visita amanhã às {v.get('hora', '')} — CedroNexxo",
                html=html,
            )
        except Exception as e:
            logger.error(f"lembrete do cliente não enviado para {pessoa['email']}: {e}")
            detalhes.append(f"{pessoa['email']}: falha no envio (verifique o e-mail do cliente)")
            continue
        await db.visitas.update_one({"id": v["id"]}, {"$set": {"lembrete_cliente_em": now_utc()}})
        enviados += 1
        detalhes.append(f"cliente {pessoa['email']}: visita confirmada")

    return enviados, detalhes


@router.post("/lembretes", response_model=LembreteResultado)
async def disparar_lembretes(principal: Principal = Depends(require("usuario:manage"))):
    """Disparo manual pelo admin (mesma lógica do cron) para o dia seguinte."""
    return await enviar_lembretes(_amanha())


async def _tarefa_lembretes(data_alvo: str, run_id: str) -> None:
    """Roda a rotina para CADA empresa ativa, uma por vez, no banco dela."""
    try:
        empresas = await controle.empresas.find({"ativo": True}, {"db_name": 1, "nome": 1}).to_list(None)
        if not empresas:  # instalação sem empresas: usa o banco de controle
            empresas = [{"db_name": None, "nome": "padrão"}]
        for empresa in empresas:
            definir_empresa(empresa.get("db_name"))
            try:
                resultado = await enviar_lembretes(data_alvo)
                logger.info("cron %s: %s queued=%s", run_id, empresa["nome"], resultado.emails_enviados)
            except Exception:
                logger.exception("Falha de lembretes para empresa; demais empresas serão processadas")
        definir_empresa(None)
    except Exception as e:  # o cron não repete: registra e segue
        logger.error(f"[cron {run_id}] falha nos lembretes de visitas: {e}")


@cron_router.post("/lembretes-visitas")
async def cron_lembretes_visitas(
    background: BackgroundTasks,
    authorization: str | None = Header(None),
    x_webhook_id: str | None = Header(None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    segredo = os.environ.get("WEBHOOK_CRON_SECRET", "")
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    if not segredo or not token or not hmac.compare_digest(token, segredo):
        raise HTTPException(status_code=401, detail="Não autorizado")

    run_id = x_webhook_id or "manual"
    # Idempotência: a marca `lembrete_enviado_em` impede reenvio da mesma visita.
    background.add_task(_tarefa_lembretes, _amanha(), run_id)
    return {"status": "accepted", "run_id": run_id}


async def _validar_visita(data: dict, principal: Principal, visita_id=None):
    await reference("leads", data.get("lead_id"), principal, "lead:read")
    await reference("imoveis", data.get("imovel_id"))
    await reference("pessoas", data.get("cliente_id"), principal)
    await reference("pessoas", data.get("corretor_id"), principal)
    if data.get("status") != "agendada" or not data.get("corretor_id"): return
    start = int(data["hora"][:2]) * 60 + int(data["hora"][3:5])
    end = start + data.get("duracao_min", 60)
    async for other in db.visitas.find({"data": data["data"], "corretor_id": data["corretor_id"], "status": "agendada"}):
        if other["id"] == visita_id: continue
        other_start = int(other["hora"][:2])*60 + int(other["hora"][3:5])
        if start < other_start + other.get("duracao_min",60) and other_start < end:
            raise HTTPException(409, "O responsável já possui visita neste horário")
