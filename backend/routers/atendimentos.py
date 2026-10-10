"""Agenda de atendimentos: serviços, profissionais, agendamentos, bloqueios e conclusão no caixa.

Usado por barbearia, clínica terapêutica, odontologia e estética. A página pública de agendamento
fica em routers/agendar_publico.py e usa as mesmas regras (lib/agenda_online.py).
"""

from __future__ import annotations

import secrets
from datetime import date, timedelta
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from lib.agenda_online import (ATIVOS, CONFIG_PADRAO, agora_local, config, destravar, horarios_livres, hhmm, minutos, slug_de,
                               travar, validar_data, validar_hora)
from lib.auth import Principal, require
from lib.db import controle, db, empresa_atual_db
from models.common import new_id, now_utc

router = APIRouter(prefix="/atendimentos", tags=["atendimentos"])

Status = Literal["agendado", "confirmado", "em_atendimento", "concluido", "faltou", "cancelado"]


# ------------------------------------------------------------------ serviços


class ServicoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    duracao_min: int = Field(ge=5, le=600)
    preco: float = Field(ge=0, le=1_000_000)
    categoria: str | None = Field(default=None, max_length=60)
    descricao: str | None = Field(default=None, max_length=400)
    online: bool = True
    ativo: bool = True
    profissionais: List[str] = Field(default_factory=list)  # vazio = todos que atendem
    retorno_dias: int | None = Field(default=None, ge=1, le=730)  # lembrete de retorno (ex.: toxina 120 dias)
    unidade: str | None = Field(default=None, max_length=10)  # preço por unidade aplicada (U, ml, frasco); vazio = por atendimento


def _servico(d: dict) -> dict:
    return {k: d.get(k) for k in ("id", "nome", "duracao_min", "preco", "categoria", "descricao", "online", "ativo", "profissionais",
                                  "retorno_dias", "unidade", "valor_exemplo")}


@router.get("/servicos")
async def listar_servicos(principal: Principal = Depends(require("servico:read"))):
    docs = await db.servicos.find({}).to_list(500)
    docs.sort(key=lambda d: (not d.get("ativo", True), d.get("categoria") or "", d.get("nome", "")))
    return [_servico(d) for d in docs]


@router.post("/servicos", status_code=201)
async def criar_servico(input: ServicoIn, principal: Principal = Depends(require("servico:write"))):
    doc = {"id": new_id(), **input.model_dump(), "nome": input.nome.strip(), "created_at": now_utc()}
    await db.servicos.insert_one(doc)
    return _servico(doc)


@router.put("/servicos/{servico_id}")
async def editar_servico(servico_id: str, input: ServicoIn, principal: Principal = Depends(require("servico:write"))):
    if not await db.servicos.find_one({"id": servico_id}, {"id": 1}):
        raise HTTPException(404, "Serviço não encontrado")
    await db.servicos.update_one({"id": servico_id}, {"$set": {**input.model_dump(), "nome": input.nome.strip(), "valor_exemplo": False, "updated_at": now_utc()}})
    return _servico(await db.servicos.find_one({"id": servico_id}))


@router.delete("/servicos/{servico_id}", status_code=204)
async def excluir_servico(servico_id: str, principal: Principal = Depends(require("servico:write"))):
    if await db.agendamentos.find_one({"servico_ids": servico_id}, {"id": 1}):
        await db.servicos.update_one({"id": servico_id}, {"$set": {"ativo": False}})
    else:
        await db.servicos.delete_one({"id": servico_id})
    return Response(status_code=204)


# ------------------------------------------------------------------ profissionais


class JornadaIn(BaseModel):
    atende: bool = True
    jornada: dict[str, List[List[str]]] | None = None  # {"1": [["09:00","18:00"]]}; None = jornada padrão
    unidade_ids: List[str] = Field(default_factory=list)
    comissao_pct: float = Field(default=0, ge=0, le=100)
    online: bool = True  # aparece no link de agendamento
    especialidade: str | None = Field(default=None, max_length=80)
    registro: str | None = Field(default=None, max_length=40)  # CRO, CRP, CRFa


