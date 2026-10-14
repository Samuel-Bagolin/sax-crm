"""WhatsApp no CRM pela Evolution API (conexão não oficial por QR code).

Por que um servidor à parte: o CRM roda no Vercel (funções que acordam e dormem) e não consegue manter
a conexão do WhatsApp aberta. A Evolution API roda num servidor próprio, segura a sessão de cada número
e avisa o CRM por webhook a cada mensagem. O CRM manda mensagem chamando a API dela.

- Servidor e chave global: Empresas > Pagamentos (banco de controle) ou EVOLUTION_URL / EVOLUTION_API_KEY.
- Cada número conectado é uma "instância" na Evolution. `controle.whatsapp_instancias` liga a instância
  ao banco da empresa e guarda o token do webhook (o webhook chega sem login e precisa achar a empresa).
- Risco do modelo não oficial: o WhatsApp pode bloquear números que disparam em massa. O CRM não faz
  disparo em massa; é atendimento um a um.
"""

from __future__ import annotations

import logging
import os
import re
import secrets

import httpx
from fastapi import HTTPException

from lib.db import controle

logger = logging.getLogger(__name__)

DOC = "whatsapp"
INDICE = "whatsapp_instancias"
EVENTOS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]

TIPOS_MIDIA = {
    "imageMessage": "Foto", "videoMessage": "Vídeo", "audioMessage": "Áudio", "documentMessage": "Documento",
    "stickerMessage": "Figurinha", "locationMessage": "Localização", "contactMessage": "Contato",
    "documentWithCaptionMessage": "Documento", "ptvMessage": "Vídeo",
}


