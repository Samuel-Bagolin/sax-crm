"""Single-use access activation, with no plaintext passwords in email."""
import hashlib
import os
import secrets
from datetime import timedelta
from html import escape
from fastapi import HTTPException
from lib.email import send_email
from models.common import now_utc


def app_url():
    url = os.environ.get("APP_URL", "").rstrip("/")
    if not url.startswith("https://"):
        raise HTTPException(503, "Configure APP_URL HTTPS para enviar convites")
    return url


async def invite(bank, user: dict, company_name: str):
    base_url = app_url()
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    await bank.usuarios.update_one({"id": user["id"]}, {"$set": {
        "activation_digest": digest, "activation_expires": now_utc() + timedelta(hours=24)}})
    url = base_url + "/ativar-acesso#token=" + token
    # Existing password/session remain valid until the one-time link is consumed.
    await send_email(to=user["email"], subject=f"Ative seu acesso — {company_name}",
        html=f"<p>Olá {escape(user['nome'])}.</p><p><a href='{url}'>Definir senha de acesso</a></p><p>O link é de uso único e vence em 24 horas.</p>")
    return True