def _prof(u: dict) -> dict:
    return {"id": u["id"], "nome": u["nome"], "pessoa_id": u.get("pessoa_id"), "atende": bool(u.get("atende")),
            "jornada": u.get("jornada"), "unidade_ids": u.get("unidade_ids") or [], "comissao_pct": u.get("comissao_pct") or 0,
            "online": u.get("agenda_online", True), "slug": u.get("agenda_slug"), "especialidade": u.get("especialidade"),
            "registro": u.get("registro") or u.get("creci"), "cor": u.get("cor"), "tem_foto": bool(u.get("tem_foto")),
            "foto_v": int(u.get("foto_v", 0)), "papel": u.get("papel")}


async def profissionais_ativos(so_atende: bool = True) -> list[dict]:
    filtro = {"ativo": {"$ne": False}, "papel": {"$ne": "sysadmin"}}
    docs = await db.usuarios.find(filtro).to_list(500)
    return [u for u in docs if u.get("atende") or not so_atende]


def _validar_jornada(j: dict | None) -> dict | None:
    if j is None:
        return None
    saida = {}
    for dia, faixas in j.items():
        if dia not in {str(i) for i in range(7)}:
            raise HTTPException(422, "Dia da semana inválido na jornada")
        norm = []
        for f in faixas:
            if len(f) != 2:
                raise HTTPException(422, "Cada faixa da jornada tem início e fim")
            ini, fim = validar_hora(f[0]), validar_hora(f[1])
            if minutos(fim) <= minutos(ini):
                raise HTTPException(422, "O fim de cada faixa precisa ser depois do início")
            norm.append([ini, fim])
        norm.sort()
        for a, b in zip(norm, norm[1:]):
            if minutos(b[0]) < minutos(a[1]):
                raise HTTPException(422, "Faixas da jornada não podem se sobrepor")
        saida[dia] = norm
    return saida


@router.get("/profissionais")
async def listar_profissionais(todos: bool = False, principal: Principal = Depends(require("agendamento:read"))):
    docs = await profissionais_ativos(so_atende=not todos)
    return [_prof(u) for u in sorted(docs, key=lambda u: u["nome"])]


@router.put("/profissionais/{usuario_id}")
async def configurar_profissional(usuario_id: str, input: JornadaIn, principal: Principal = Depends(require("agendamento:write"))):
    if not principal.is_admin and usuario_id != principal.usuario_id:
        raise HTTPException(403, "Você só pode ajustar a sua própria agenda")
    u = await db.usuarios.find_one({"id": usuario_id})
    if not u or u.get("papel") == "sysadmin":
        raise HTTPException(404, "Profissional não encontrado")
    jornada = _validar_jornada(input.jornada)
    slug = u.get("agenda_slug")
    if not slug:
        base = slug_de(u["nome"].split(" ")[0])
        slug = base
        while await db.usuarios.find_one({"agenda_slug": slug, "id": {"$ne": usuario_id}}, {"id": 1}):
            slug = f"{base}-{secrets.token_hex(2)}"
    dados = {"atende": input.atende, "jornada": jornada, "unidade_ids": input.unidade_ids, "agenda_online": input.online,
             "especialidade": input.especialidade, "registro": input.registro, "agenda_slug": slug}
    if principal.is_admin:
        dados["comissao_pct"] = input.comissao_pct
    await db.usuarios.update_one({"id": usuario_id}, {"$set": dados})
    return _prof({**u, **dados})


# ------------------------------------------------------------------ configuração do link público


class ConfigIn(BaseModel):
    ativo: bool = False
    slug: str = Field(min_length=3, max_length=40)
    intervalo_min: int = Field(default=15, ge=5, le=120)
    antecedencia_min: int = Field(default=60, ge=0, le=60 * 24 * 7)
    janela_dias: int = Field(default=30, ge=1, le=180)
    cancelamento_horas: int = Field(default=2, ge=0, le=168)
    mensagem: str = Field(default="", max_length=400)
    pedir_email: bool = False
    jornada_padrao: dict[str, List[List[str]]] | None = None
    dias_retorno: int = Field(default=30, ge=7, le=365)


