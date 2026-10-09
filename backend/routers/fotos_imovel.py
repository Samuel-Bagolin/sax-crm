"""Galeria de fotos do imóvel.

As fotos chegam já redimensionadas pelo navegador (lado maior 1600 px, JPEG) e ficam em coleção
própria, fora do documento do imóvel. A URL pública (`/api/publico/foto/{id}`) é o que portais,
vitrine do cliente e relatório do proprietário usam: o id é aleatório e o índice no banco de
controle diz em qual empresa ela está. A primeira foto vira a capa (`imoveis.foto_url`).
"""

import os
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from lib.auth import Principal, require
from lib.db import controle, db, definir_empresa, empresa_atual_db
from models.common import new_id, now_utc

router = APIRouter(prefix="/imoveis", tags=["imoveis"])
publico_router = APIRouter(prefix="/publico/foto", tags=["publico"])

LIMITE_FOTO = 2 * 1024 * 1024
MAX_FOTOS = 40
_ASSINATURAS = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png", b"RIFF": "image/webp"}


class FotoImovel(BaseModel):
    id: str
    url: str
    ordem: int
    tamanho: int


class OrdemFotos(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=MAX_FOTOS)


def url_publica(foto_id: str, absoluta: bool = False) -> str:
    caminho = f"/api/publico/foto/{foto_id}"
    return (os.environ.get("APP_URL", "").rstrip("/") + caminho) if absoluta else caminho


def _mime(dados: bytes) -> str | None:
    for prefixo, mime in _ASSINATURAS.items():
        if dados.startswith(prefixo):
            if mime == "image/webp" and dados[8:12] != b"WEBP":
                return None
            return mime
    return None


async def _imovel(imovel_id: str) -> dict:
    doc = await db.imoveis.find_one({"id": imovel_id}, {"id": 1, "foto_url": 1})
    if not doc:
        raise HTTPException(404, "Imóvel não encontrado")
    return doc


async def listar(imovel_id: str) -> list[dict]:
    return await db.fotos_imovel.find({"imovel_id": imovel_id}, {"dados": 0}).sort("ordem", 1).to_list(None)


async def atualizar_capa(imovel_id: str) -> None:
    """A capa acompanha a primeira foto; URL externa digitada à mão é preservada se não houver galeria."""
    primeira = await db.fotos_imovel.find_one({"imovel_id": imovel_id}, {"id": 1}, sort=[("ordem", 1)])
    if primeira:
        await db.imoveis.update_one({"id": imovel_id}, {"$set": {"foto_url": url_publica(primeira["id"]), "updated_at": now_utc()}})
    else:
        await db.imoveis.update_one({"id": imovel_id, "foto_url": {"$regex": "^/api/publico/foto/"}},
                                    {"$set": {"foto_url": None, "updated_at": now_utc()}})


def _saida(d: dict) -> FotoImovel:
    return FotoImovel(id=d["id"], url=url_publica(d["id"]), ordem=d.get("ordem", 0), tamanho=d.get("tamanho", 0))


@router.get("/{imovel_id}/fotos", response_model=List[FotoImovel])
async def fotos(imovel_id: str, principal: Principal = Depends(require("imovel:read"))):
    await _imovel(imovel_id)
    return [_saida(d) for d in await listar(imovel_id)]


@router.post("/{imovel_id}/fotos", response_model=List[FotoImovel], status_code=201)
async def enviar(imovel_id: str, arquivos: List[UploadFile] = File(...), principal: Principal = Depends(require("imovel:update"))):
    await _imovel(imovel_id)
    existentes = await db.fotos_imovel.count_documents({"imovel_id": imovel_id})
    if existentes + len(arquivos) > MAX_FOTOS:
        raise HTTPException(422, f"Cada imóvel aceita até {MAX_FOTOS} fotos")
    ultima = await db.fotos_imovel.find_one({"imovel_id": imovel_id}, {"ordem": 1}, sort=[("ordem", -1)])
    ordem = (ultima or {}).get("ordem", -1) + 1
    for arquivo in arquivos:
        dados = await arquivo.read(LIMITE_FOTO + 1)
        if len(dados) > LIMITE_FOTO:
            raise HTTPException(413, f"{arquivo.filename}: foto acima de 2 MB")
        mime = _mime(dados)
        if not mime:
            raise HTTPException(415, f"{arquivo.filename}: envie JPG, PNG ou WEBP")
        fid = new_id()
        await db.fotos_imovel.insert_one({"id": fid, "imovel_id": imovel_id, "ordem": ordem, "mime": mime, "dados": dados,
                                          "tamanho": len(dados), "created_by": principal.usuario_id, "created_at": now_utc()})
        await controle.fotos_index.insert_one({"_id": fid, "db_name": empresa_atual_db()})
        ordem += 1
    await atualizar_capa(imovel_id)
    return [_saida(d) for d in await listar(imovel_id)]


@router.put("/{imovel_id}/fotos/ordem", response_model=List[FotoImovel])
async def reordenar(imovel_id: str, input: OrdemFotos, principal: Principal = Depends(require("imovel:update"))):
    await _imovel(imovel_id)
    atuais = {d["id"] for d in await listar(imovel_id)}
    if set(input.ids) != atuais:
        raise HTTPException(422, "Envie todas as fotos do imóvel na nova ordem")
    for i, fid in enumerate(input.ids):
        await db.fotos_imovel.update_one({"id": fid, "imovel_id": imovel_id}, {"$set": {"ordem": i}})
    await atualizar_capa(imovel_id)
    return [_saida(d) for d in await listar(imovel_id)]


@router.delete("/{imovel_id}/fotos/{foto_id}", status_code=204)
async def remover(imovel_id: str, foto_id: str, principal: Principal = Depends(require("imovel:update"))):
    r = await db.fotos_imovel.delete_one({"id": foto_id, "imovel_id": imovel_id})
    if not r.deleted_count:
        raise HTTPException(404, "Foto não encontrada")
    await controle.fotos_index.delete_one({"_id": foto_id})
    await atualizar_capa(imovel_id)
    return None


async def remover_todas(imovel_id: str) -> None:
    ids = [d["id"] async for d in db.fotos_imovel.find({"imovel_id": imovel_id}, {"id": 1})]
    if ids:
        await db.fotos_imovel.delete_many({"imovel_id": imovel_id})
        await controle.fotos_index.delete_many({"_id": {"$in": ids}})


@publico_router.get("/{foto_id}")
async def foto_publica(foto_id: str):
    if len(foto_id) > 64:
        raise HTTPException(404, "Foto não encontrada")
    indice = await controle.fotos_index.find_one({"_id": foto_id})
    if not indice:
        raise HTTPException(404, "Foto não encontrada")
    definir_empresa(indice.get("db_name"))
    doc = await db.fotos_imovel.find_one({"id": foto_id})
    if not doc:
        raise HTTPException(404, "Foto não encontrada")
    return Response(bytes(doc["dados"]), media_type=doc.get("mime", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=604800, immutable"})
