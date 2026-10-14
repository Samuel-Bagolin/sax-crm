"""Administradores da plataforma (equipe SAX): acesso global ao plano de controle e ao configurador.

Ficam no banco de controle (`controle.usuarios`, papel sysadmin). Ninguém digita senha por aqui: a conta
nasce com uma senha aleatória que ninguém conhece e a pessoa define a própria pelo link de ativação
(uso único, 24 h), enviado por e-mail quando houver provedor ou copiado na tela para mandar por WhatsApp.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from lib.auth import Principal, hash_senha, require
from lib.db import controle
from lib.email import email_configurado
from lib.integrity import audit
from lib.invites import invite
from models.common import now_utc, utc_aware
from models.usuarios import Usuario

router = APIRouter(prefix="/plataforma/administradores", tags=["plataforma"])


async def _controle(principal: Principal = Depends(require("usuario:manage_sysadmin"))) -> Principal:
    if principal.empresa_id:
        raise HTTPException(403, "Administradores da plataforma são cadastrados no plano de controle, fora das empresas.")
    return principal


def _saida(d: dict) -> dict:
    return {"id": d["id"], "nome": d["nome"], "email": d["email"], "ativo": d.get("ativo", True),
            "pendente": bool(d.get("activation_digest")), "criado_em": utc_aware(d.get("created_at"))}


@router.get("")
async def listar(principal: Principal = Depends(_controle)):
    docs = await controle.usuarios.find({"papel": "sysadmin"}).to_list(200)
    return sorted((_saida(d) for d in docs), key=lambda x: x["nome"].lower())


class AdminIn(BaseModel):
    nome: str = Field(min_length=3, max_length=80)
    email: EmailStr


@router.post("", status_code=201)
async def criar(input: AdminIn, principal: Principal = Depends(_controle)):
    email = str(input.email).lower().strip()
    if await controle.usuarios.find_one({"email": email}) or await controle.usuarios_index.find_one({"email": email}):
        raise HTTPException(409, "Este e-mail já tem acesso ao SAX. Use outro e-mail para o administrador.")
    usuario = Usuario(nome=input.nome.strip(), email=email, senha_hash=hash_senha(secrets.token_urlsafe(32)), papel="sysadmin")
    try:
        await controle.usuarios.insert_one(usuario.model_dump())
    except DuplicateKeyError:
        raise HTTPException(409, "Este e-mail já tem acesso ao SAX.")
    link = await invite(controle, usuario.model_dump(), "SAX")
    await audit(principal, "sysadmin.create", usuario.id, after={"email": email})
    doc = await controle.usuarios.find_one({"id": usuario.id})
    return {**_saida(doc), "link": link, "email_enviado": email_configurado()}


@router.post("/{usuario_id}/link")
async def novo_link(usuario_id: str, principal: Principal = Depends(_controle)):
    doc = await controle.usuarios.find_one({"id": usuario_id, "papel": "sysadmin"})
    if not doc:
        raise HTTPException(404, "Administrador não encontrado")
    if not doc.get("ativo", True):
        raise HTTPException(409, "Reative o acesso antes de mandar o link.")
    return {"link": await invite(controle, doc, "SAX"), "email_enviado": email_configurado()}


class AtivoIn(BaseModel):
    ativo: bool


@router.put("/{usuario_id}/ativo")
async def ativar(usuario_id: str, input: AtivoIn, principal: Principal = Depends(_controle)):
    doc = await controle.usuarios.find_one({"id": usuario_id, "papel": "sysadmin"})
    if not doc:
        raise HTTPException(404, "Administrador não encontrado")
    if usuario_id == principal.usuario_id and not input.ativo:
        raise HTTPException(409, "Você não pode desativar o próprio acesso.")
    if not input.ativo and await controle.usuarios.count_documents({"papel": "sysadmin", "ativo": True}) <= 1:
        raise HTTPException(409, "É preciso manter ao menos um administrador ativo.")
    mudar: dict = {"ativo": input.ativo, "updated_at": now_utc()}
    atualizar: dict = {"$set": mudar}
    if not input.ativo:
        atualizar["$inc"] = {"session_version": 1}  # derruba as sessões abertas na hora
    await controle.usuarios.update_one({"id": usuario_id}, atualizar)
    await audit(principal, "sysadmin.ativo", usuario_id, after={"ativo": input.ativo})
    return _saida({**doc, **mudar})