@router.get("/config")
async def ver_config(principal: Principal = Depends(require("agendamento:read"))):
    cfg = await config()
    if not cfg.get("slug"):
        e = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1}) or {}
        cfg["sugestao_slug"] = slug_de(e.get("nome") or "agenda")
    return cfg


@router.put("/config")
async def salvar_config(input: ConfigIn, principal: Principal = Depends(require("unidade:manage"))):
    import re

    slug = input.slug.strip().lower()
    if not re.match(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$", slug):
        raise HTTPException(422, "Endereço inválido: use letras minúsculas, números e hífen.")
    if input.ativo:
        from lib.planos import exigir_recurso

        await exigir_recurso("agenda_online")
    base = empresa_atual_db()
    dono = await controle.agenda_index.find_one({"_id": slug})
    if dono and dono.get("db_name") != base:
        raise HTTPException(409, "Este endereço já está em uso. Escolha outro.")
    if not dono:
        await controle.agenda_index.delete_many({"db_name": base})
        await controle.agenda_index.insert_one({"_id": slug, "db_name": base, "em": now_utc()})
    dados = {**input.model_dump(), "slug": slug, "jornada_padrao": _validar_jornada(input.jornada_padrao) or CONFIG_PADRAO["jornada_padrao"]}
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"agenda_online": dados}})
    return await config()


# ------------------------------------------------------------------ agendamentos


class AgendamentoIn(BaseModel):
    profissional_id: str
    servico_ids: List[str] = Field(min_length=1, max_length=10)
    data: str
    inicio: str
    cliente_id: str | None = None
    cliente_nome: str | None = Field(default=None, max_length=120)
    cliente_telefone: str | None = Field(default=None, max_length=30)
    unidade_id: str | None = None
    observacoes: str | None = Field(default=None, max_length=1000)
    status: Status = "agendado"
    repetir_semanas: int = Field(default=0, ge=0, le=52)  # sessões semanais (clínica terapêutica)
    encaixe: bool = False  # permite fora da jornada (o gestor decide)


class AgendamentoUpdate(BaseModel):
    profissional_id: str | None = None
    data: str | None = None
    inicio: str | None = None
    status: Status | None = None
    observacoes: str | None = Field(default=None, max_length=1000)
    encaixe: bool = False


class Conclusao(BaseModel):
    valor: float = Field(ge=0, le=10_000_000)
    forma_pagamento: Literal["dinheiro", "pix", "debito", "credito", "outro", "pendente"] = "pix"
    observacoes: str | None = Field(default=None, max_length=1000)


async def _servicos(ids: list[str]) -> list[dict]:
    docs = await db.servicos.find({"id": {"$in": ids}}).to_list(20)
    por_id = {d["id"]: d for d in docs}
    if len(por_id) != len(set(ids)):
        raise HTTPException(422, "Serviço não encontrado")
    return [por_id[i] for i in ids]


async def _cliente(cliente_id: str | None, nome: str | None, telefone: str | None, papel: str = "cliente") -> dict:
    """Usa o cadastro existente; sem ele, procura pelo telefone e por fim cria."""
    from lib.assinatura import so_digitos
    from models.pessoas import Pessoa

    if cliente_id:
        p = await db.pessoas.find_one({"id": cliente_id})
        if not p:
            raise HTTPException(422, "Cliente não encontrado")
        return p
    if not (nome or "").strip():
        raise HTTPException(422, "Informe o cliente")
    tel = so_digitos(telefone)
    if tel:
        async for p in db.pessoas.find({"telefone_digitos": tel}):
            return p
    p = Pessoa(nome=nome.strip(), papeis=[papel], telefone=(telefone or "").strip() or None).model_dump()
    p["telefone_digitos"] = tel or None
    await db.pessoas.insert_one(p)
    return p


def _saida(a: dict) -> dict:
    a = {k: v for k, v in a.items() if k not in ("_id", "token_cliente")}
    return a


