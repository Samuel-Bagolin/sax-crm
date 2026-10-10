"""Assinatura da empresa logada: plano, faturas, troca de cartão, mudança de plano e cancelamento.

Só o gestor da empresa usa estas rotas. A empresa vem do token, como em todo o sistema.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from lib import asaas
from lib.assinatura import resumo_publico, so_digitos, validar_cartao, eh_cartao_demo
from lib.auth import Principal, require
from lib.db import controle
from lib.planos import PLANOS, RECURSOS, carregar_catalogo, plano_de, planos_do_segmento, uso_atual, valores_comerciais
from lib.segmentos import info, segmento_de
from models.common import now_utc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assinatura", tags=["assinatura"])


async def _empresa(principal: Principal) -> dict:
    if not principal.empresa_id:
        raise HTTPException(403, "Entre em uma empresa")
    e = await controle.empresas.find_one({"id": principal.empresa_id})
    if not e:
        raise HTTPException(404, "Empresa não encontrada")
    return e


def _ip(request: Request) -> str:
    primeiro = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return request.headers.get("x-real-ip") or primeiro or (request.client.host if request.client else "0.0.0.0")


@router.get("")
async def minha_assinatura(principal: Principal = Depends(require("assinatura_plataforma:manage"))):
    await carregar_catalogo()
    e = await _empresa(principal)
    seg = segmento_de(e)
    plano = plano_de(e)
    faturas = await controle.faturas.find({"empresa_id": e["id"]}).sort("vencimento", -1).to_list(24)
    planos = [
        {"chave": k, "nome": p["nome"], "resumo": p.get("resumo", ""), "preco_mensal": p.get("preco_mensal"),
         "preco_anual": p.get("preco_anual"), "usuarios": p.get("usuarios"), "imoveis": p.get("imoveis"), "unidades": p.get("unidades"),
         "recursos": [RECURSOS[r] for r in p.get("recursos", []) if r in RECURSOS]}
        for k, p in sorted(planos_do_segmento(seg).items(), key=lambda kv: kv[1].get("ordem", 50))
    ]
    return {
        "segmento": info(seg), "plano": {"chave": plano.get("chave"), "nome": plano["nome"], "usuarios": plano.get("usuarios"),
                                          "imoveis": plano.get("imoveis"), "unidades": plano.get("unidades")},
        "uso": await uso_atual(), "valores": valores_comerciais(e), "assinatura": resumo_publico(e.get("assinatura")),
        "autoatendimento": bool(e.get("assinatura")), "planos": planos,
        "faturas": [{"id": f["_id"][-8:], "valor": f.get("valor"), "status": f.get("status"), "vencimento": f.get("vencimento"),
                     "pago_em": f.get("pago_em"), "link": f.get("link")} for f in faturas],
    }


class CartaoIn(BaseModel):
    numero: str = Field(max_length=30)
    nome: str = Field(max_length=80)
    validade: str = Field(max_length=7)
    cvv: str = Field(max_length=4)


@router.put("/cartao")
async def trocar_cartao(request: Request, principal: Principal = Depends(require("assinatura_plataforma:manage"))):
    e = await _empresa(principal)
    ass = dict(e.get("assinatura") or {})
    if not ass:
        raise HTTPException(409, "A cobrança desta empresa é feita pelo comercial. Fale com o suporte para trocar o cartão.")
    try:
        bruto = await request.json()
        c = CartaoIn(**(bruto or {}))
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(422, "Confira os dados do cartão.")
    mes, _, ano = c.validade.partition("/")
    cartao = validar_cartao(c.numero, mes, ano, c.cvv, c.nome)
    if ass.get("demo"):
        if not await eh_cartao_demo(cartao["numero"]):
            raise HTTPException(409, "Esta é uma conta de demonstração. Para assinar de verdade, fale com o suporte.")
        return {"ok": True}
    titular = e.get("titular") or {}
    try:
        r = await asaas.trocar_cartao(assinatura_id=ass["asaas_assinatura_id"], cartao=cartao, ip=_ip(request), titular={
            "nome": cartao["nome"], "email": titular.get("email") or principal.email, "cpf_cnpj": so_digitos(titular.get("documento")),
            "cep": titular.get("cep"), "numero": titular.get("numero"), "telefone": titular.get("telefone")})
    except asaas.ErroAsaas as err:
        raise asaas.http(err)
    cartao = None  # noqa: F841
    ass.update(cartao_final=r.get("creditCardNumber") or ass.get("cartao_final"), cartao_bandeira=r.get("creditCardBrand") or ass.get("cartao_bandeira"),
               cartao_token=r.get("creditCardToken") or ass.get("cartao_token"), cartao_trocado_em=now_utc())
    await controle.empresas.update_one({"id": e["id"]}, {"$set": {"assinatura": ass}})
    logger.info("cartão trocado: empresa %s por %s", e.get("slug"), principal.email)
    return {"ok": True, "assinatura": resumo_publico(ass)}


class MudarPlano(BaseModel):
    plano: str
    periodicidade: str = "mensal"


@router.post("/plano")
async def mudar_plano(input: MudarPlano, principal: Principal = Depends(require("assinatura_plataforma:manage"))):
    await carregar_catalogo()
    e = await _empresa(principal)
    ass = dict(e.get("assinatura") or {})
    if not ass:
        raise HTTPException(409, "O plano desta empresa é negociado pelo comercial. Fale com o suporte.")
    seg = segmento_de(e)
    novo = PLANOS.get(input.plano)
    if not novo or not novo.get("ativo", True) or (novo.get("segmento") or "imobiliaria") != seg:
        raise HTTPException(422, "Escolha um plano do seu segmento.")
    if input.periodicidade not in ("mensal", "anual"):
        raise HTTPException(422, "Escolha mensal ou anual.")
    uso = await uso_atual()
    for campo, rotulo in (("usuarios", "usuários ativos"), ("imoveis", "itens no estoque"), ("unidades", "unidades")):
        limite = novo.get(campo)
        if limite is not None and uso.get(campo, 0) > limite:
            raise HTTPException(409, f"O plano {novo['nome']} permite {limite} {rotulo} e vocês têm {uso[campo]}. Ajuste antes de trocar.")
    valor = float(novo["preco_anual"]) if input.periodicidade == "anual" and novo.get("preco_anual") is not None else \
        float(novo.get("preco_mensal") or 0) * (12 if input.periodicidade == "anual" else 1)
    if not ass.get("demo"):
        try:
            await asaas.atualizar_assinatura(assinatura_id=ass["asaas_assinatura_id"], valor=valor, ciclo=input.periodicidade,
                                             descricao=f"SAX CRM {info(seg)['nome']}, plano {novo['nome']} ({input.periodicidade})")
        except asaas.ErroAsaas as err:
            raise asaas.http(err)
    ass.update(plano=input.plano, periodicidade=input.periodicidade, valor=round(valor, 2))
    comercial = dict(e.get("comercial") or {})
    comercial["periodicidade"] = input.periodicidade
    await controle.empresas.update_one({"id": e["id"]}, {"$set": {
        "plano": input.plano, "plano_aplicado": True, "modulos": list(novo["modulos"]), "assinatura": ass,
        "comercial": comercial, "updated_at": now_utc()}})
    logger.info("plano trocado: empresa %s -> %s (%s)", e.get("slug"), input.plano, input.periodicidade)
    return {"ok": True}


@router.post("/cancelar")
async def cancelar(principal: Principal = Depends(require("assinatura_plataforma:manage"))):
    e = await _empresa(principal)
    ass = dict(e.get("assinatura") or {})
    if not ass:
        raise HTTPException(409, "O contrato desta empresa é pelo comercial. Fale com o suporte para cancelar.")
    if ass.get("status") == "cancelada":
        return {"ok": True, "assinatura": resumo_publico(ass)}
    if not ass.get("demo") and ass.get("asaas_assinatura_id"):
        try:
            await asaas.cancelar_assinatura(ass["asaas_assinatura_id"])
        except asaas.ErroAsaas as err:
            raise asaas.http(err)
    ass.update(status="cancelada", cancelada_em=now_utc(), cancelada_por=principal.email,
               acesso_ate=ass.get("proximo_vencimento") or datetime.now(timezone.utc).date().isoformat())
    await controle.empresas.update_one({"id": e["id"]}, {"$set": {"assinatura": ass, "updated_at": now_utc()}})
    logger.info("assinatura cancelada: empresa %s por %s", e.get("slug"), principal.email)
    return {"ok": True, "assinatura": resumo_publico(ass)}
