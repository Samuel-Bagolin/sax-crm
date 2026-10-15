"""Importar e exportar dados da empresa por planilha (clientes, leads e negócios), em todos os segmentos.

O gestor usa na própria empresa (tela Importar dados); o administrador SAX usa em qualquer empresa pelo
card dela em Empresas (rotas em `routers/plataforma.py`). A regra fica em `lib/dados_planilha.py`.
"""

import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from lib import dados_planilha as dp
from lib.auth import Principal, require
from lib.db import db
from lib.integrity import audit

router = APIRouter(prefix="/dados", tags=["dados"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ImportarDadosIn(BaseModel):
    arquivo_base64: str = Field(min_length=10, max_length=4_400_000)  # o Vercel aceita até ~4,5 MB por envio
    simular: bool = True


def arquivo(conteudo: bytes, nome: str) -> Response:
    nome = re.sub(r"[^A-Za-z0-9_.-]+", "_", nome)[:80]
    return Response(conteudo, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{nome}"', "Cache-Control": "no-store"})


def decodificar(b64: str) -> bytes:
    try:
        return base64.b64decode(b64.split(",")[-1], validate=False)
    except Exception:
        raise HTTPException(422, "Arquivo inválido")


async def _nome_empresa() -> str:
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1}) or {}
    return cfg.get("nome_software") or "empresa"


@router.get("/modelo")
async def baixar_modelo(principal: Principal = Depends(require("dados:importar"))):
    return arquivo(await dp.modelo(db, principal.segmento), f"Modelo de dados {await _nome_empresa()}.xlsx")


@router.get("/exportar")
async def exportar(principal: Principal = Depends(require("dados:exportar"))):
    conteudo = await dp.exportar(db, principal.segmento)
    await audit(principal, "dados.exportar", "empresa")
    return arquivo(conteudo, f"Dados {await _nome_empresa()}.xlsx")


@router.post("/importar")
async def importar(input: ImportarDadosIn, principal: Principal = Depends(require("dados:importar"))):
    try:
        r = await dp.importar(db, principal.segmento, decodificar(input.arquivo_base64), simular=input.simular,
                              por=principal.nome, por_usuario_id=principal.usuario_id)
    except dp.ErroPlanilha as e:
        raise HTTPException(422, str(e))
    if not input.simular:
        await audit(principal, "dados.importar", "empresa", None, r["contagens"])
    return r
