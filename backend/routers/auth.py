"""Rotas de sessão — todas sob /api/auth/*. O token viaja apenas no cookie httpOnly.

Multiempresa: o login resolve a empresa do usuário pelo índice e-mail → empresa no banco de
CONTROLE e grava o `empresa_id` no token; daí em diante o request lê e escreve apenas no banco
daquela empresa. Administrador de Sistema vive no banco de controle (sem empresa).
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from lib.auth import hash_senha
from lib.invites import invite
from models.common import now_utc
import hashlib

from datetime import datetime, timezone

from lib.auth import (
    COOKIE_NAME,
    Principal,
    conferir_senha,
    criar_token,
    gravar_cookie,
    limpar_cookie,
    principal_atual,
)
from lib.db import client, controle, db, definir_empresa
from models.usuarios import LoginInput

router = APIRouter(prefix="/auth", tags=["auth"])

ERRO_CREDENCIAL = "E-mail ou senha inválidos"


@router.post("/login", response_model=Principal)
async def login(input: LoginInput, response: Response):
    email = input.email.lower().strip()

    # 1) Administrador de Sistema (global, banco de controle)
    doc = await controle.usuarios.find_one({"email": email, "papel": "sysadmin"})
    empresa = None
    if not doc:
        # 2) Usuário de uma empresa: índice e-mail → empresa
        indice = await controle.usuarios_index.find_one({"email": email})
        if indice:
            empresa = await controle.empresas.find_one({"id": indice["empresa_id"]})
            if not empresa:
                raise HTTPException(status_code=401, detail=ERRO_CREDENCIAL)
            if not empresa.get("ativo", True):
                raise HTTPException(status_code=403, detail="Empresa desativada — fale com o suporte")
            doc = await client[empresa["db_name"]].usuarios.find_one({"email": email})
        else:
            # 3) Sistema recém-instalado: o primeiro administrador vem do Firebase Authentication.
            from lib.autoconfig import administrador_pelo_firebase
            doc = await administrador_pelo_firebase(controle, email, input.senha)
            if not doc:
                raise HTTPException(status_code=401, detail=ERRO_CREDENCIAL)

    # Mensagem genérica: não revela se o e-mail existe.
    if not doc or doc.get("activation_required") or not conferir_senha(input.senha, doc["senha_hash"]):
        raise HTTPException(status_code=401, detail=ERRO_CREDENCIAL)
    if not doc.get("ativo", True):
        raise HTTPException(status_code=403, detail="Usuário desativado — fale com o gestor")

    empresa_id = empresa["id"] if empresa else None
    if empresa:
        definir_empresa(empresa["db_name"])
        await controle.empresas.update_one({"id": empresa_id}, {"$set": {"ultimo_acesso": datetime.now(timezone.utc)}})
    gravar_cookie(response, criar_token(doc["id"], empresa_id=empresa_id, session_version=doc.get("session_version", 0)))
    return Principal(
        usuario_id=doc["id"],
        nome=doc["nome"],
        email=doc["email"],
        papel=doc["papel"],
        pessoa_id=doc.get("pessoa_id"),
        empresa_id=empresa_id,
        empresa_nome=empresa["nome"] if empresa else None,
        suporte=False,
        tem_foto=bool(doc.get("tem_foto")),
        foto_v=int(doc.get("foto_v", 0)),
        trocar_senha=bool(doc.get("trocar_senha")),
    )


class TrocaSenhaInput(BaseModel):
    senha_atual: str = Field(min_length=1, max_length=72)
    nova_senha: str = Field(min_length=12, max_length=72)


@router.post("/senha", status_code=204)
async def trocar_senha(input: TrocaSenhaInput, response: Response, principal: Principal = Depends(principal_atual)):
    """O próprio usuário troca a senha (obrigatório quando a senha inicial é fraca)."""
    if len(input.nova_senha.encode("utf-8")) > 72:
        raise HTTPException(422, "Senha excede 72 bytes")
    if input.nova_senha == input.senha_atual:
        raise HTTPException(422, "A nova senha precisa ser diferente da atual")
    banco = controle if principal.papel == "sysadmin" else db
    doc = await banco.usuarios.find_one({"id": principal.usuario_id})
    if not doc or not conferir_senha(input.senha_atual, doc["senha_hash"]):
        raise HTTPException(400, "Senha atual incorreta")
    versao = doc.get("session_version", 0) + 1
    await banco.usuarios.update_one({"id": principal.usuario_id}, {
        "$set": {"senha_hash": hash_senha(input.nova_senha), "trocar_senha": False, "session_version": versao}})
    # As outras sessões caem; esta continua com um token novo.
    gravar_cookie(response, criar_token(principal.usuario_id, empresa_id=principal.empresa_id,
                                        session_version=versao))
    return None


@router.post("/logout", status_code=204)
async def logout(response: Response):
    limpar_cookie(response)
    return None


@router.get("/me", response_model=Principal)
async def me(principal: Principal = Depends(principal_atual)):
    return principal


__all__ = ["router", "COOKIE_NAME"]


class ActivationInput(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    senha: str = Field(min_length=12, max_length=72)

class RecoveryInput(BaseModel):
    email: EmailStr


@router.post("/recuperar", status_code=202)
async def recover(input: RecoveryInput):
    email = input.email.lower().strip()
    user = await controle.usuarios.find_one({"email": email, "ativo": True})
    bank = controle
    name = "CedroNexxo"
    if not user:
        index = await controle.usuarios_index.find_one({"email": email})
        company = await controle.empresas.find_one({"id": index["empresa_id"], "ativo": True}) if index else None
        if company:
            bank = client[company["db_name"]]
            user = await bank.usuarios.find_one({"email": email, "ativo": True})
            name = company["nome"]
    if user:
        try:
            definir_empresa(bank.name if bank.name != controle.name else None)
            await invite(bank, user, name)
        except Exception:
            import logging
            logging.getLogger(__name__).error("Falha ao enfileirar recuperação de acesso")
    return {"mensagem": "Se houver um acesso ativo, você receberá um link de recuperação."}


@router.post("/ativar", status_code=204)
async def activate(input: ActivationInput, response: Response):
    digest = hashlib.sha256(input.token.encode()).hexdigest()
    banks = [controle]
    async for company in controle.empresas.find({"ativo": True}): banks.append(client[company["db_name"]])
    if len(input.senha.encode("utf-8")) > 72: raise HTTPException(422, "Senha excede 72 bytes")
    for bank in banks:
        query = {"activation_digest": digest, "activation_expires": {"$gt": now_utc()}, "ativo": True}
        if not await bank.usuarios.find_one(query, {"id": 1}): continue
        result = await bank.usuarios.update_one(
            {"activation_digest": digest, "activation_expires": {"$gt": now_utc()}, "ativo": True},
            {"$set": {"senha_hash": hash_senha(input.senha), "activation_required": False},
             "$inc": {"session_version": 1}, "$unset": {"activation_digest": "", "activation_expires": ""}})
        if result.modified_count:
            limpar_cookie(response)
            return None
    raise HTTPException(400, "Link inválido, expirado ou já utilizado")
