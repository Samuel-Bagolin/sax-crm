"""Chat interno da equipe: canal Geral (todos), grupos e conversas diretas.

Atualização por consulta periódica (polling curto) — funciona atrás de qualquer ingress e com
vários processos, sem WebSocket. Cada empresa tem o próprio banco, então o chat nunca cruza empresas.
"""

import base64
import re
from datetime import datetime
from typing import List, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from lib.auth import Principal, authorize, require
from lib.db import db
from models.common import new_id, now_utc, utc_aware

router = APIRouter(prefix="/chat", tags=["chat"])

GERAL_ID = "geral"
LIMITE_ANEXO = 4 * 1024 * 1024  # cabe no limite de 4,5 MB por requisição do Vercel
MIMES_ANEXO = re.compile(r"^(image/(png|jpeg|webp|gif)|application/pdf)$")


class Participante(BaseModel):
    usuario_id: str
    nome: str
    tem_foto: bool = False
    foto_v: int = 0
    cor: str | None = None
    pessoa_id: str | None = None


class Conversa(BaseModel):
    id: str
    tipo: Literal["canal", "direta"]
    nome: str
    todos: bool = False
    membros: List[Participante] = Field(default_factory=list)
    nao_lidas: int = 0
    ultima_msg_texto: str | None = None
    ultima_msg_autor: str | None = None
    ultima_msg_em: datetime | None = None


class Mensagem(BaseModel):
    id: str
    conversa_id: str
    autor_id: str
    autor_nome: str
    texto: str = ""
    negocio_id: str | None = None
    negocio_nome: str | None = None
    anexo_nome: str | None = None
    anexo_mime: str | None = None
    excluida: bool = False
    em: datetime


class NovaMensagem(BaseModel):
    texto: str = Field(default="", max_length=4000)
    negocio_id: str | None = None


class NovoCanal(BaseModel):
    nome: str = Field(min_length=2, max_length=60)
    membros: List[str] = Field(default_factory=list, max_length=100)


class NovaDireta(BaseModel):
    usuario_id: str


async def _garantir_geral():
    if not await db.chat_conversas.find_one({"id": GERAL_ID}):
        await db.chat_conversas.update_one({"id": GERAL_ID}, {"$setOnInsert": {
            "id": GERAL_ID, "tipo": "canal", "nome": "Geral", "todos": True, "membros": [], "criado_em": now_utc(), "ultima_msg_em": None,
        }}, upsert=True)


def _filtro_visivel(principal: Principal) -> dict:
    return {"$or": [{"todos": True}, {"membros": principal.usuario_id}]}


async def _conversa(conversa_id: str, principal: Principal) -> dict:
    if conversa_id == GERAL_ID:
        await _garantir_geral()
    c = await db.chat_conversas.find_one({"$and": [{"id": conversa_id}, _filtro_visivel(principal)]})
    if not c:
        raise HTTPException(404, "Conversa não encontrada")
    return c


async def _usuarios() -> dict[str, dict]:
    return {u["id"]: u async for u in db.usuarios.find({"ativo": True, "papel": {"$ne": "sysadmin"}},
                                                         {"id": 1, "nome": 1, "tem_foto": 1, "foto_v": 1, "cor": 1, "pessoa_id": 1})}


def _part(u: dict) -> Participante:
    return Participante(usuario_id=u["id"], nome=u["nome"], tem_foto=bool(u.get("tem_foto")), foto_v=int(u.get("foto_v", 0)),
                        cor=u.get("cor"), pessoa_id=u.get("pessoa_id"))


def _msg(d: dict) -> Mensagem:
    return Mensagem(
        id=d["id"], conversa_id=d["conversa_id"], autor_id=d["autor_id"], autor_nome=d["autor_nome"],
        texto="" if d.get("excluida") else d.get("texto", ""), negocio_id=None if d.get("excluida") else d.get("negocio_id"),
        negocio_nome=None if d.get("excluida") else d.get("negocio_nome"),
        anexo_nome=None if d.get("excluida") else d.get("anexo_nome"), anexo_mime=None if d.get("excluida") else d.get("anexo_mime"),
        excluida=bool(d.get("excluida")), em=utc_aware(d["em"]),
    )


async def _nao_lidas(conversa_id: str, usuario_id: str) -> int:
    leitura = await db.chat_leituras.find_one({"conversa_id": conversa_id, "usuario_id": usuario_id})
    filtro = {"conversa_id": conversa_id, "autor_id": {"$ne": usuario_id}, "excluida": {"$ne": True}}
    if leitura:
        filtro["em"] = {"$gt": leitura["lida_em"]}
    return await db.chat_mensagens.count_documents(filtro)


