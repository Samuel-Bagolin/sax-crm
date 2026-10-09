from fastapi import Query, Response
from lib.integrity import page
"""Router de pessoas — cadastro único universal (o papel é contextual)."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, require
from lib.db import db
from models.common import utc_aware
from models.pessoas import Pessoa, PessoaCreate

router = APIRouter(prefix="/pessoas", tags=["pessoas"])


def to_pessoa(doc: dict) -> Pessoa:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    return Pessoa(**data)


async def person_scope(principal):
    if principal.is_admin: return {}
    ids = {principal.pessoa_id}
    for collection in (db.leads, db.contratos, db.visitas):
        async for item in collection.find({"corretor_id": principal.pessoa_id or "__none__"}, {"cliente_id": 1, "proprietario_id": 1}):
            ids.update(item.get(k) for k in ("cliente_id", "proprietario_id"))
    ids.discard(None)
    return {"$or": [{"id": {"$in": list(ids)}}, {"created_by": principal.usuario_id}, {"papeis": "corretor"}]}


def visible_person(doc, principal):
    if not principal.is_admin and "corretor" in doc.get("papeis", []) and doc.get("id") != principal.pessoa_id:
        doc = {k: v for k, v in doc.items() if k in {"id", "nome", "papeis", "created_at"}}
    return to_pessoa(doc)


@router.get("", response_model=List[Pessoa])
async def list_pessoas(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000), papel: str | None = None, principal: Principal = Depends(require("pessoa:read"))):
    scope = await person_scope(principal)
    query = {"$and": [scope, {"papeis": papel}]} if papel else scope
    docs = await page(db.pessoas.find(query).sort("nome", 1), response, offset, limit)
    return [visible_person(d, principal) for d in docs]


@router.post("", response_model=Pessoa, status_code=201)
async def create_pessoa(input: PessoaCreate, principal: Principal = Depends(require("pessoa:create"))):
    pessoa = Pessoa(**input.model_dump())
    await db.pessoas.insert_one({**pessoa.model_dump(), "created_by": principal.usuario_id})
    return pessoa


@router.get("/{pessoa_id}", response_model=Pessoa)
async def get_pessoa(pessoa_id: str, principal: Principal = Depends(require("pessoa:read"))):
    doc = await db.pessoas.find_one({"$and": [{"id": pessoa_id}, await person_scope(principal)]})
    if not doc:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")
    return visible_person(doc, principal)


@router.put("/{pessoa_id}", response_model=Pessoa)
async def update_pessoa(
    pessoa_id: str, input: PessoaCreate, principal: Principal = Depends(require("pessoa:update"))
):
    doc = await db.pessoas.find_one({"$and": [{"id": pessoa_id}, await person_scope(principal)]})
    if not doc:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")
    data = input.model_dump()
    await db.pessoas.update_one({"id": pessoa_id}, {"$set": data})
    doc.update(data)
    return to_pessoa(doc)


@router.delete("/{pessoa_id}", status_code=204)
async def delete_pessoa(pessoa_id: str, principal: Principal = Depends(require("pessoa:delete"))):
    vinculado = (
        await db.imoveis.find_one({"proprietario_id": pessoa_id})
        or await db.leads.find_one({"$or": [{"cliente_id": pessoa_id}, {"corretor_id": pessoa_id}]})
        or await db.transacoes.find_one({"pessoa_id": pessoa_id})
        or await db.usuarios.find_one({"pessoa_id": pessoa_id})
    )
    vinculado = vinculado or await db.contratos.find_one({"$or": [{k: pessoa_id} for k in ("cliente_id", "corretor_id", "proprietario_id")]}) or await db.visitas.find_one({"$or": [{k: pessoa_id} for k in ("cliente_id", "corretor_id")]}) or await db.transacoes.find_one({"corretor_id": pessoa_id})
    if vinculado:
        raise HTTPException(
            status_code=409,
            detail="Pessoa vinculada a imóveis, leads, lançamentos ou usuários — remova os vínculos primeiro",
        )
    await db.pessoas.delete_one({"id": pessoa_id})
    return None
