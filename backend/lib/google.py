"""Cliente mínimo das APIs do Google (OAuth 2.0, Calendar v3, Drive v3) via httpx.

Cada usuário conecta a PRÓPRIA conta Google. O refresh token fica cifrado (Fernet) no banco da
empresa; o access token é renovado sob demanda. Escopos mínimos:
- calendar.events  → criar/editar/apagar os eventos que o CRM sincroniza
- calendar.freebusy → mostrar "ocupado" da agenda pessoal para o gestor (sem títulos)
- calendar.readonly → o próprio usuário ver os compromissos do Google dentro do CRM
- drive.file       → só arquivos criados pelo CRM ou escolhidos pelo usuário no seletor do Drive
"""

import base64
import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from lib.db import db
from models.common import now_utc, utc_aware

logger = logging.getLogger(__name__)

ESCOPOS = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.file",
]

# Endereços configuráveis só para testes locais (servidor simulado); em produção use os padrões.
AUTH_URL = os.environ.get("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")
TOKEN_URL = os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
REVOKE_URL = os.environ.get("GOOGLE_REVOKE_URL", "https://oauth2.googleapis.com/revoke")
API = os.environ.get("GOOGLE_API_BASE", "https://www.googleapis.com")
UPLOAD = os.environ.get("GOOGLE_UPLOAD_BASE", "https://www.googleapis.com/upload")
USERINFO_URL = os.environ.get("GOOGLE_USERINFO_URL", "https://openidconnect.googleapis.com/v1/userinfo")


def configurado() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def _exigir_config():
    if not configurado():
        raise HTTPException(503, "Integração Google não configurada: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET")


def redirect_uri() -> str:
    base = os.environ.get("GOOGLE_REDIRECT_BASE") or os.environ.get("APP_URL", "")
    if not base:
        raise HTTPException(503, "Configure APP_URL para a integração Google")
    return base.rstrip("/") + "/api/google/callback"


def _fernet() -> Fernet:
    chave = os.environ.get("GOOGLE_TOKEN_KEY")
    if not chave:
        # Deriva de JWT_SECRET para não exigir mais um segredo; troque por GOOGLE_TOKEN_KEY em produção.
        segredo = os.environ.get("JWT_SECRET", "")
        if not segredo:
            raise HTTPException(503, "JWT_SECRET ausente")
        chave = base64.urlsafe_b64encode(hashlib.sha256(("google:" + segredo).encode()).digest()).decode()
    return Fernet(chave.encode())


def cifrar(texto: str) -> str:
    return _fernet().encrypt(texto.encode()).decode()


def decifrar(texto: str) -> str:
    try:
        return _fernet().decrypt(texto.encode()).decode()
    except InvalidToken:
        raise HTTPException(409, "Conexão Google inválida: conecte a conta novamente")


def url_autorizacao(state: str, email_sugerido: str | None = None) -> str:
    _exigir_config()
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(ESCOPOS),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    if email_sugerido:
        params["login_hint"] = email_sugerido
    return AUTH_URL + "?" + urlencode(params)


async def trocar_codigo(code: str) -> dict:
    _exigir_config()
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(TOKEN_URL, data={
            "code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": redirect_uri(), "grant_type": "authorization_code",
        })
        if r.status_code != 200:
            logger.error("google token exchange %s", r.status_code)
            raise HTTPException(502, "O Google recusou a autorização. Tente conectar de novo.")
        tok = r.json()
        info = await c.get(USERINFO_URL, headers={"Authorization": f"Bearer {tok['access_token']}"})
        tok["email"] = info.json().get("email") if info.status_code == 200 else None
    return tok


async def conta(usuario_id: str) -> dict | None:
    return await db.google_contas.find_one({"usuario_id": usuario_id})


async def salvar_conta(usuario_id: str, tok: dict) -> None:
    atual = await conta(usuario_id)
    refresh = tok.get("refresh_token")
    if not refresh and not atual:
        raise HTTPException(502, "O Google não devolveu acesso permanente. Remova o acesso do app na sua conta Google e conecte de novo.")
    dados = {
        "usuario_id": usuario_id,
        "email": tok.get("email") or (atual or {}).get("email"),
        "access_token": cifrar(tok["access_token"]),
        "expira_em": now_utc() + timedelta(seconds=int(tok.get("expires_in", 3600)) - 60),
        "escopos": tok.get("scope", " ".join(ESCOPOS)),
        "atualizado_em": now_utc(),
    }
    if refresh:
        dados["refresh_token"] = cifrar(refresh)
    await db.google_contas.update_one(
        {"usuario_id": usuario_id},
        {"$set": dados, "$setOnInsert": {"conectado_em": now_utc(), "sync_agenda": True, "mostrar_agenda": True}},
        upsert=True,
    )