@router.get("/conversas", response_model=List[Conversa])
async def conversas(principal: Principal = Depends(require("equipe:read"))):
    await _garantir_geral()
    usuarios = await _usuarios()
    saida = []
    async for c in db.chat_conversas.find(_filtro_visivel(principal)):
        membros = [_part(usuarios[m]) for m in c.get("membros", []) if m in usuarios]
        nome = c["nome"]
        if c["tipo"] == "direta":
            outro = next((m for m in membros if m.usuario_id != principal.usuario_id), None)
            nome = outro.nome if outro else "Conversa"
        saida.append(Conversa(
            id=c["id"], tipo=c["tipo"], nome=nome, todos=bool(c.get("todos")), membros=membros,
            nao_lidas=await _nao_lidas(c["id"], principal.usuario_id), ultima_msg_texto=c.get("ultima_msg_texto"),
            ultima_msg_autor=c.get("ultima_msg_autor"), ultima_msg_em=utc_aware(c.get("ultima_msg_em")),
        ))
    saida.sort(key=lambda x: (x.id != GERAL_ID, -(x.ultima_msg_em.timestamp() if x.ultima_msg_em else 0)))
    return saida


@router.get("/pessoas", response_model=List[Participante])
async def pessoas(principal: Principal = Depends(require("equipe:read"))):
    """Diretório mínimo (nome e foto) para iniciar conversas — sem telefone, e-mail ou indicadores."""
    usuarios = await _usuarios()
    return sorted((_part(u) for u in usuarios.values()), key=lambda p: p.nome.lower())


@router.get("/nao-lidas")
async def total_nao_lidas(principal: Principal = Depends(require("equipe:read"))):
    await _garantir_geral()
    total = 0
    async for c in db.chat_conversas.find(_filtro_visivel(principal), {"id": 1}):
        total += await _nao_lidas(c["id"], principal.usuario_id)
    return {"total": total}


@router.post("/diretas", response_model=Conversa)
async def direta(input: NovaDireta, principal: Principal = Depends(require("equipe:read"))):
    if input.usuario_id == principal.usuario_id:
        raise HTTPException(422, "Escolha outra pessoa")
    usuarios = await _usuarios()
    if input.usuario_id not in usuarios:
        raise HTTPException(404, "Pessoa não encontrada")
    par = sorted([principal.usuario_id, input.usuario_id])
    chave = "dm:" + ":".join(par)
    await db.chat_conversas.update_one({"id": chave}, {"$setOnInsert": {
        "id": chave, "tipo": "direta", "nome": "", "todos": False, "membros": par, "criado_em": now_utc(), "ultima_msg_em": None,
    }}, upsert=True)
    return next(c for c in await conversas(principal) if c.id == chave)


@router.post("/canais", response_model=Conversa, status_code=201)
async def criar_canal(input: NovoCanal, principal: Principal = Depends(require("equipe:read"))):
    usuarios = await _usuarios()
    membros = sorted({m for m in input.membros if m in usuarios} | {principal.usuario_id})
    if len(membros) < 2:
        raise HTTPException(422, "Inclua ao menos mais uma pessoa no grupo")
    cid = new_id()
    await db.chat_conversas.insert_one({"id": cid, "tipo": "canal", "nome": input.nome.strip(), "todos": False, "membros": membros,
                                        "criado_por": principal.usuario_id, "criado_em": now_utc(), "ultima_msg_em": None})
    return next(c for c in await conversas(principal) if c.id == cid)


@router.get("/conversas/{conversa_id}/mensagens", response_model=List[Mensagem])
async def mensagens(conversa_id: str, depois: str | None = None, antes: str | None = None,
                    limite: int = Query(60, ge=1, le=200), principal: Principal = Depends(require("equipe:read"))):
    await _conversa(conversa_id, principal)
    filtro: dict = {"conversa_id": conversa_id}
    if depois:
        filtro["em"] = {"$gt": utc_aware(datetime.fromisoformat(depois.replace("Z", "+00:00")))}
    if antes:
        filtro["em"] = {"$lt": utc_aware(datetime.fromisoformat(antes.replace("Z", "+00:00")))}
    docs = await db.chat_mensagens.find(filtro, {"anexo": 0}).sort("em", -1).limit(limite).to_list(limite)
    docs.reverse()
    await db.chat_leituras.update_one({"conversa_id": conversa_id, "usuario_id": principal.usuario_id},
                                      {"$set": {"lida_em": now_utc()}}, upsert=True)
    return [_msg(d) for d in docs]


