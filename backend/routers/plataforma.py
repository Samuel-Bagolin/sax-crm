"""Administração da plataforma (Administrador de Sistema): pagamentos, cartão de demonstração,
painel de empresas por segmento e webhook do Asaas."""

import hmac
import logging
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from lib import asaas
from lib.assinatura import bloqueio, gerar_numero_demo
from lib.auth import Principal, require
from lib.db import controle
from lib.planos import carregar_catalogo, plano_de, valores_comerciais
from lib.segmentos import CATEGORIAS, SEGMENTOS, segmento_de
from models.common import now_utc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plataforma", tags=["plataforma"])
webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class PagamentosIn(BaseModel):
    asaas_api_key: str | None = Field(default=None, max_length=300)  # vazio = mantém a atual
    ambiente: str = "sandbox"
    remover_chave: bool = False


def _mascarar(chave: str | None) -> str | None:
    if not chave:
        return None
    return chave[:6] + "…" + chave[-4:] if len(chave) > 12 else "…"


async def _painel_pagamentos() -> dict:
    cfg = await asaas.config()
    token = await asaas.garantir_webhook_token()
    import os

    base = os.environ.get("APP_URL", "").rstrip("/")
    return {
        "configurado": bool(cfg["chave"]), "chave_mascarada": _mascarar(cfg["chave"]), "chave_por_env": cfg["chave_por_env"],
        "ambiente": cfg["ambiente"], "webhook_url": f"{base}/api/webhooks/asaas" if base else "/api/webhooks/asaas",
        "webhook_token": token, "cartao_demo": cfg.get("cartao_demo"), "cartao_demo_ativo": bool(cfg.get("cartao_demo_ativo", True)) and bool(cfg.get("cartao_demo")),
    }


@router.get("/pagamentos")
async def ver_pagamentos(principal: Principal = Depends(require("empresa:manage"))):
    return await _painel_pagamentos()


@router.put("/pagamentos")
async def salvar_pagamentos(input: PagamentosIn, principal: Principal = Depends(require("empresa:manage"))):
    if input.ambiente not in asaas.URLS:
        raise HTTPException(422, "Ambiente inválido")
    dados: dict = {"ambiente": input.ambiente, "atualizado_em": now_utc(), "atualizado_por": principal.email}
    if input.remover_chave:
        dados["asaas_api_key"] = None
    elif input.asaas_api_key and input.asaas_api_key.strip():
        chave = input.asaas_api_key.strip()
        if not chave.startswith("$aact_"):
            raise HTTPException(422, "Chave do Asaas inválida. Ela começa com $aact_ (Integrações > Chaves de API no Asaas).")
        dados["asaas_api_key"] = chave
    await controle.plataforma.update_one({"_id": asaas.DOC_CONFIG}, {"$set": dados}, upsert=True)
    logger.info("pagamentos atualizados por %s (ambiente %s)", principal.email, input.ambiente)
    return await _painel_pagamentos()


@router.post("/pagamentos/testar")
async def testar_pagamentos(principal: Principal = Depends(require("empresa:manage"))):
    try:
        saldo = await asaas.testar()
    except asaas.ErroAsaas as e:
        raise asaas.http(e)
    return {"ok": True, "saldo": saldo.get("balance")}


@router.post("/cartao-demo")
async def gerar_cartao_demo(principal: Principal = Depends(require("empresa:manage"))):
    """Gera (ou troca) o cartão de demonstração. O anterior deixa de funcionar na hora."""
    numero = gerar_numero_demo()
    await controle.plataforma.update_one({"_id": asaas.DOC_CONFIG}, {"$set": {
        "cartao_demo": numero, "cartao_demo_ativo": True, "cartao_demo_em": now_utc(), "cartao_demo_por": principal.email}}, upsert=True)
    logger.info("cartão de demonstração trocado por %s", principal.email)
    return await _painel_pagamentos()


@router.put("/cartao-demo")
async def ativar_cartao_demo(ativo: bool, principal: Principal = Depends(require("empresa:manage"))):
    await controle.plataforma.update_one({"_id": asaas.DOC_CONFIG}, {"$set": {"cartao_demo_ativo": ativo}}, upsert=True)
    return await _painel_pagamentos()


# ------------------------------------------------------------------ painel por segmento


