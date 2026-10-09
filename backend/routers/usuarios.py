from fastapi import Query, Response
from lib.integrity import page
"""Gestão de usuários — exclusiva do admin (ação `usuario:manage`)."""

import base64
import binascii
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response as RawResponse

from lib.auth import Principal, hash_senha, pode_conceder, principal_atual, require
from lib.db import controle, db
from lib.integrity import audit
from pymongo.errors import DuplicateKeyError
from lib.tenant import desindexar_usuario, indexar_usuario
from models.common import utc_aware
from models.pessoas import Pessoa
from models.common import now_utc
from models.usuarios import FotoInput, PerfilUpdate, Usuario, UsuarioCreate, UsuarioPublico, UsuarioUpdate

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


def publico(doc: dict) -> UsuarioPublico:
    return UsuarioPublico(
        id=doc["id"],
        nome=doc["nome"],
        email=doc["email"],
        papel=doc["papel"],
        pessoa_id=doc.get("pessoa_id"),
        ativo=doc.get("ativo", True),
        telefone=doc.get("telefone"),
        cargo=doc.get("cargo"),
        creci=doc.get("creci"),
        cor=doc.get("cor"),
        tem_foto=bool(doc.get("tem_foto")),
        foto_v=int(doc.get("foto_v", 0)),
        created_at=utc_aware(doc.get("created_at")),
    )


def _exige_sysadmin_para_alvo(principal: Principal, doc: dict) -> None:
    """Conta de Administrador de Sistema só pode ser alterada/excluída por outro sysadmin."""
    if doc.get("papel") == "sysadmin" and not principal.is_sysadmin:
        raise HTTPException(
            status_code=403,
            detail="Somente um Administrador de Sistema pode alterar ou excluir este acesso",
        )


@router.get("", response_model=List[UsuarioPublico], dependencies=[Depends(require("usuario:manage"))])
async def list_usuarios(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000)):
    docs = await page(db.usuarios.find({}, {"senha_hash": 0}).sort("nome", 1), response, offset, limit)
    return [publico(d) for d in docs]


@router.post("", response_model=UsuarioPublico, status_code=201)
async def create_usuario(input: UsuarioCreate, principal: Principal = Depends(require("usuario:manage"))):
    if not pode_conceder(principal, input.papel):
        raise HTTPException(status_code=403, detail="Você não pode conceder este perfil")

    if not principal.empresa_id and input.papel != "sysadmin":
        raise HTTPException(422, "Entre em uma empresa para cadastrar gestores e corretores")
    email = input.email.lower().strip()
    if await db.usuarios.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail")
    if principal.empresa_id:
        from lib.planos import exigir_limite
        await exigir_limite("usuarios")

    if principal.empresa_id and input.papel == "sysadmin":
        raise HTTPException(403, "Administradores globais são criados somente no plano de controle")
    if principal.empresa_id:
        empresa = await controle.empresas.find_one({"id": principal.empresa_id})
        await indexar_usuario(email, principal.empresa_id, empresa["db_name"])
    elif await controle.usuarios_index.find_one({"email": email}):
        raise HTTPException(409, "Este e-mail já é usado por outra empresa")

    pessoa_id: str | None = None
    if input.papel == "corretor":
        # Todo corretor precisa de uma Pessoa correspondente: é ela que carrega a carteira.
        pessoa = Pessoa(nome=input.nome.strip(), papeis=["corretor"], email=email, telefone=input.telefone)
        await db.pessoas.insert_one(pessoa.model_dump())
        pessoa_id = pessoa.id

    # Whitelist explícita: nada de `insert({**body})` — `ativo`/`pessoa_id` são do servidor.
    usuario = Usuario(
        nome=input.nome.strip(),
        email=email,
        senha_hash=hash_senha(input.senha),
        papel=input.papel,
        pessoa_id=pessoa_id,
        telefone=input.telefone,
        cargo=input.cargo,
        creci=input.creci,
        cor=input.cor,
    )
    try:
        await db.usuarios.insert_one(usuario.model_dump())
    except DuplicateKeyError:
        raise HTTPException(409, "Já existe um usuário com este e-mail")
    if principal.empresa_id:
        # Índice e-mail → empresa no banco de controle: é o que permite o login direto.
        empresa = await controle.empresas.find_one({"id": principal.empresa_id})
        if empresa:
            await indexar_usuario(usuario.email, principal.empresa_id, empresa["db_name"])
    return publico(usuario.model_dump())