async def _gravar(conversa: dict, principal: Principal, texto: str, negocio_id: str | None, anexo: dict | None = None) -> Mensagem:
    texto = texto.strip()
    if not texto and not negocio_id and not anexo:
        raise HTTPException(422, "Mensagem vazia")
    negocio_nome = None
    if negocio_id:
        negocio = await db.leads.find_one({"id": negocio_id})
        if not negocio:
            raise HTTPException(404, "Negócio não encontrado")
        authorize(principal, "lead:read", negocio)  # só cita negócio que a pessoa enxerga
        negocio_nome = negocio["nome"]
    doc = {"id": new_id(), "conversa_id": conversa["id"], "autor_id": principal.usuario_id, "autor_nome": principal.nome,
           "texto": texto, "negocio_id": negocio_id, "negocio_nome": negocio_nome, "excluida": False, "em": now_utc(), **(anexo or {})}
    await db.chat_mensagens.insert_one(doc)
    resumo = texto or (f"📎 {anexo['anexo_nome']}" if anexo else f"Negócio: {negocio_nome}")
    await db.chat_conversas.update_one({"id": conversa["id"]}, {"$set": {
        "ultima_msg_em": doc["em"], "ultima_msg_texto": resumo[:140], "ultima_msg_autor": principal.nome}})
    await db.chat_leituras.update_one({"conversa_id": conversa["id"], "usuario_id": principal.usuario_id},
                                      {"$set": {"lida_em": doc["em"]}}, upsert=True)
    return _msg(doc)


@router.post("/conversas/{conversa_id}/mensagens", response_model=Mensagem, status_code=201)
async def enviar(conversa_id: str, input: NovaMensagem, principal: Principal = Depends(require("equipe:read"))):
    conversa = await _conversa(conversa_id, principal)
    return await _gravar(conversa, principal, input.texto, input.negocio_id)


@router.post("/conversas/{conversa_id}/anexo", response_model=Mensagem, status_code=201)
async def enviar_anexo(conversa_id: str, arquivo: UploadFile = File(...), texto: str = Form(""),
                       principal: Principal = Depends(require("equipe:read"))):
    conversa = await _conversa(conversa_id, principal)
    mime = (arquivo.content_type or "").lower()
    if not MIMES_ANEXO.match(mime):
        raise HTTPException(415, "No chat, envie imagem ou PDF. Outros arquivos vão nos documentos do negócio.")
    conteudo = await arquivo.read(LIMITE_ANEXO + 1)
    if len(conteudo) > LIMITE_ANEXO:
        raise HTTPException(413, "Arquivo acima de 4 MB")
    anexo = {"anexo": base64.b64encode(conteudo).decode(), "anexo_nome": (arquivo.filename or "arquivo")[:120], "anexo_mime": mime}
    return await _gravar(conversa, principal, texto[:4000], None, anexo)


@router.get("/mensagens/{mensagem_id}/anexo")
async def baixar_anexo(mensagem_id: str, principal: Principal = Depends(require("equipe:read"))):
    m = await db.chat_mensagens.find_one({"id": mensagem_id})
    if not m or not m.get("anexo") or m.get("excluida"):
        raise HTTPException(404, "Anexo não encontrado")
    await _conversa(m["conversa_id"], principal)
    nome = re.sub(r'[^\w.\- ]', "_", m.get("anexo_nome") or "arquivo")
    return Response(base64.b64decode(m["anexo"]), media_type=m["anexo_mime"],
                    headers={"Content-Disposition": f'inline; filename="{nome}"', "Cache-Control": "private, max-age=3600"})


@router.delete("/mensagens/{mensagem_id}", status_code=204)
async def apagar(mensagem_id: str, principal: Principal = Depends(require("equipe:read"))):
    m = await db.chat_mensagens.find_one({"id": mensagem_id})
    if not m:
        raise HTTPException(404, "Mensagem não encontrada")
    await _conversa(m["conversa_id"], principal)
    if m["autor_id"] != principal.usuario_id and not principal.is_admin:
        raise HTTPException(403, "Só o autor ou o gestor apaga a mensagem")
    await db.chat_mensagens.update_one({"id": mensagem_id}, {"$set": {"excluida": True, "excluida_por": principal.usuario_id},
                                                             "$unset": {"anexo": "", "texto": ""}})
    return None