@router.get("/painel")
async def painel(principal: Principal = Depends(require("empresa:manage"))):
    """Quantas empresas por categoria e segmento, quantas pagando, em demonstração, em atraso, e a receita mensal."""
    await carregar_catalogo()
    por_seg: dict[str, dict] = {k: {"segmento": k, "nome": v["nome"], "categoria": v["categoria"], "ativas": 0, "pagantes": 0,
                                    "demonstracao": 0, "atrasadas": 0, "bloqueadas": 0, "inativas": 0, "mrr": 0.0, "novas_30d": 0}
                                for k, v in SEGMENTOS.items()}
    agora = datetime.now(timezone.utc)
    async for e in controle.empresas.find({}):
        s = por_seg[segmento_de(e)]
        if not e.get("ativo", True):
            s["inativas"] += 1
            continue
        s["ativas"] += 1
        criada = e.get("created_at")
        if isinstance(criada, datetime) and (agora - (criada if criada.tzinfo else criada.replace(tzinfo=timezone.utc))).days <= 30:
            s["novas_30d"] += 1
        ass = e.get("assinatura") or {}
        if ass.get("demo"):
            s["demonstracao"] += 1
            continue
        if bloqueio(ass):
            s["bloqueadas"] += 1
        elif ass.get("status") == "atrasada":
            s["atrasadas"] += 1
        valores = valores_comerciais(e) if e.get("plano_aplicado") else None
        if valores and ass.get("status") != "cancelada":
            s["pagantes"] += 1
            s["mrr"] += float(valores["equivalente_mensal"] or 0)
    categorias = []
    for ck, cn in CATEGORIAS.items():
        segs = [v for v in por_seg.values() if v["categoria"] == ck]
        for v in segs:
            v["mrr"] = round(v["mrr"], 2)
        categorias.append({"categoria": ck, "nome": cn, "segmentos": segs,
                           "ativas": sum(v["ativas"] for v in segs), "mrr": round(sum(v["mrr"] for v in segs), 2)})
    pendentes = await controle.cadastros.find({"status": {"$in": ["pago_sem_conta", "cancelado_apos_falha"]}}).to_list(50)
    return {"categorias": categorias, "total_ativas": sum(c["ativas"] for c in categorias),
            "mrr_total": round(sum(c["mrr"] for c in categorias), 2),
            "cadastros_com_problema": [{"protocolo": p["_id"][:8], "email": p.get("email"), "status": p["status"],
                                        "segmento": p.get("segmento"), "em": p.get("em")} for p in pendentes]}


# ------------------------------------------------------------------ webhook do Asaas


def _data(v) -> str | None:
    return str(v)[:10] if v else None


@webhook_router.post("/asaas")
async def webhook_asaas(request: Request):
    """Recebe eventos de cobrança. Autenticado pelo token no cabeçalho asaas-access-token.

    O id do evento só é registrado depois do processamento: se algo falhar no meio, o reenvio do
    Asaas é processado de novo. As gravações mexem só nos campos da assinatura que mudaram, para
    não desfazer uma troca de cartão ou cancelamento feitos ao mesmo tempo pela tela."""
    token = await asaas.garantir_webhook_token()
    if not hmac.compare_digest(request.headers.get("asaas-access-token", ""), token):
        raise HTTPException(401, "Token inválido")
    try:
        evento = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")
    eid, tipo = str(evento.get("id") or ""), str(evento.get("event") or "")
    if eid and await controle.asaas_eventos.find_one({"_id": eid}, {"_id": 1}):
        return {"ok": True, "duplicado": True}  # o Asaas entrega "pelo menos uma vez"
    pagamento = evento.get("payment") or {}
    assinatura_id = pagamento.get("subscription") or (evento.get("subscription") or {}).get("id")
    empresa = await controle.empresas.find_one({"asaas_assinatura_id": assinatura_id}) if assinatura_id else None
    resultado = {"ok": True}
    if not empresa:
        if assinatura_id:
            logger.warning("webhook asaas %s: assinatura %s sem empresa", tipo, assinatura_id)
        resultado["ignorado"] = True
    else:
        ass = empresa.get("assinatura") or {}
        if pagamento.get("id"):
            await controle.faturas.update_one({"_id": pagamento["id"]}, {"$set": {
                "_id": pagamento["id"], "empresa_id": empresa["id"], "valor": pagamento.get("value"), "status": pagamento.get("status"),
                "vencimento": _data(pagamento.get("dueDate")), "pago_em": _data(pagamento.get("confirmedDate") or pagamento.get("paymentDate")),
                "link": pagamento.get("invoiceUrl"), "atualizado_em": now_utc()}}, upsert=True)
        mudar: dict = {}
        venc = _data(pagamento.get("dueDate"))
        if tipo == "PAYMENT_CREATED" and venc and venc > (ass.get("proximo_vencimento") or ""):
            mudar["assinatura.proximo_vencimento"] = venc
        elif tipo in ("PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"):
            if venc:
                from datetime import date

                from routers.cadastro import somar_periodo

                prox = somar_periodo(date.fromisoformat(venc), ass.get("periodicidade") == "anual").isoformat()
                if prox > (ass.get("proximo_vencimento") or ""):
                    mudar["assinatura.proximo_vencimento"] = prox
            mudar["assinatura.ultimo_pagamento"] = _data(pagamento.get("confirmedDate") or pagamento.get("paymentDate"))
            if ass.get("status") != "cancelada":  # cobrança antiga paga não reativa assinatura cancelada
                mudar.update({"assinatura.status": "ativa", "assinatura.atraso_desde": None})
        elif tipo == "PAYMENT_OVERDUE" and ass.get("status") != "cancelada":
            mudar["assinatura.status"] = "atrasada"
            if ass.get("status") != "atrasada":
                mudar["assinatura.atraso_desde"] = now_utc()
        elif tipo in ("PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED") and ass.get("status") != "cancelada":
            mudar["assinatura.status"] = "atrasada"
            if not ass.get("atraso_desde"):
                mudar["assinatura.atraso_desde"] = now_utc()
        elif tipo in ("SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"):
            mudar["assinatura.status"] = "cancelada"
            if not ass.get("acesso_ate"):
                mudar["assinatura.acesso_ate"] = ass.get("proximo_vencimento")
        if mudar:
            mudar["updated_at"] = now_utc()
            await controle.empresas.update_one({"id": empresa["id"]}, {"$set": mudar})
            logger.info("webhook asaas %s: empresa %s atualizada", tipo, empresa.get("slug"))
    if eid:
        try:
            await controle.asaas_eventos.insert_one({"_id": eid, "evento": tipo, "em": now_utc()})
        except Exception:
            pass
    return resultado
