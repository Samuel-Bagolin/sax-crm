"""Envio de e-mail transacional pelo Resend (RESEND_API_KEY + EMAIL_FROM).

Compatível com a integração antiga da Emergent (EMERGENT_EMAIL_KEY) se o Resend não estiver configurado.

Destinatários vêm SEMPRE de registros do banco e o corpo de templates do servidor —
nenhuma rota aceita destinatário/assunto/HTML do chamador (G4).
"""

import ipaddress
import logging
import os
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()
logger = logging.getLogger(__name__)

# Proxy gerenciado da Emergent (legado) e API do Resend.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
RESEND_URL = os.environ.get("RESEND_API_URL", "https://api.resend.com/emails")
SERVERLESS = bool(os.environ.get("VERCEL"))


def _cfg(nome: str) -> str:
    valor = os.environ.get(nome)
    if not valor:
        raise HTTPException(status_code=503, detail=f"{nome} não configurado nas variáveis de ambiente")
    return valor


_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
# Termos curtos que não podem aparecer nem por acidente (ex.: dentro de uma senha gerada).
TERMOS_BLOQUEADOS = tuple(t for t in _CRED_ASK if len(t) <= 12)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def _remetente() -> tuple[str, str | None]:
    """Nome do remetente e reply-to vêm do configurador do sistema; .env é só fallback."""
    try:
        from lib.db import db  # import local: evita ciclo com os routers

        doc = await db.configuracoes.find_one({"id": "singleton"})
    except Exception:
        doc = None
    nome = (doc or {}).get("email_remetente_nome") or os.environ.get("EMAIL_FROM_NAME") or "SAX CRM"
    resposta = (doc or {}).get("email_resposta") or os.environ.get("EMAIL_REPLY_TO")
    return nome, resposta


async def _deliver(*, to: str, subject: str, html: str, delivery_key: str) -> str | None:
    _assert_safe_email(subject, html)  # gate G2/G3 — nunca pular
    from_name, reply_to = await _remetente()
    if os.environ.get("RESEND_API_KEY"):
        return await _deliver_resend(to=to, subject=subject, html=html, delivery_key=delivery_key, from_name=from_name, reply_to=reply_to)
    payload = {
        "to": [to],
        "subject": subject,
        "html": html,
        "from_name": from_name,
    }
    if reply_to:
        payload["contact_email"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": _cfg("EMERGENT_EMAIL_KEY"), "Idempotency-Key": delivery_key},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("Email provider failed: %s", e.response.status_code)
        raise HTTPException(status_code=502, detail="Falha ao enviar o e-mail")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Email delivery uncertain: %s", type(e).__name__)
        raise HTTPException(status_code=500, detail="Falha ao enviar o e-mail")


async def _deliver_resend(*, to: str, subject: str, html: str, delivery_key: str, from_name: str, reply_to: str | None) -> str | None:
    remetente = os.environ.get("EMAIL_FROM") or "onboarding@resend.dev"
    nome = re.sub(r"[<>\"\r\n]", "", from_name)[:80] or "SAX CRM"
    payload = {"from": f"{nome} <{remetente}>", "to": [to], "subject": subject, "html": html}
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(RESEND_URL, json=payload, headers={
                "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}", "Idempotency-Key": delivery_key[:256]})
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("Resend recusou o envio: %s %s", e.response.status_code, e.response.text[:200])
        raise HTTPException(status_code=502, detail="Falha ao enviar o e-mail")
    except Exception as e:
        logger.error("Envio de e-mail incerto: %s", type(e).__name__)
        raise HTTPException(status_code=500, detail="Falha ao enviar o e-mail")


async def drenar_fila(bank, limite: int = 25) -> int:
    """Uma passada na fila de e-mails de um banco. Retorna quantos foram enviados."""
    from datetime import timedelta
    from pymongo import ReturnDocument
    from models.common import now_utc

    enviados = 0
    # Processo morreu no meio do envio: não reenviar automaticamente uma segunda cópia.
    await bank.mail_jobs.update_many({"status": "sending", "lease_until": {"$lt": now_utc()}}, {"$set": {"status": "uncertain"}})
    for _ in range(limite):
        job = await bank.mail_jobs.find_one_and_update({"status": "queued", "retry_at": {"$lte": now_utc()}},
            {"$set": {"status": "sending", "lease_until": now_utc() + timedelta(minutes=2)}}, return_document=ReturnDocument.AFTER)
        if not job:
            break
        try:
            result = await _deliver(to=job["to"], subject=job["subject"], html=job["html"], delivery_key=job["_id"])
            await bank.mail_jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "sent", "sent_at": now_utc(), "provider_id": result}, "$unset": {"html": ""}})
            enviados += 1
        except Exception as exc:
            await bank.mail_jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "uncertain", "error_type": type(exc).__name__}})
    return enviados


def email_configurado() -> bool:
    """Há um provedor de e-mail configurado (Resend ou a integração antiga)?"""
    return bool((os.environ.get("RESEND_API_KEY") and os.environ.get("EMAIL_FROM")) or os.environ.get("EMERGENT_EMAIL_KEY"))


async def send_email(*, to: str, subject: str, html: str) -> str:
    import hashlib, json
    from lib.db import db
    from models.common import now_utc
    _assert_safe_email(subject, html)
    payload = {"to": to, "subject": subject, "html": html}
    key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    await db.mail_jobs.update_one({"_id": key}, {"$setOnInsert": {**payload, "status": "queued", "created_at": now_utc(), "retry_at": now_utc() }}, upsert=True)
    if SERVERLESS:
        # Sem processo contínuo (Vercel): entrega agora; a rotina agendada recolhe o que falhar.
        try:
            await drenar_fila(db, limite=3)
        except Exception:
            logger.exception("envio imediato falhou; fica na fila")
    return key


async def mail_worker():
    import asyncio
    from lib.db import client, controle, definir_empresa
    while True:
        try:
            banks = [controle.name]
            async for company in controle.empresas.find({"ativo": True}): banks.append(company["db_name"])
            for name in banks:
                definir_empresa(name if name != controle.name else None)
                await drenar_fila(client[name])
            definir_empresa(None)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Mail worker iteration failed")
        await asyncio.sleep(10)
