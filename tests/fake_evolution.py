"""Simulador da Evolution API v2 (só o que o SAX usa) para testes locais.

Endpoints reais: /instance/create, /instance/connect/{i}, /instance/connectionState/{i},
/instance/logout/{i}, /instance/delete/{i}, /instance/fetchInstances, /message/sendText/{i}.
Ajudantes de teste: /_teste/conectar/{i} (lê o QR) e /_teste/receber/{i} (cliente manda mensagem),
que disparam o webhook igual à Evolution: {"event": "connection.update" | "messages.upsert", "instance", "data"}.
"""

import time
import uuid

import httpx
from fastapi import FastAPI, Header, HTTPException, Request

app = FastAPI()
CHAVE = "chave-teste"
INST: dict[str, dict] = {}
ENVIADAS: list[dict] = []
QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _auth(apikey: str | None):
    if apikey != CHAVE:
        raise HTTPException(401, {"status": 401, "error": "Unauthorized", "response": {"message": "Unauthorized"}})


@app.post("/instance/create")
async def criar(req: Request, apikey: str | None = Header(None)):
    _auth(apikey)
    b = await req.json()
    nome = b["instanceName"]
    if nome in INST:
        raise HTTPException(403, {"status": 403, "error": "Forbidden", "response": {"message": [f'This name "{nome}" is already in use.']}})
    INST[nome] = {"state": "connecting", "webhook": b.get("webhook") or {}}
    return {"instance": {"instanceName": nome, "status": "connecting"}, "hash": uuid.uuid4().hex, "qrcode": {"base64": QR, "code": "2@abc", "count": 1}}


@app.get("/instance/connect/{nome}")
async def conectar(nome: str, apikey: str | None = Header(None)):
    _auth(apikey)
    i = INST.get(nome)
    if not i:
        return {"error": True, "message": f'BadRequestException: The "{nome}" instance does not exist'}
    if i["state"] == "open":
        return {"instance": {"instanceName": nome, "state": "open"}}
    return {"base64": QR, "code": "2@abc", "pairingCode": None, "count": 2}


@app.get("/instance/connectionState/{nome}")
async def estado(nome: str, apikey: str | None = Header(None)):
    _auth(apikey)
    return {"instance": {"instanceName": nome, "state": (INST.get(nome) or {}).get("state", "close")}}


@app.get("/instance/fetchInstances")
async def listar(apikey: str | None = Header(None)):
    _auth(apikey)
    return [{"name": n, "connectionStatus": i["state"]} for n, i in INST.items()]


@app.delete("/instance/logout/{nome}")
@app.delete("/instance/delete/{nome}")
async def remover(nome: str, req: Request, apikey: str | None = Header(None)):
    _auth(apikey)
    if req.url.path.startswith("/instance/delete"):
        INST.pop(nome, None)
    elif nome in INST:
        INST[nome]["state"] = "close"
    return {"status": "SUCCESS", "error": False, "response": {"message": "ok"}}


@app.post("/message/sendText/{nome}")
async def enviar(nome: str, req: Request, apikey: str | None = Header(None)):
    _auth(apikey)
    i = INST.get(nome)
    if not i or i["state"] != "open":
        raise HTTPException(400, {"status": 400, "error": "Bad Request", "response": {"message": ["Connection Closed"]}})
    b = await req.json()
    mid = "3EB0" + uuid.uuid4().hex[:16].upper()
    ENVIADAS.append({"instancia": nome, **b, "id": mid})
    jid = b["number"] if "@" in b["number"] else f"{b['number']}@s.whatsapp.net"
    return {"key": {"remoteJid": jid, "fromMe": True, "id": mid}, "message": {"conversation": b["text"]}, "messageTimestamp": int(time.time()), "status": "PENDING"}


async def _disparar(nome: str, evento: str, data: dict):
    w = INST[nome]["webhook"]
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(w["url"], json={"event": evento, "instance": nome, "data": data, "date_time": "x", "sender": "x", "server_url": "x", "apikey": "x"},
                         headers=w.get("headers") or {})
    return r.status_code


@app.post("/_teste/conectar/{nome}")
async def t_conectar(nome: str, numero: str = "5541990001111"):
    INST[nome]["state"] = "open"
    return {"webhook": await _disparar(nome, "connection.update", {"instance": nome, "wuid": f"{numero}@s.whatsapp.net", "profileName": "Imobiliária Teste", "state": "open", "statusReason": 200})}


@app.post("/_teste/receber/{nome}")
async def t_receber(nome: str, req: Request):
    b = await req.json()
    mid = b.get("id") or uuid.uuid4().hex[:20].upper()
    data = {"key": {"remoteJid": b.get("jid") or f"{b['numero']}@s.whatsapp.net", "fromMe": bool(b.get("de_mim")), "id": mid},
            "pushName": b.get("nome"), "message": b.get("message") or {"conversation": b["texto"]}, "messageType": b.get("tipo") or "conversation",
            "messageTimestamp": int(time.time()), "instanceId": "x", "source": "android"}
    return {"webhook": await _disparar(nome, "messages.upsert", data), "id": mid}


AUDIO = b"ID3fake-audio-bytes"
FOTO = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                     "1f15c4890000000d49444154789c63f8cfc0f01f0005000201ff8a2c5b0000000049454e44ae426082")
PEDIDOS_MIDIA: list[dict] = []


@app.post("/chat/getBase64FromMediaMessage/{nome}")
async def midia(nome: str, req: Request, apikey: str | None = Header(None)):
    _auth(apikey)
    b = await req.json()
    PEDIDOS_MIDIA.append(b)
    msg = (b.get("message") or {}).get("message") or {}
    import base64
    if "audioMessage" in msg or (b.get("message") or {}).get("key", {}).get("id", "").startswith("AUD"):
        mime = "audio/mp4" if b.get("convertToMp4") else "audio/ogg; codecs=opus"
        return {"mediaType": "audioMessage", "mimetype": mime, "base64": base64.b64encode(AUDIO).decode()}
    if "imageMessage" in msg:
        return {"mediaType": "imageMessage", "mimetype": "image/png", "base64": base64.b64encode(FOTO).decode()}
    return {"error": True, "message": "Message not found"}


@app.post("/chat/fetchProfilePictureUrl/{nome}")
async def foto_perfil(nome: str, req: Request, apikey: str | None = Header(None)):
    _auth(apikey)
    b = await req.json()
    if str(b.get("number", "")).endswith("0000"):
        return {"wuid": b["number"], "profilePictureUrl": None}
    return {"wuid": b["number"], "profilePictureUrl": f"{req.base_url}_teste/foto.png"}


@app.get("/_teste/foto.png")
async def t_foto():
    from fastapi import Response
    return Response(FOTO, media_type="image/png")


@app.get("/_teste/midia")
async def t_midia():
    return PEDIDOS_MIDIA


@app.get("/_teste/enviadas")
async def t_enviadas():
    return ENVIADAS