@router.patch("/{usuario_id}", response_model=UsuarioPublico)
async def update_usuario(
    usuario_id: str, input: UsuarioUpdate, principal: Principal = Depends(require("usuario:manage"))
):
    doc = await db.usuarios.find_one({"id": usuario_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    _exige_sysadmin_para_alvo(principal, doc)
    if input.papel == "sysadmin" and principal.empresa_id:
        raise HTTPException(403, "Papel global não permitido dentro de uma empresa")
    if input.papel and not pode_conceder(principal, input.papel):
        raise HTTPException(status_code=403, detail="Você não pode conceder este perfil")
    if usuario_id == principal.usuario_id and input.papel and input.papel != doc["papel"]:
        raise HTTPException(409, "Você não pode reduzir o próprio perfil")
    if usuario_id == principal.usuario_id and input.ativo is False:
        raise HTTPException(status_code=409, detail="Você não pode desativar a própria conta")

    data: dict = {}
    if input.nome is not None:
        data["nome"] = input.nome.strip()
    if input.papel is not None:
        data["papel"] = input.papel
    if input.ativo is not None:
        if input.ativo and doc.get("ativo") is False and principal.empresa_id:
            from lib.planos import exigir_limite
            await exigir_limite("usuarios")
        data["ativo"] = input.ativo
    if input.senha:
        data["senha_hash"] = hash_senha(input.senha)
    for campo in ("telefone", "cargo", "creci", "cor"):
        if campo in input.model_fields_set:
            data[campo] = getattr(input, campo)
    if "telefone" in data and doc.get("pessoa_id"):
        await db.pessoas.update_one({"id": doc["pessoa_id"]}, {"$set": {"telefone": data["telefone"]}})

    if input.papel == "corretor" and not doc.get("pessoa_id"):
        pessoa = Pessoa(nome=data.get("nome", doc["nome"]), papeis=["corretor"], email=doc["email"])
        await db.pessoas.insert_one(pessoa.model_dump())
        data["pessoa_id"] = pessoa.id
    if data:
        update = {"$set": data}
        if input.senha: update["$inc"] = {"session_version": 1}
        await db.usuarios.update_one({"id": usuario_id}, update)
        await audit(principal, "usuario.update", usuario_id, after={k: v for k, v in data.items() if k != "senha_hash"})
        doc.update(data)
    return publico(doc)


@router.delete("/{usuario_id}", status_code=204)
async def delete_usuario(usuario_id: str, principal: Principal = Depends(require("usuario:manage"))):
    if usuario_id == principal.usuario_id:
        raise HTTPException(status_code=409, detail="Você não pode excluir a própria conta")
    doc = await db.usuarios.find_one({"id": usuario_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    _exige_sysadmin_para_alvo(principal, doc)
    if doc.get("papel") == "sysadmin":
        restantes = await db.usuarios.count_documents({"papel": "sysadmin", "ativo": True})
        if restantes <= 1:
            raise HTTPException(
                status_code=409, detail="É preciso manter ao menos um Administrador de Sistema ativo"
            )
    await db.usuarios.delete_one({"id": usuario_id})
    if principal.empresa_id:
        await desindexar_usuario(doc["email"], principal.empresa_id)
    return None


# ------------------------------------------------------------------ fotos e perfil

_ASSINATURAS_IMAGEM = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}
FOTO_MAX_BYTES = 700 * 1024


def _decodificar_foto(input: FotoInput) -> bytes:
    conteudo = input.base64.split(",", 1)[1] if input.base64.startswith("data:") else input.base64
    try:
        bruto = base64.b64decode(conteudo, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "Imagem inválida")
    assinaturas = _ASSINATURAS_IMAGEM.get(input.mime)
    if not assinaturas or not any(bruto.startswith(a) for a in assinaturas):
        raise HTTPException(422, "Use uma foto JPG, PNG ou WEBP")
    if len(bruto) > FOTO_MAX_BYTES:
        raise HTTPException(413, "Foto acima de 700 KB — reduza a imagem")
    return bruto


def _pode_editar_foto(principal: Principal, usuario_id: str, alvo: dict) -> None:
    if usuario_id == principal.usuario_id:
        return
    if not principal.is_admin:
        raise HTTPException(403, "Você só pode alterar a sua própria foto")
    _exige_sysadmin_para_alvo(principal, alvo)


async def _gravar_foto(usuario_id: str, bruto: bytes | None, mime: str | None) -> dict:
    if bruto is None:
        await db.fotos_usuario.delete_one({"_id": usuario_id})
        await db.usuarios.update_one({"id": usuario_id}, {"$set": {"tem_foto": False}, "$inc": {"foto_v": 1}})
    else:
        await db.fotos_usuario.update_one({"_id": usuario_id}, {"$set": {
            "base64": base64.b64encode(bruto).decode(), "mime": mime, "em": now_utc()}}, upsert=True)
        await db.usuarios.update_one({"id": usuario_id}, {"$set": {"tem_foto": True}, "$inc": {"foto_v": 1}})
    return await db.usuarios.find_one({"id": usuario_id}, {"senha_hash": 0})


@router.put("/{usuario_id}/foto", response_model=UsuarioPublico)
async def enviar_foto(usuario_id: str, input: FotoInput, principal: Principal = Depends(principal_atual)):
    alvo = await db.usuarios.find_one({"id": usuario_id}, {"senha_hash": 0})
    if not alvo:
        raise HTTPException(404, "Usuário não encontrado")
    _pode_editar_foto(principal, usuario_id, alvo)
    return publico(await _gravar_foto(usuario_id, _decodificar_foto(input), input.mime))


@router.delete("/{usuario_id}/foto", response_model=UsuarioPublico)
async def remover_foto(usuario_id: str, principal: Principal = Depends(principal_atual)):
    alvo = await db.usuarios.find_one({"id": usuario_id}, {"senha_hash": 0})
    if not alvo:
        raise HTTPException(404, "Usuário não encontrado")
    _pode_editar_foto(principal, usuario_id, alvo)
    return publico(await _gravar_foto(usuario_id, None, None))


@router.get("/{usuario_id}/foto")
async def obter_foto(usuario_id: str, principal: Principal = Depends(principal_atual)):
    """Foto de qualquer usuário da MESMA empresa (o banco do request já é o da empresa)."""
    doc = await db.fotos_usuario.find_one({"_id": usuario_id})
    if not doc:
        raise HTTPException(404, "Sem foto")
    return RawResponse(content=base64.b64decode(doc["base64"]), media_type=doc.get("mime") or "image/jpeg",
                       headers={"Cache-Control": "private, max-age=86400"})


perfil_router = APIRouter(prefix="/perfil", tags=["usuarios"])


@perfil_router.get("", response_model=UsuarioPublico)
async def meu_perfil(principal: Principal = Depends(principal_atual)):
    doc = await db.usuarios.find_one({"id": principal.usuario_id}, {"senha_hash": 0})
    if not doc:
        raise HTTPException(404, "Usuário não encontrado")
    return publico(doc)


@perfil_router.patch("", response_model=UsuarioPublico)
async def editar_perfil(input: PerfilUpdate, principal: Principal = Depends(principal_atual)):
    data = {k: (v.strip() if isinstance(v, str) else v) for k, v in input.model_dump(exclude_unset=True).items()}
    if "nome" in data and not data["nome"]:
        raise HTTPException(422, "Informe o nome")
    if data:
        await db.usuarios.update_one({"id": principal.usuario_id}, {"$set": data})
        if principal.pessoa_id:
            espelho = {k: data[k] for k in ("nome", "telefone") if k in data}
            if espelho:
                await db.pessoas.update_one({"id": principal.pessoa_id}, {"$set": espelho})
    return publico(await db.usuarios.find_one({"id": principal.usuario_id}, {"senha_hash": 0}))
