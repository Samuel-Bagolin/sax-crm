"""Afiliados e cashback (lib/cashback.py): telas do CRM e as rotas públicas do site."""

from __future__ import annotations

import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from lib import cashback as cb
from lib.auth import Principal, require
from lib.db import db
from models.common import now_utc

router = APIRouter(prefix="/cashback", tags=["cashback"])
publico_router = APIRouter(prefix="/publico/site", tags=["publico"])

LER = "paciente:read"
ESCREVER = "paciente:write"


def _gestor(principal: Principal) -> None:
    if not principal.is_admin:
        raise HTTPException(403, "Só o gestor faz isso")


def _http(e: cb.ErroCashback) -> HTTPException:
    return HTTPException(e.status, e.mensagem)


def _limpo(d: dict | None) -> dict | None:
    if not d:
        return None
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items() if k != "_id"}


async def _link_site(codigo: str) -> str | None:
    from routers.site_imobiliaria import _url, carregar_config

    config, configurado = await carregar_config()
    return f"{_url(config.slug)}?ref={codigo}" if configurado and config.slug and config.ativo else None


# ------------------------------------------------------------------ configuração e resumo


@router.get("/config")
async def ver_config(principal: Principal = Depends(require(LER))):
    return (await cb.carregar_config()).model_dump()


@router.put("/config")
async def salvar_config(input: cb.CashbackConfig, principal: Principal = Depends(require(ESCREVER))):
    _gestor(principal)
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"cashback": input.model_dump()}})
    from routers.site_imobiliaria import limpar_cache

    limpar_cache()
    return input.model_dump()


@router.get("/resumo")
async def resumo(principal: Principal = Depends(require(LER))):
    cfg = await cb.carregar_config()
    hj = cb.hoje()
    desde = (hj - timedelta(days=30)).isoformat()
    movs = await db.cb_movimentos.find({}).to_list(20000)
    compras = [c for c in await db.cb_compras.find({}).to_list(20000) if not c.get("estornada")]
    vivos = [m for m in movs if m.get("tipo") == "credito" and float(m.get("restante") or 0) > 0.004 and (m.get("validade") or "") >= hj.isoformat()]
    afiliados = await db.pessoas.find({"afiliado_codigo": {"$ne": None}}, {"id": 1, "nome": 1, "afiliado_codigo": 1}).to_list(5000)
    afiliados = [a for a in afiliados if a.get("afiliado_codigo")]
    ganho: dict[str, float] = {}
    vendas: dict[str, float] = {}
    for m in movs:
        if m.get("tipo") == "credito" and m.get("origem") == "indicacao" and not m.get("estornado"):
            ganho[m["pessoa_id"]] = ganho.get(m["pessoa_id"], 0) + float(m["valor"])
    for c in compras:
        if c.get("afiliado_id"):
            vendas[c["afiliado_id"]] = vendas.get(c["afiliado_id"], 0) + float(c["valor"])
    top = sorted(({"pessoa_id": a["id"], "nome": a.get("nome"), "codigo": a["afiliado_codigo"], "vendas": round(vendas.get(a["id"], 0), 2),
                   "ganho": round(ganho.get(a["id"], 0), 2)} for a in afiliados), key=lambda x: -x["vendas"])[:5]
    recentes = [c for c in compras if (c.get("data") or "") >= desde]
    return {
        "config": cfg.model_dump(), "saldo_em_aberto": round(sum(float(m["restante"]) for m in vivos), 2),
        "gerado_30d": round(sum(float(m["valor"]) for m in movs if m.get("tipo") == "credito" and not m.get("estornado")
                                and m.get("created_at") and m["created_at"].date().isoformat() >= desde), 2),
        "usado_30d": round(sum(float(c.get("cashback_usado") or 0) for c in recentes), 2),
        "compras_30d": len(recentes), "vendas_30d": round(sum(float(c["valor"]) for c in recentes), 2),
        "vendas_indicadas_30d": round(sum(float(c["valor"]) for c in recentes if c.get("afiliado_id")), 2),
        "afiliados": len(afiliados), "top": top,
    }


# ------------------------------------------------------------------ clientes e afiliados


async def _ficha(p: dict) -> dict:
    s = await cb.saldo(p["id"])
    out = {"id": p["id"], "nome": p.get("nome"), "telefone": p.get("telefone"), "codigo": p.get("afiliado_codigo"),
           "indicado_por": None, **s}
    if p.get("indicado_por"):
        a = await db.pessoas.find_one({"id": p["indicado_por"]}, {"nome": 1, "afiliado_codigo": 1})
        out["indicado_por"] = {"id": p["indicado_por"], "nome": (a or {}).get("nome"), "codigo": (a or {}).get("afiliado_codigo")}
    return out