async def token_valido(usuario_id: str) -> str | None:
    """Access token válido do usuário (renova se preciso). None se não conectado."""
    doc = await conta(usuario_id)
    if not doc:
        return None
    if utc_aware(doc.get("expira_em")) and utc_aware(doc["expira_em"]) > now_utc():
        return decifrar(doc["access_token"])
    _exigir_config()
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(TOKEN_URL, data={
            "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": decifrar(doc["refresh_token"]), "grant_type": "refresh_token",
        })
    if r.status_code != 200:
        # Acesso revogado pelo usuário no Google: marca para reconectar, sem quebrar o CRM.
        await db.google_contas.update_one({"usuario_id": usuario_id}, {"$set": {"erro": "Acesso revogado ou expirado. Conecte novamente."}})
        return None
    tok = r.json()
    await db.google_contas.update_one({"usuario_id": usuario_id}, {"$set": {
        "access_token": cifrar(tok["access_token"]),
        "expira_em": now_utc() + timedelta(seconds=int(tok.get("expires_in", 3600)) - 60), "erro": None}})
    return tok["access_token"]


async def revogar(usuario_id: str) -> None:
    doc = await conta(usuario_id)
    if not doc:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(REVOKE_URL, params={"token": decifrar(doc["refresh_token"])})
    except Exception:
        logger.warning("revogação Google falhou; removendo conexão local mesmo assim")
    await db.google_contas.delete_one({"usuario_id": usuario_id})


async def chamar(usuario_id: str, metodo: str, url: str, **kw) -> httpx.Response:
    token = await token_valido(usuario_id)
    if not token:
        raise HTTPException(409, "Conta Google não conectada")
    headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.request(metodo, url, headers=headers, **kw)
    if r.status_code == 401:
        await db.google_contas.update_one({"usuario_id": usuario_id}, {"$set": {"expira_em": now_utc() - timedelta(seconds=1)}})
    return r


# ------------------------------------------------------------------ Calendar

TZ = os.environ.get("APP_TZ", "America/Sao_Paulo")