async def criar_agendamento(*, prof: dict, servicos: list[dict], dia: date, inicio: str, cliente: dict, unidade_id: str | None,
                            observacoes: str | None, status: str, origem: str, criado_por: str, encaixe: bool = False) -> dict:
    cfg = await config()
    duracao = sum(int(s["duracao_min"]) for s in servicos)
    ini = minutos(validar_hora(inicio))
    fim = ini + duracao
    if fim > 24 * 60:
        raise HTTPException(422, "O atendimento passa da meia-noite")
    if not encaixe:
        # No balcão vale registrar atendimento de horas atrás; no link público, só com a antecedência mínima.
        livres = await horarios_livres(prof, dia, duracao, {**cfg, "antecedencia_min": cfg["antecedencia_min"] if origem == "online" else -10**7,
                                                            "intervalo_min": 5})
        if inicio not in livres:
            raise HTTPException(409, "Horário indisponível para este profissional. Escolha outro horário.")
    unidade_id = unidade_id or ((prof.get("unidade_ids") or [None])[0])
    if not unidade_id:
        principal_u = await db.unidades.find_one({"principal": True}, {"id": 1})
        unidade_id = (principal_u or {}).get("id")
    a = {
        "id": new_id(), "profissional_id": prof["id"], "profissional_nome": prof["nome"], "unidade_id": unidade_id,
        "servico_ids": [s["id"] for s in servicos], "servicos": [{"id": s["id"], "nome": s["nome"], "preco": s["preco"], "duracao_min": s["duracao_min"]} for s in servicos],
        "cliente_id": cliente["id"], "cliente_nome": cliente["nome"], "cliente_telefone": cliente.get("telefone"),
        "data": dia.isoformat(), "inicio": hhmm(ini), "fim": hhmm(fim), "status": status, "valor": round(sum(float(s["preco"]) for s in servicos), 2),
        "origem": origem, "observacoes": observacoes, "token_cliente": secrets.token_urlsafe(18), "criado_por": criado_por,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    await travar(prof["id"], a["data"], ini, fim, a["id"])
    try:
        await db.agendamentos.insert_one(a)
    except Exception:
        await destravar(a)
        raise
    return a


@router.get("")
async def listar(inicio: str, fim: str, profissional_id: str | None = None, unidade_id: str | None = None,
                 principal: Principal = Depends(require("agendamento:read"))):
    d0, d1 = validar_data(inicio), validar_data(fim)
    if (d1 - d0).days > 62:
        raise HTTPException(422, "Período máximo de 62 dias")
    filtro: dict = {"data": {"$gte": d0.isoformat(), "$lte": d1.isoformat()}}
    if profissional_id:
        filtro["profissional_id"] = profissional_id
    if unidade_id:
        filtro["unidade_id"] = unidade_id
    docs = await db.agendamentos.find(filtro).to_list(3000)
    docs.sort(key=lambda a: (a["data"], a["inicio"]))
    return [_saida(a) for a in docs]


@router.get("/horarios")
async def horarios(profissional_id: str, data: str, servico_ids: str, ignorar: str | None = None,
                   principal: Principal = Depends(require("agendamento:read"))):
    prof = await db.usuarios.find_one({"id": profissional_id})
    if not prof:
        raise HTTPException(404, "Profissional não encontrado")
    servicos = await _servicos([s for s in servico_ids.split(",") if s])
    cfg = await config()
    duracao = sum(int(s["duracao_min"]) for s in servicos)
    return {"duracao_min": duracao, "horarios": await horarios_livres(prof, validar_data(data), duracao, {**cfg, "antecedencia_min": 0}, ignorar)}


@router.post("", status_code=201)
async def criar(input: AgendamentoIn, principal: Principal = Depends(require("agendamento:write"))):
    prof = await db.usuarios.find_one({"id": input.profissional_id, "ativo": {"$ne": False}})
    if not prof:
        raise HTTPException(422, "Profissional não encontrado")
    if input.encaixe and not principal.is_admin:
        raise HTTPException(403, "Só o gestor marca encaixe fora da jornada")
    servicos = await _servicos(input.servico_ids)
    cliente = await _cliente(input.cliente_id, input.cliente_nome, input.cliente_telefone,
                             "paciente" if principal.segmento in ("terapia", "odontologia") else "cliente")
    dia0 = validar_data(input.data)
    criados, conflitos = [], []
    for k in range(input.repetir_semanas + 1):
        dia = dia0 + timedelta(weeks=k)
        try:
            criados.append(await criar_agendamento(prof=prof, servicos=servicos, dia=dia, inicio=input.inicio, cliente=cliente,
                                                   unidade_id=input.unidade_id, observacoes=input.observacoes, status=input.status,
                                                   origem="manual", criado_por=principal.nome, encaixe=input.encaixe))
        except HTTPException as e:
            if k == 0:
                raise
            conflitos.append({"data": dia.isoformat(), "motivo": e.detail})
    return {"criados": [_saida(a) for a in criados], "conflitos": conflitos}


@router.patch("/{agendamento_id}")
async def atualizar(agendamento_id: str, input: AgendamentoUpdate, principal: Principal = Depends(require("agendamento:write"))):
    a = await db.agendamentos.find_one({"id": agendamento_id})
    if not a:
        raise HTTPException(404, "Agendamento não encontrado")
    if a["status"] == "concluido" and input.status and input.status != "concluido":
        raise HTTPException(409, "Atendimento já concluído e lançado no caixa. Estorne no Financeiro se precisar.")
    if input.status == "concluido":
        raise HTTPException(422, "Use Concluir atendimento para registrar o pagamento")
    mudou_horario = any(v is not None for v in (input.profissional_id, input.data, input.inicio))
    dados: dict = {"updated_at": now_utc()}
    if input.observacoes is not None:
        dados["observacoes"] = input.observacoes
    if mudou_horario:
        prof = await db.usuarios.find_one({"id": input.profissional_id or a["profissional_id"]})
        if not prof:
            raise HTTPException(422, "Profissional não encontrado")
        dia = validar_data(input.data or a["data"])
        inicio = validar_hora(input.inicio or a["inicio"])
        duracao = minutos(a["fim"]) - minutos(a["inicio"])
        if not input.encaixe:
            cfg = await config()
            livres = await horarios_livres(prof, dia, duracao, {**cfg, "antecedencia_min": -10**7, "intervalo_min": 5}, ignorar=a["id"])
            if inicio not in livres:
                raise HTTPException(409, "Horário indisponível para este profissional")
        novo = {**a, "profissional_id": prof["id"], "profissional_nome": prof["nome"], "data": dia.isoformat(),
                "inicio": inicio, "fim": hhmm(minutos(inicio) + duracao)}
        await destravar(a)
        try:
            await travar(novo["profissional_id"], novo["data"], minutos(novo["inicio"]), minutos(novo["fim"]), a["id"])
        except HTTPException:
            await travar(a["profissional_id"], a["data"], minutos(a["inicio"]), minutos(a["fim"]), a["id"])
            raise
        dados.update({k: novo[k] for k in ("profissional_id", "profissional_nome", "data", "inicio", "fim")})
    if input.status:
        dados["status"] = input.status
        if input.status in ("cancelado", "faltou") and a["status"] in ATIVOS:
            await destravar({**a, **dados})
        elif input.status in ATIVOS and a["status"] not in ATIVOS:
            alvo = {**a, **dados}
            await travar(alvo["profissional_id"], alvo["data"], minutos(alvo["inicio"]), minutos(alvo["fim"]), a["id"])
    await db.agendamentos.update_one({"id": agendamento_id}, {"$set": dados})
    return _saida({**a, **dados})


@router.post("/{agendamento_id}/concluir")
async def concluir(agendamento_id: str, input: Conclusao, principal: Principal = Depends(require("agendamento:write"))):
    """Fecha a comanda: lança a receita no Financeiro e a comissão do profissional (se houver)."""
    a = await db.agendamentos.find_one({"id": agendamento_id})
    if not a:
        raise HTTPException(404, "Agendamento não encontrado")
    if a["status"] == "concluido":
        raise HTTPException(409, "Atendimento já concluído")
    if a["status"] in ("cancelado", "faltou"):
        raise HTTPException(409, "Reative o agendamento antes de concluir")
    hoje = agora_local().date().isoformat()
    transacao_id = None
    if input.valor > 0:
        conta = await db.plano_contas.find_one({"codigo": "1.1.1"}) or await db.plano_contas.find_one({"tipo": "receita"})
        if not conta:
            raise HTTPException(409, "Cadastre uma conta de receita no plano de contas")
        prof = await db.usuarios.find_one({"id": a["profissional_id"]}) or {}
        t = {"id": new_id(), "descricao": f"{', '.join(s['nome'] for s in a['servicos'])} | {a['cliente_nome']}"[:300],
             "tipo": "receber", "valor": round(input.valor, 2), "plano_conta_id": conta["id"], "imovel_id": None,
             "pessoa_id": a.get("cliente_id"), "corretor_id": prof.get("pessoa_id"), "evento_id": None, "contrato_id": None,
             "agendamento_id": a["id"], "vencimento": hoje, "pagamento": None if input.forma_pagamento == "pendente" else hoje,
             "status": "pendente" if input.forma_pagamento == "pendente" else "pago", "forma_pagamento": input.forma_pagamento,
             "vencido": False, "cancelado_em": None, "created_at": now_utc()}
        await db.transacoes.insert_one(t)
        transacao_id = t["id"]
        pct = float(prof.get("comissao_pct") or 0)
        if pct > 0 and prof.get("pessoa_id"):
            from lib.integrity import percentage

            conta_c = await db.plano_contas.find_one({"codigo": "2.3.1"}) or await db.plano_contas.find_one({"tipo": "despesa"})
            if conta_c:
                await db.transacoes.insert_one({
                    "id": new_id(), "descricao": f"Comissão {prof['nome']} | {a['cliente_nome']}"[:300], "tipo": "pagar",
                    "valor": percentage(input.valor, pct), "plano_conta_id": conta_c["id"], "imovel_id": None,
                    "pessoa_id": prof.get("pessoa_id"), "corretor_id": prof.get("pessoa_id"), "evento_id": None, "contrato_id": None,
                    "agendamento_id": a["id"], "vencimento": hoje, "pagamento": None, "status": "pendente", "vencido": False,
                    "cancelado_em": None, "created_at": now_utc()})
    dados = {"status": "concluido", "valor_cobrado": round(input.valor, 2), "forma_pagamento": input.forma_pagamento,
             "transacao_id": transacao_id, "concluido_em": now_utc(), "concluido_por": principal.nome, "updated_at": now_utc()}
    if input.observacoes:
        dados["observacoes"] = input.observacoes
    await db.agendamentos.update_one({"id": a["id"]}, {"$set": dados})
    await db.pessoas.update_one({"id": a["cliente_id"]}, {"$set": {"ultimo_atendimento": a["data"]}})
    return _saida({**a, **dados})


# ------------------------------------------------------------------ bloqueios


class BloqueioIn(BaseModel):
    profissional_id: str | None = None  # None = todos
    data: str
    inicio: str = "00:00"
    fim: str = "23:59"
    motivo: str = Field(default="", max_length=120)


@router.get("/bloqueios")
async def listar_bloqueios(inicio: str, fim: str, principal: Principal = Depends(require("agendamento:read"))):
    docs = await db.agenda_bloqueios.find({"data": {"$gte": inicio, "$lte": fim}}).to_list(500)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


@router.post("/bloqueios", status_code=201)
async def criar_bloqueio(input: BloqueioIn, principal: Principal = Depends(require("agendamento:write"))):
    if not principal.is_admin and input.profissional_id != principal.usuario_id:
        raise HTTPException(403, "Você só pode bloquear a sua própria agenda")
    validar_data(input.data)
    if minutos(validar_hora(input.fim)) <= minutos(validar_hora(input.inicio)):
        raise HTTPException(422, "O fim do bloqueio precisa ser depois do início")
    doc = {"id": new_id(), **input.model_dump(), "criado_por": principal.nome, "created_at": now_utc()}
    await db.agenda_bloqueios.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.delete("/bloqueios/{bloqueio_id}", status_code=204)
async def excluir_bloqueio(bloqueio_id: str, principal: Principal = Depends(require("agendamento:write"))):
    b = await db.agenda_bloqueios.find_one({"id": bloqueio_id})
    if b and not principal.is_admin and b.get("profissional_id") != principal.usuario_id:
        raise HTTPException(403, "Você só pode remover bloqueios da sua agenda")
    await db.agenda_bloqueios.delete_one({"id": bloqueio_id})
    return Response(status_code=204)


# ------------------------------------------------------------------ painel e retorno de clientes


@router.get("/resumo")
async def resumo(principal: Principal = Depends(require("agendamento:read"))):
    """Indicadores do dia e do mês para a Visão Geral dos segmentos de atendimento."""
    hoje = agora_local().date()
    ini_mes = hoje.replace(day=1).isoformat()
    docs = await db.agendamentos.find({"data": {"$gte": ini_mes, "$lte": (hoje + timedelta(days=7)).isoformat()}}).to_list(5000)
    do_dia = [a for a in docs if a["data"] == hoje.isoformat() and a["status"] != "cancelado"]
    mes = [a for a in docs if a["data"] <= hoje.isoformat()]
    concluidos = [a for a in mes if a["status"] == "concluido"]
    faltas = [a for a in mes if a["status"] == "faltou"]
    prox = sorted((a for a in docs if a["data"] > hoje.isoformat() and a["status"] in ("agendado", "confirmado")), key=lambda a: (a["data"], a["inicio"]))
    online = [a for a in mes if a.get("origem") == "online"]
    faturado = round(sum(float(a.get("valor_cobrado") or 0) for a in concluidos), 2)
    return {
        "hoje": [_saida(a) for a in sorted(do_dia, key=lambda a: a["inicio"])],
        "proximos_7_dias": len(prox),
        "mes": {"agendados": len([a for a in mes if a["status"] != "cancelado"]), "concluidos": len(concluidos),
                "faltas": len(faltas), "taxa_falta": round(len(faltas) / max(1, len(concluidos) + len(faltas)) * 100, 1),
                "faturado": faturado, "ticket_medio": round(faturado / len(concluidos), 2) if concluidos else None,
                "online": len(online)},
    }


@router.get("/retorno")
async def clientes_para_retorno(dias: int | None = Query(None, ge=7, le=730), principal: Principal = Depends(require("agendamento:read"))):
    """Clientes sem atendimento há X dias e sem horário marcado: lista para chamar de volta."""
    cfg = await config()
    corte_padrao = dias or int(cfg.get("dias_retorno") or 30)
    hoje = agora_local().date()
    servicos = {s["id"]: s for s in await db.servicos.find({}, {"id": 1, "retorno_dias": 1, "nome": 1}).to_list(500)}
    ultimo: dict[str, dict] = {}
    futuros: set[str] = set()
    async for a in db.agendamentos.find({"status": {"$in": ["concluido", "agendado", "confirmado"]}},
                                        {"cliente_id": 1, "data": 1, "status": 1, "servico_ids": 1, "cliente_nome": 1, "cliente_telefone": 1, "profissional_nome": 1}):
        if a["status"] != "concluido":
            if a["data"] >= hoje.isoformat():
                futuros.add(a["cliente_id"])
            continue
        if a["cliente_id"] not in ultimo or a["data"] > ultimo[a["cliente_id"]]["data"]:
            ultimo[a["cliente_id"]] = a
    saida = []
    for cid, a in ultimo.items():
        if cid in futuros:
            continue
        retornos = [servicos[s]["retorno_dias"] for s in a.get("servico_ids", []) if s in servicos and servicos[s].get("retorno_dias")]
        corte = min(retornos) if retornos and not dias else corte_padrao
        passou = (hoje - date.fromisoformat(a["data"])).days
        if passou >= corte:
            saida.append({"cliente_id": cid, "cliente_nome": a.get("cliente_nome"), "telefone": a.get("cliente_telefone"),
                          "ultimo_atendimento": a["data"], "dias": passou, "profissional": a.get("profissional_nome"),
                          "servicos": [servicos[s]["nome"] for s in a.get("servico_ids", []) if s in servicos]})
    saida.sort(key=lambda x: -x["dias"])
    return saida[:300]