@router.get("/clientes")
async def buscar(q: str = Query("", max_length=80), principal: Principal = Depends(require(LER))):
    texto = cb.normalizar_codigo(q) if "-" in q else ""
    if texto:
        a = await cb.afiliado_pelo_codigo(texto)
        return [await _ficha(a)] if a else []
    t = cb.so_digitos(q)
    if len(t) >= 8:
        docs = await db.pessoas.find({"telefone_digitos": t}).to_list(10)
        if not docs:
            docs = [p for p in await db.pessoas.find({}, {"id": 1, "nome": 1, "telefone": 1, "telefone_digitos": 1, "papeis": 1}).to_list(5000)
                    if t in (p.get("telefone_digitos") or "")][:10]
        return [await _ficha(p) for p in docs if "corretor" not in (p.get("papeis") or [])]
    termo = q.strip().lower()
    if len(termo) < 2:
        return []
    docs = await db.pessoas.find({}, {"id": 1, "nome": 1, "telefone": 1, "papeis": 1, "afiliado_codigo": 1, "indicado_por": 1}).to_list(5000)
    achados = [p for p in docs if termo in (p.get("nome") or "").lower() and "corretor" not in (p.get("papeis") or [])][:10]
    return [await _ficha(p) for p in achados]


@router.get("/clientes/{pessoa_id}")
async def extrato(pessoa_id: str, principal: Principal = Depends(require(LER))):
    p = await db.pessoas.find_one({"id": pessoa_id})
    if not p:
        raise HTTPException(404, "Cliente não encontrado")
    movs = sorted(await db.cb_movimentos.find({"pessoa_id": pessoa_id}).to_list(2000), key=lambda m: m.get("created_at") or now_utc(), reverse=True)
    indicados = await db.pessoas.find({"indicado_por": pessoa_id}, {"id": 1, "nome": 1, "indicado_em": 1}).to_list(500)
    compras = sorted(await db.cb_compras.find({"cliente_id": pessoa_id}).to_list(500), key=lambda c: c.get("created_at") or now_utc(), reverse=True)
    link = await _link_site(p["afiliado_codigo"]) if p.get("afiliado_codigo") else None
    return {**await _ficha(p), "link": link, "movimentos": [_limpo(m) for m in movs[:200]],
            "indicados": [_limpo(i) for i in indicados], "compras": [_limpo(c) for c in compras[:100]]}


class AfiliadoIn(BaseModel):
    pessoa_id: str | None = None
    nome: str | None = Field(default=None, max_length=120)
    telefone: str | None = Field(default=None, max_length=30)


@router.get("/afiliados")
async def afiliados(principal: Principal = Depends(require(LER))):
    docs = [d for d in await db.pessoas.find({"afiliado_codigo": {"$ne": None}}).to_list(5000) if d.get("afiliado_codigo")]
    compras = [c for c in await db.cb_compras.find({}).to_list(20000) if not c.get("estornada") and c.get("afiliado_id")]
    indicados: dict[str, int] = {}
    for p in await db.pessoas.find({"indicado_por": {"$ne": None}}, {"indicado_por": 1}).to_list(20000):
        if p.get("indicado_por"):
            indicados[p["indicado_por"]] = indicados.get(p["indicado_por"], 0) + 1
    saida = []
    for d in docs:
        vendas = sum(float(c["valor"]) for c in compras if c["afiliado_id"] == d["id"])
        saida.append({**await _ficha(d), "indicados": indicados.get(d["id"], 0), "vendas": round(vendas, 2),
                      "desde": d["afiliado_desde"].isoformat() if hasattr(d.get("afiliado_desde"), "isoformat") else None})
    return sorted(saida, key=lambda x: (-x["vendas"], (x["nome"] or "").lower()))


@router.post("/afiliados", status_code=201)
async def criar_afiliado(input: AfiliadoIn, principal: Principal = Depends(require(ESCREVER))):
    if input.pessoa_id:
        p = await db.pessoas.find_one({"id": input.pessoa_id})
        if not p:
            raise HTTPException(404, "Cliente não encontrado")
    else:
        if not input.nome or len(input.nome.strip()) < 2 or len(cb.so_digitos(input.telefone)) < 10:
            raise HTTPException(422, "Informe nome e WhatsApp com DDD")
        p = await cb.cliente_por_telefone(input.telefone) or await cb.criar_cliente(input.nome, input.telefone, principal.usuario_id)
    await cb.tornar_afiliado(p)
    return {**await _ficha(p), "link": await _link_site(p["afiliado_codigo"])}


# ------------------------------------------------------------------ compras


