"""Pedidos e comissões (lógica do CRM Revendas do O Pudim Perfeito).

- Pedido = venda registrada num negócio ganho (nº do pedido, data não futura, valor). Registrar o pedido de um
  negócio em aberto marca o negócio como ganho (ganho exige pedido com valor).
- Comissão: os `pedidos_com_comissao` primeiros pedidos (não cancelados) de cada cliente pagam `pct` ao
  responsável do negócio. A ordem é recalculada a cada pedido novo ou cancelado; aprovada e paga ficam congeladas.
- Aprovação: supervisor (dentro da supervisão dele), gerentes e diretoria. Ninguém aprova a própria comissão,
  só a diretoria. Pagamento no dia `dia_pagamento` do mês seguinte ao pedido.
- Quem vê: líder só a própria comissão; supervisor as da supervisão; gestores tudo.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from lib.auth import Principal, require
from lib.crm import registrar
from lib.db import db
from models.common import new_id, now_utc

router = APIRouter(prefix="/pedidos", tags=["pedidos"])


class ComissaoConfig(BaseModel):
    ativo: bool = True
    pct: float = Field(default=7.0, ge=0, le=50)
    pedidos_com_comissao: int = Field(default=2, ge=1, le=100)
    dia_pagamento: int = Field(default=10, ge=1, le=28)
    forma_pagamento: str = Field(default="Caju", max_length=40)


async def carregar_config() -> ComissaoConfig:
    doc = await db.configuracoes.find_one({"id": "singleton"}, {"comissao_pedidos": 1}) or {}
    return ComissaoConfig(**(doc.get("comissao_pedidos") or {}))


def _diretoria(principal: Principal, perfil: str | None) -> bool:
    return principal.is_admin and perfil in (None, "diretoria")


async def _perfil(principal: Principal) -> str | None:
    u = await db.usuarios.find_one({"id": principal.usuario_id}, {"perfil": 1}) or {}
    return u.get("perfil")


def _ve(principal: Principal, p: dict) -> bool:
    if principal.is_admin:
        return True
    if p.get("beneficiario_id") == principal.pessoa_id:
        return True
    return principal.supervisiona and principal.no_escopo({"corretor_id": p.get("beneficiario_id"), "praca": p.get("praca"),
                                                           "supervisao_id": p.get("supervisao_id")})


def _pode_aprovar(principal: Principal, p: dict, perfil: str | None) -> str | None:
    if p.get("beneficiario_id") == principal.pessoa_id and not _diretoria(principal, perfil):
        return "Ninguém aprova a própria comissão. Peça ao supervisor, ao gerente ou à diretoria."
    if principal.is_admin:
        return None
    if principal.supervisiona and _ve(principal, p):
        return None
    return "Só supervisor, gerente ou diretoria aprovam comissão."


def _vencimento(data_pedido: str, dia: int) -> str:
    a, m = int(data_pedido[:4]), int(data_pedido[5:7])
    a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return date(a, m, dia).isoformat()


async def recalcular(cliente_chave: str, cfg: ComissaoConfig) -> None:
    """Ordem dos pedidos do cliente e comissão dos N primeiros. Aprovada e paga não mudam."""
    pedidos = [p for p in await db.pedidos.find({"cliente_chave": cliente_chave}).to_list(2000) if p.get("status") != "cancelado"]
    pedidos.sort(key=lambda p: (p.get("data") or "", p.get("registrado_em") or now_utc()))
    for i, p in enumerate(pedidos, 1):
        if p.get("status") in ("aprovada", "paga"):
            continue
        tem = cfg.ativo and i <= cfg.pedidos_com_comissao
        pct = cfg.pct if tem else 0.0
        mudar = {"ordem": i, "pct": pct, "comissao": round(float(p["valor"]) * pct / 100, 2),
                 "status": "pendente" if tem else "sem_comissao"}
        if any(p.get(k) != v for k, v in mudar.items()):
            await db.pedidos.update_one({"id": p["id"]}, {"$set": mudar})


def _saida(p: dict, nomes: dict[str, str], perfil_eu: tuple[Principal, str | None]) -> dict:
    principal, perfil = perfil_eu
    out = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in p.items() if k != "_id"}
    out["beneficiario_nome"] = nomes.get(p.get("beneficiario_id"))
    out["pode_aprovar"] = p.get("status") == "pendente" and _pode_aprovar(principal, p, perfil) is None
    out["pode_pagar"] = p.get("status") == "aprovada" and principal.is_admin
    out["minha"] = p.get("beneficiario_id") == principal.pessoa_id
    return out


# ------------------------------------------------------------------ rotas


@router.get("/config")
async def ver_config(principal: Principal = Depends(require("lead:read"))):
    return (await carregar_config()).model_dump()


@router.put("/config")
async def salvar_config(input: ComissaoConfig, principal: Principal = Depends(require("lead:update"))):
    if not principal.is_admin:
        raise HTTPException(403, "Só a diretoria e os gerentes mudam a regra de comissão")
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"comissao_pedidos": input.model_dump()}})
    return input.model_dump()


class PedidoIn(BaseModel):
    negocio_id: str
    numero: str = Field(min_length=1, max_length=40)
    data: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    valor: float = Field(gt=0, le=10_000_000)
    observacao: str | None = Field(default=None, max_length=500)


@router.post("", status_code=201)
async def registrar_pedido(input: PedidoIn, principal: Principal = Depends(require("lead:update"))):
    from routers.leads import _aplicar, _carregar

    neg = await _carregar(input.negocio_id, principal)
    if input.data > date.today().isoformat():
        raise HTTPException(422, "A data do pedido não pode ser no futuro.")
    if neg.get("status") == "perdido":
        raise HTTPException(409, "Negócio perdido não recebe pedido. Reabra o negócio antes.")
    cfg = await carregar_config()
    if neg.get("status") != "ganho":
        neg = await _aplicar(neg, {"status": "ganho", "valor_estimado": round(input.valor, 2)}, principal)
    chave = neg.get("cliente_id") or f"negocio:{neg['id']}"
    doc = {"id": new_id(), "negocio_id": neg["id"], "negocio_nome": neg.get("nome"), "cliente_id": neg.get("cliente_id"), "cliente_chave": chave,
           "numero": input.numero.strip(), "data": input.data, "mes": input.data[:7], "valor": round(input.valor, 2),
           "beneficiario_id": neg.get("corretor_id"), "praca": neg.get("praca"), "supervisao_id": neg.get("supervisao_id"),
           "unidade_id": neg.get("unidade_id"), "status": "pendente", "ordem": None, "pct": 0.0, "comissao": 0.0,
           "observacao": (input.observacao or "").strip() or None, "registrado_por": principal.nome, "registrado_em": now_utc(),
           "pagamento_previsto": _vencimento(input.data, cfg.dia_pagamento)}
    await db.pedidos.insert_one(doc)
    await recalcular(chave, cfg)
    await registrar(neg["id"], "campo", f"Pedido {doc['numero']} registrado: R$ {doc['valor']:.2f}".replace(".", ","), principal)
    p = await db.pedidos.find_one({"id": doc["id"]})
    return _saida(p, {}, (principal, await _perfil(principal)))


@router.get("")
async def listar(mes: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), negocio_id: str | None = None,
                 principal: Principal = Depends(require("lead:read"))):
    filtro: dict = {}
    if negocio_id:
        filtro["negocio_id"] = negocio_id
    elif mes:
        filtro["mes"] = mes
    docs = [p for p in await db.pedidos.find(filtro).to_list(5000) if _ve(principal, p)]
    docs.sort(key=lambda p: (p.get("data") or "", str(p.get("registrado_em"))), reverse=True)
    pessoas = {u["pessoa_id"]: u.get("nome") for u in await db.usuarios.find({}, {"pessoa_id": 1, "nome": 1}).to_list(2000) if u.get("pessoa_id")}
    eu = (principal, await _perfil(principal))
    itens = [_saida(p, pessoas, eu) for p in docs]
    validos = [p for p in itens if p["status"] != "cancelado"]
    por_pessoa: dict[str, dict] = {}
    for p in validos:
        k = p.get("beneficiario_id") or "-"
        r = por_pessoa.setdefault(k, {"pessoa_id": k, "nome": p.get("beneficiario_nome") or "Sem responsável", "vendido": 0.0, "comissao": 0.0, "pedidos": 0})
        r["vendido"] += p["valor"]
        r["comissao"] += p.get("comissao") or 0
        r["pedidos"] += 1
    soma = lambda st: round(sum(p.get("comissao") or 0 for p in validos if p["status"] == st), 2)  # noqa: E731
    return {"config": (await carregar_config()).model_dump(), "pedidos": itens,
            "resumo": {"vendido": round(sum(p["valor"] for p in validos), 2), "comissao": round(sum(p.get("comissao") or 0 for p in validos), 2),
                       "pendente": soma("pendente"), "aprovada": soma("aprovada"), "paga": soma("paga")},
            "por_pessoa": sorted(({**v, "vendido": round(v["vendido"], 2), "comissao": round(v["comissao"], 2)} for v in por_pessoa.values()),
                                 key=lambda x: -x["comissao"])}


class AcaoIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


@router.post("/aprovar")
async def aprovar(input: AcaoIn, principal: Principal = Depends(require("lead:update"))):
    perfil = await _perfil(principal)
    ok, falhas = 0, []
    for pid in input.ids:
        p = await db.pedidos.find_one({"id": pid})
        if not p or not _ve(principal, p):
            falhas.append({"id": pid, "motivo": "Pedido não encontrado"})
            continue
        if p.get("status") != "pendente":
            falhas.append({"id": pid, "motivo": "Só comissão pendente pode ser aprovada"})
            continue
        motivo = _pode_aprovar(principal, p, perfil)
        if motivo:
            falhas.append({"id": pid, "motivo": motivo})
            continue
        r = await db.pedidos.update_one({"id": pid, "status": "pendente"}, {"$set": {"status": "aprovada", "aprovado_por": principal.nome, "aprovado_em": now_utc()}})
        ok += r.modified_count
    return {"ok": ok, "falhas": falhas}


@router.post("/pagar")
async def pagar(input: AcaoIn, principal: Principal = Depends(require("lead:update"))):
    if not principal.is_admin:
        raise HTTPException(403, "Só a diretoria e os gerentes marcam comissão como paga")
    ok = 0
    for pid in input.ids:
        r = await db.pedidos.update_one({"id": pid, "status": "aprovada"}, {"$set": {"status": "paga", "pago_por": principal.nome, "pago_em": now_utc()}})
        ok += r.modified_count
    return {"ok": ok}


@router.post("/{pedido_id}/cancelar")
async def cancelar(pedido_id: str, principal: Principal = Depends(require("lead:update"))):
    p = await db.pedidos.find_one({"id": pedido_id})
    if not p or not _ve(principal, p):
        raise HTTPException(404, "Pedido não encontrado")
    if not (principal.is_admin or principal.supervisiona):
        raise HTTPException(403, "Peça ao supervisor para cancelar o pedido")
    if p.get("status") == "paga":
        raise HTTPException(409, "Comissão já paga: o pedido não pode ser cancelado")
    await db.pedidos.update_one({"id": pedido_id}, {"$set": {"status": "cancelado", "cancelado_por": principal.nome, "cancelado_em": now_utc()}})
    await recalcular(p["cliente_chave"], await carregar_config())
    await registrar(p["negocio_id"], "campo", f"Pedido {p.get('numero')} cancelado", principal)
    return {"ok": True}