def evento_de(titulo: str, data: str, hora: str | None, duracao_min: int, descricao: str, local: str | None, origem_id: str) -> dict:
    corpo: dict = {
        "summary": titulo[:250],
        "description": descricao[:3000],
        "extendedProperties": {"private": {"crm_origem": origem_id}},
        "source": {"title": "SAX CRM", "url": (os.environ.get("APP_URL") or "https://sax.crm").rstrip("/") + "/agenda"},
        "reminders": {"useDefault": True},
    }
    if local:
        corpo["location"] = local[:500]
    if hora:
        ini = datetime.fromisoformat(f"{data}T{hora}:00")
        fim = ini + timedelta(minutes=duracao_min)
        corpo["start"] = {"dateTime": ini.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": TZ}
        corpo["end"] = {"dateTime": fim.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": TZ}
    else:
        dia = datetime.fromisoformat(data)
        corpo["start"] = {"date": data}
        corpo["end"] = {"date": (dia + timedelta(days=1)).strftime("%Y-%m-%d")}
    return corpo


async def salvar_evento(usuario_id: str, evento_id: str | None, corpo: dict) -> str | None:
    base = f"{API}/calendar/v3/calendars/primary/events"
    if evento_id:
        r = await chamar(usuario_id, "PATCH", f"{base}/{evento_id}", json=corpo)
        if r.status_code in (404, 410):
            evento_id = None
        elif r.status_code < 300:
            return evento_id
    if not evento_id:
        r = await chamar(usuario_id, "POST", base, json=corpo)
        if r.status_code < 300:
            return r.json().get("id")
    logger.error("google calendar %s %s", r.status_code, r.text[:200])
    raise HTTPException(502, "Google Agenda recusou o evento")


async def apagar_evento(usuario_id: str, evento_id: str) -> None:
    r = await chamar(usuario_id, "DELETE", f"{API}/calendar/v3/calendars/primary/events/{evento_id}")
    if r.status_code not in (200, 204, 404, 410):
        logger.error("google calendar delete %s", r.status_code)


async def listar_eventos(usuario_id: str, inicio: str, fim: str) -> list[dict]:
    params = {
        "timeMin": f"{inicio}T00:00:00-03:00", "timeMax": f"{fim}T23:59:59-03:00", "singleEvents": "true",
        "orderBy": "startTime", "maxResults": "250", "timeZone": TZ,
    }
    r = await chamar(usuario_id, "GET", f"{API}/calendar/v3/calendars/primary/events", params=params)
    if r.status_code >= 300:
        raise HTTPException(502, "Não foi possível ler o Google Agenda")
    return r.json().get("items", [])


async def ocupado(usuario_id: str, inicio: str, fim: str) -> list[dict]:
    corpo = {"timeMin": f"{inicio}T00:00:00-03:00", "timeMax": f"{fim}T23:59:59-03:00", "timeZone": TZ, "items": [{"id": "primary"}]}
    r = await chamar(usuario_id, "POST", f"{API}/calendar/v3/freeBusy", json=corpo)
    if r.status_code >= 300:
        return []
    return r.json().get("calendars", {}).get("primary", {}).get("busy", [])


# ------------------------------------------------------------------ Drive

async def pasta(usuario_id: str, nome: str, pai: str | None = None) -> str:
    """Cria (ou reaproveita) uma pasta criada pelo CRM. drive.file só enxerga o que o app criou."""
    q = f"mimeType='application/vnd.google-apps.folder' and name='{nome.replace(chr(39), ' ')}' and trashed=false"
    if pai:
        q += f" and '{pai}' in parents"
    r = await chamar(usuario_id, "GET", f"{API}/drive/v3/files", params={"q": q, "fields": "files(id,name)", "spaces": "drive"})
    if r.status_code < 300 and r.json().get("files"):
        return r.json()["files"][0]["id"]
    corpo = {"name": nome, "mimeType": "application/vnd.google-apps.folder"}
    if pai:
        corpo["parents"] = [pai]
    r = await chamar(usuario_id, "POST", f"{API}/drive/v3/files", json=corpo, params={"fields": "id"})
    if r.status_code >= 300:
        raise HTTPException(502, "Não foi possível criar a pasta no Google Drive")
    return r.json()["id"]


async def enviar_arquivo(usuario_id: str, nome: str, mime: str, conteudo: bytes, pasta_id: str | None) -> dict:
    meta = {"name": nome}
    if pasta_id:
        meta["parents"] = [pasta_id]
    limite = "sax_crm_limite_8f2b"
    corpo = (
        f"--{limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
        f"--{limite}\r\nContent-Type: {mime}\r\n\r\n"
    ).encode() + conteudo + f"\r\n--{limite}--".encode()
    r = await chamar(usuario_id, "POST", f"{UPLOAD}/drive/v3/files", content=corpo,
                     params={"uploadType": "multipart", "fields": "id,name,mimeType,size,webViewLink,iconLink"},
                     headers={"Content-Type": f"multipart/related; boundary={limite}"})
    if r.status_code >= 300:
        logger.error("drive upload %s %s", r.status_code, r.text[:200])
        raise HTTPException(502, "O Google Drive recusou o arquivo")
    return r.json()


async def metadados(usuario_id: str, file_id: str) -> dict:
    r = await chamar(usuario_id, "GET", f"{API}/drive/v3/files/{file_id}", params={"fields": "id,name,mimeType,size,webViewLink,iconLink"})
    if r.status_code >= 300:
        raise HTTPException(404, "Arquivo do Drive não encontrado ou sem permissão")
    return r.json()


async def compartilhar(usuario_id: str, file_id: str, email: str, mensagem: str) -> None:
    r = await chamar(usuario_id, "POST", f"{API}/drive/v3/files/{file_id}/permissions",
                     params={"sendNotificationEmail": "true", "emailMessage": mensagem[:900]},
                     json={"type": "user", "role": "reader", "emailAddress": email})
    if r.status_code >= 300:
        logger.error("drive share %s %s", r.status_code, r.text[:200])
        raise HTTPException(502, "O Google Drive não permitiu compartilhar este arquivo")


async def baixar(usuario_id: str, file_id: str) -> bytes:
    r = await chamar(usuario_id, "GET", f"{API}/drive/v3/files/{file_id}", params={"alt": "media"})
    if r.status_code >= 300:
        raise HTTPException(502, "Não foi possível baixar do Google Drive")
    return r.content
