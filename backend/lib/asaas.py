"""Cliente do Asaas (cobrança recorrente da assinatura da plataforma).

Regras de segurança do cartão:
- O número do cartão e o CVV só existem na memória deste request, a caminho do Asaas. Não gravamos,
  não registramos em log e não devolvemos em mensagens de erro.
- Guardamos só o que o Asaas devolve: final do cartão, bandeira e o token do cartão.
- A chave de API fica no banco de controle (tela de pagamentos do administrador de sistema) ou na
  variável de ambiente ASAAS_API_KEY, que vence. Nunca vai para o navegador.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import date

import httpx
from fastapi import HTTPException

from lib.db import controle

logger = logging.getLogger(__name__)

URLS = {"producao": "https://api.asaas.com/v3", "sandbox": "https://api-sandbox.asaas.com/v3"}
DOC_CONFIG = "pagamentos"
TIMEOUT = httpx.Timeout(60.0, connect=10.0)  # o Asaas pede pelo menos 60 s na criação da assinatura


async def config() -> dict:
    doc = await controle.plataforma.find_one({"_id": DOC_CONFIG}) or {}
    chave = os.environ.get("ASAAS_API_KEY") or doc.get("asaas_api_key")
    ambiente = os.environ.get("ASAAS_AMBIENTE") or doc.get("ambiente") or "sandbox"
    return {**doc, "chave": chave, "ambiente": ambiente if ambiente in URLS else "sandbox", "chave_por_env": bool(os.environ.get("ASAAS_API_KEY"))}


async def garantir_webhook_token() -> str:
    doc = await controle.plataforma.find_one({"_id": DOC_CONFIG}) or {}
    if doc.get("webhook_token"):
        return doc["webhook_token"]
    token = "whk_" + secrets.token_urlsafe(32)
    await controle.plataforma.update_one({"_id": DOC_CONFIG}, {"$set": {"webhook_token": token}}, upsert=True)
    return token


class ErroAsaas(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem


def _mensagem(resp: httpx.Response) -> str:
    try:
        erros = resp.json().get("errors") or []
        textos = [str(e.get("description") or "").strip() for e in erros if e.get("description")]
        if textos:
            return " ".join(textos)[:300]
    except Exception:
        pass
    return "O processador de pagamento recusou a operação."


async def _chamar(metodo: str, caminho: str, corpo: dict | None = None) -> dict:
    cfg = await config()
    if not cfg["chave"]:
        raise ErroAsaas(503, "Pagamento online ainda não configurado. Fale com o suporte.")
    url = URLS[cfg["ambiente"]] + caminho
    headers = {"access_token": cfg["chave"], "Content-Type": "application/json", "User-Agent": "SAX-CRM"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cli:
            resp = await cli.request(metodo, url, json=corpo, headers=headers)
    except httpx.HTTPError as e:
        # Sem o corpo: ele pode ter dados do cartão.
        logger.warning("asaas %s %s falhou: %s", metodo, caminho, type(e).__name__)
        raise ErroAsaas(504, "O processador de pagamento não respondeu. Nenhuma cobrança foi confirmada; tente de novo em instantes.")
    if resp.status_code >= 400:
        logger.info("asaas %s %s -> %s", metodo, caminho, resp.status_code)
        raise ErroAsaas(402 if resp.status_code in (400, 402) else 502, _mensagem(resp))
    return resp.json() if resp.content else {}


async def criar_cliente(*, nome: str, cpf_cnpj: str, email: str, telefone: str, cep: str, numero: str, referencia: str) -> dict:
    return await _chamar("POST", "/customers", {
        "name": nome, "cpfCnpj": cpf_cnpj, "email": email, "mobilePhone": telefone,
        "postalCode": cep, "addressNumber": numero, "externalReference": referencia, "notificationDisabled": False,
    })


def _cartao(c: dict) -> dict:
    return {"holderName": c["nome"], "number": c["numero"], "expiryMonth": c["mes"], "expiryYear": c["ano"], "ccv": c["cvv"]}


def _titular(t: dict) -> dict:
    return {"name": t["nome"], "email": t["email"], "cpfCnpj": t["cpf_cnpj"], "postalCode": t["cep"],
            "addressNumber": t["numero"], "phone": t["telefone"], "mobilePhone": t["telefone"]}


async def criar_assinatura(*, cliente_id: str, valor: float, ciclo: str, descricao: str, cartao: dict, titular: dict,
                           ip: str, referencia: str) -> dict:
    return await _chamar("POST", "/subscriptions", {
        "customer": cliente_id, "billingType": "CREDIT_CARD", "value": round(valor, 2),
        "nextDueDate": date.today().isoformat(), "cycle": "YEARLY" if ciclo == "anual" else "MONTHLY",
        "description": descricao[:500], "externalReference": referencia,
        "creditCard": _cartao(cartao), "creditCardHolderInfo": _titular(titular), "remoteIp": ip,
    })


async def trocar_cartao(*, assinatura_id: str, cartao: dict, titular: dict, ip: str) -> dict:
    return await _chamar("PUT", f"/subscriptions/{assinatura_id}/creditCard", {
        "creditCard": _cartao(cartao), "creditCardHolderInfo": _titular(titular), "remoteIp": ip,
    })


async def atualizar_assinatura(*, assinatura_id: str, valor: float, ciclo: str, descricao: str) -> dict:
    return await _chamar("PUT", f"/subscriptions/{assinatura_id}", {
        "value": round(valor, 2), "cycle": "YEARLY" if ciclo == "anual" else "MONTHLY",
        "description": descricao[:500], "updatePendingPayments": True,
    })


async def cancelar_assinatura(assinatura_id: str) -> None:
    await _chamar("DELETE", f"/subscriptions/{assinatura_id}")


async def cobrancas(assinatura_id: str) -> list[dict]:
    r = await _chamar("GET", f"/subscriptions/{assinatura_id}/payments?limit=24")
    return r.get("data") or []


async def testar() -> dict:
    return await _chamar("GET", "/finance/balance")


def http(e: ErroAsaas) -> HTTPException:
    return HTTPException(e.status, e.mensagem)