class ErroWhatsApp(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem


async def config() -> dict:
    doc = await controle.plataforma.find_one({"_id": DOC}) or {}
    url = (os.environ.get("EVOLUTION_URL") or doc.get("url") or "").rstrip("/")
    chave = os.environ.get("EVOLUTION_API_KEY") or doc.get("apikey") or ""
    return {"url": url, "apikey": chave, "por_env": bool(os.environ.get("EVOLUTION_URL"))}


def configurado(cfg: dict) -> bool:
    return bool(cfg.get("url") and cfg.get("apikey"))


async def _cfg_ou_erro() -> dict:
    cfg = await config()
    if not configurado(cfg):
        raise HTTPException(503, "O servidor do WhatsApp ainda não foi configurado. Fale com o suporte do SAX.")
    return cfg


async def chamar(metodo: str, caminho: str, corpo: dict | None = None, cfg: dict | None = None, timeout: float = 25) -> dict:
    cfg = cfg or await _cfg_ou_erro()
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.request(metodo, cfg["url"] + caminho, json=corpo, headers={"apikey": cfg["apikey"]})
    except httpx.HTTPError as e:
        logger.warning("evolution %s %s: %s", metodo, caminho, type(e).__name__)
        raise ErroWhatsApp(503, "O servidor do WhatsApp não respondeu. Tente de novo em instantes.")
    try:
        dados = r.json()
    except ValueError:
        dados = {}
    # A Evolution às vezes responde 200 com {"error": true, "message": ...}.
    if r.status_code >= 400 or (isinstance(dados, dict) and dados.get("error") is True):
        msg = dados.get("response", {}).get("message") if isinstance(dados.get("response"), dict) else dados.get("message")
        if isinstance(msg, list):
            msg = msg[0] if msg else None
        logger.warning("evolution %s %s -> %s %s", metodo, caminho, r.status_code, str(msg)[:200])
        raise ErroWhatsApp(r.status_code, "O servidor do WhatsApp recusou o pedido." + (f" ({str(msg)[:120]})" if msg else ""))
    return dados if isinstance(dados, dict) else {"lista": dados}


def http(e: ErroWhatsApp) -> HTTPException:
    return HTTPException(502 if e.status >= 500 else 409, e.mensagem)


def nome_instancia(slug: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (slug or "empresa").lower()).strip("-")[:24] or "empresa"
    return f"sax-{base}-{secrets.token_hex(3)}"


async def criar_instancia(instancia: str, webhook_url: str, token: str) -> dict:
    corpo = {
        "instanceName": instancia, "qrcode": True, "integration": "WHATSAPP-BAILEYS",
        "webhook": {"enabled": True, "url": webhook_url, "byEvents": False, "base64": False,
                    "headers": {"x-sax-token": token}, "events": EVENTOS},
    }
    return await chamar("POST", "/instance/create", corpo)


async def qr(instancia: str) -> dict:
    """{'conectado': bool, 'qr': data-uri | None, 'codigo': str | None}"""
    r = await chamar("GET", f"/instance/connect/{instancia}")
    estado = ((r.get("instance") or {}).get("state")) if isinstance(r.get("instance"), dict) else None
    if estado == "open":
        return {"conectado": True, "qr": None, "codigo": None}
    b64 = r.get("base64") or (r.get("qrcode") or {}).get("base64")
    return {"conectado": False, "qr": b64, "codigo": r.get("pairingCode") or (r.get("qrcode") or {}).get("pairingCode")}


async def estado(instancia: str) -> str:
    r = await chamar("GET", f"/instance/connectionState/{instancia}")
    return ((r.get("instance") or {}).get("state")) or "close"


async def remover_instancia(instancia: str) -> None:
    for caminho in (f"/instance/logout/{instancia}", f"/instance/delete/{instancia}"):
        try:
            await chamar("DELETE", caminho)
        except (ErroWhatsApp, HTTPException):
            pass  # já desconectada ou já removida


def destino(jid: str) -> str:
    """Número para a Evolution: só dígitos quando é telefone; o jid inteiro nos outros casos (@lid)."""
    return jid.split("@")[0] if jid.endswith("@s.whatsapp.net") else jid


async def enviar_texto(instancia: str, jid: str, texto: str) -> str | None:
    r = await chamar("POST", f"/message/sendText/{instancia}", {"number": destino(jid), "text": texto})
    return ((r.get("key") or {}).get("id")) if isinstance(r.get("key"), dict) else None


MIDIA_TOCAVEL = {"imageMessage": "imagem", "stickerMessage": "imagem", "audioMessage": "audio", "videoMessage": "video",
                 "ptvMessage": "video", "documentMessage": "documento", "documentWithCaptionMessage": "documento"}
LIMITE_MIDIA = 4 * 1024 * 1024  # a resposta de função do Vercel aceita até ~4,5 MB


def midia_da_mensagem(msg: dict) -> dict | None:
    """Dados para baixar a mídia depois: tipo, mimetype, nome e a mensagem crua (sem miniatura)."""
    for chave, tipo in MIDIA_TOCAVEL.items():
        if chave not in (msg or {}):
            continue
        corpo = msg.get(chave) or {}
        if chave == "documentWithCaptionMessage":
            corpo = ((corpo.get("message") or {}).get("documentMessage")) or {}
            chave = "documentMessage"
        crua = {k: v for k, v in corpo.items() if k not in ("jpegThumbnail", "contextInfo", "thumbnailSha256", "waveform", "streamingSidecar")}
        return {"tipo": tipo, "mime": corpo.get("mimetype"), "nome": corpo.get("fileName"), "segundos": corpo.get("seconds"),
                "chave": chave, "crua": {chave: crua}}
    return None


async def baixar_midia(instancia: str, key: dict, crua: dict | None, converter_audio: bool) -> tuple[bytes, str]:
    """Pede o arquivo à Evolution. Com a mensagem crua ela baixa direto do WhatsApp; sem ela, procura pelo id."""
    import base64

    mensagem = {"key": key, **({"message": crua} if crua else {})}
    tentativas = [True, False] if converter_audio else [False]
    ultimo: ErroWhatsApp | None = None
    for converter in tentativas:  # áudio: tenta MP4 (toca no Safari e no iPhone); sem ffmpeg no servidor, vai o original
        try:
            r = await chamar("POST", f"/chat/getBase64FromMediaMessage/{instancia}", {"message": mensagem, "convertToMp4": converter}, timeout=40)
        except ErroWhatsApp as e:
            ultimo = e
            continue
        b64 = r.get("base64") or ""
        if not b64:
            ultimo = ErroWhatsApp(404, "O WhatsApp não devolveu o arquivo. Abra no celular.")
            continue
        if len(b64) * 3 // 4 > LIMITE_MIDIA:
            raise ErroWhatsApp(413, "Arquivo grande demais para abrir pelo CRM. Veja no celular.")
        mime = r.get("mimetype") or ("audio/mp4" if converter else "application/octet-stream")
        return base64.b64decode(b64.split(",")[-1]), mime.split(";")[0] if converter else mime
    raise ultimo or ErroWhatsApp(404, "Arquivo não encontrado.")


async def foto_perfil(instancia: str, jid: str) -> str | None:
    try:
        r = await chamar("POST", f"/chat/fetchProfilePictureUrl/{instancia}", {"number": destino(jid)}, timeout=15)
    except ErroWhatsApp:
        return None
    url = r.get("profilePictureUrl")
    return url if isinstance(url, str) and url.startswith(("https://", "http://")) else None


# ------------------------------------------------------------------ leitura do webhook


def jid_do_contato(key: dict) -> str | None:
    """Conversa 1 a 1 com telefone. Grupos, status e transmissões ficam de fora."""
    jid = key.get("remoteJid") or ""
    if jid.endswith("@lid") and key.get("remoteJidAlt"):
        jid = key["remoteJidAlt"]
    if jid.endswith("@g.us") or jid.endswith("@broadcast") or jid.endswith("@newsletter") or not jid:
        return None
    return jid


def telefone(jid: str) -> str | None:
    return jid.split("@")[0] if jid.endswith("@s.whatsapp.net") else None


def texto_da_mensagem(msg: dict, tipo: str | None) -> tuple[str, str]:
    """(texto para mostrar, tipo: texto | Foto | Áudio ...)."""
    msg = msg or {}
    if msg.get("conversation"):
        return msg["conversation"], "texto"
    ext = msg.get("extendedTextMessage") or {}
    if ext.get("text"):
        return ext["text"], "texto"
    for chave, rotulo in TIPOS_MIDIA.items():
        if chave in msg:
            corpo = msg.get(chave) or {}
            if chave == "documentWithCaptionMessage":
                corpo = ((corpo.get("message") or {}).get("documentMessage")) or {}
            legenda = corpo.get("caption") or corpo.get("fileName") or ""
            return (f"[{rotulo}] {legenda}".strip(), rotulo)
    rotulo = TIPOS_MIDIA.get(tipo or "", None)
    return (f"[{rotulo}]" if rotulo else "[Mensagem não suportada]"), (rotulo or "outro")


async def indexar(instancia: str, db_name: str, token: str) -> None:
    await controle[INDICE].update_one({"_id": instancia}, {"$set": {"_id": instancia, "db_name": db_name, "token": token}}, upsert=True)


async def desindexar(instancia: str) -> None:
    await controle[INDICE].delete_one({"_id": instancia})