class CompraIn(BaseModel):
    cliente_id: str | None = None
    nome: str | None = Field(default=None, max_length=120)
    telefone: str | None = Field(default=None, max_length=30)
    unidade_id: str | None = None
    valor: float = Field(gt=0, le=1_000_000)
    usar_cashback: float = Field(default=0, ge=0, le=1_000_000)
    codigo_indicacao: str | None = Field(default=None, max_length=20)
    descricao: str | None = Field(default=None, max_length=200)


@router.post("/compras", status_code=201)
async def registrar(input: CompraIn, principal: Principal = Depends(require(ESCREVER))):
    if input.cliente_id:
        cliente = await db.pessoas.find_one({"id": input.cliente_id})
        if not cliente:
            raise HTTPException(404, "Cliente não encontrado")
    else:
        if not input.nome or len(input.nome.strip()) < 2 or len(cb.so_digitos(input.telefone)) < 10:
            raise HTTPException(422, "Escolha o cliente ou informe nome e WhatsApp com DDD")
        cliente = await cb.cliente_por_telefone(input.telefone) or await cb.criar_cliente(input.nome, input.telefone, principal.usuario_id)
    unidade = await db.unidades.find_one({"id": input.unidade_id}) if input.unidade_id else None
    if input.unidade_id and not unidade:
        raise HTTPException(422, "Loja não encontrada")
    try:
        compra = await cb.registrar_compra(cliente=cliente, valor=input.valor, usar=input.usar_cashback, unidade=unidade,
                                           codigo=input.codigo_indicacao, descricao=input.descricao, por=principal.nome)
    except cb.ErroCashback as e:
        raise _http(e)
    return {**_limpo(compra), "cliente": await _ficha(await db.pessoas.find_one({"id": cliente["id"]}))}


@router.get("/compras")
async def compras(limite: int = Query(100, ge=1, le=500), principal: Principal = Depends(require(LER))):
    docs = sorted(await db.cb_compras.find({}).to_list(20000), key=lambda c: c.get("created_at") or now_utc(), reverse=True)[:limite]
    nomes = {p["id"]: p.get("nome") for p in await db.pessoas.find({"afiliado_codigo": {"$ne": None}}, {"id": 1, "nome": 1}).to_list(5000)}
    return [{**_limpo(c), "afiliado_nome": nomes.get(c.get("afiliado_id"))} for c in docs]


@router.post("/compras/{compra_id}/estornar")
async def estornar(compra_id: str, principal: Principal = Depends(require(ESCREVER))):
    _gestor(principal)
    c = await db.cb_compras.find_one({"id": compra_id})
    if not c:
        raise HTTPException(404, "Compra não encontrada")
    try:
        return await cb.estornar(c, principal.nome)
    except cb.ErroCashback as e:
        raise _http(e)


# ------------------------------------------------------------------ site público: indicação

_PEDIDOS: dict[str, list[float]] = {}


async def _programa_no_site(slug: str) -> cb.CashbackConfig:
    from routers.site_imobiliaria import _site_ativo

    await _site_ativo(slug)
    cfg = await cb.carregar_config()
    if not cfg.ativo:
        raise HTTPException(404, "Programa de indicação desligado")
    return cfg


@publico_router.get("/{slug}/indicacao/{codigo}")
async def indicacao(slug: str, codigo: str):
    await _programa_no_site(slug)
    a = await cb.afiliado_pelo_codigo(codigo)
    if not a:
        return {"valido": False}
    return {"valido": True, "codigo": a["afiliado_codigo"], "nome": (a.get("nome") or "").split(" ")[0]}


class QueroIndicarIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=10, max_length=30)
    site: str | None = None  # isca para robôs


@publico_router.post("/{slug}/indicacao", status_code=201)
async def quero_indicar(slug: str, input: QueroIndicarIn, request: Request):
    """Autocadastro no "Indique e ganhe": devolve o código e o link para compartilhar. Não mostra saldo."""
    from routers.site_imobiliaria import _ip

    cfg = await _programa_no_site(slug)
    if not cfg.autocadastro_site:
        raise HTTPException(409, "Peça o seu código de indicação na loja.")
    if input.site:
        raise HTTPException(422, "Não foi possível cadastrar")
    agora = time.monotonic()
    chave = f"{slug}:{_ip(request)}"
    recentes = [t for t in _PEDIDOS.get(chave, []) if agora - t < 600]
    if len(recentes) >= 5:
        raise HTTPException(429, "Muitas tentativas seguidas. Tente de novo em alguns minutos.")
    _PEDIDOS[chave] = [*recentes, agora]
    if len(cb.so_digitos(input.telefone)) < 10:
        raise HTTPException(422, "Informe o WhatsApp com DDD")
    p = await cb.cliente_por_telefone(input.telefone) or await cb.criar_cliente(input.nome, input.telefone)
    codigo = await cb.tornar_afiliado(p)
    return {"codigo": codigo, "link": await _link_site(codigo)}
