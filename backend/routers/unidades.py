"""Unidades da empresa: lojas, clínicas ou filiais.

Toda empresa nasce com uma unidade principal. Mais unidades dependem do plano (limite `unidades`).
Agenda, profissionais e estoque podem ser filtrados por unidade. Unidade com histórico não é
apagada: é desativada, para não perder o vínculo de agendamentos e veículos antigos.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from lib.auth import Principal, require
from lib.db import db
from lib.planos import exigir_limite
from models.common import new_id, now_utc

router = APIRouter(prefix="/unidades", tags=["unidades"])


class Unidade(BaseModel):
    id: str
    nome: str
    principal: bool = False
    ativa: bool = True
    endereco: str | None = None
    cidade: str | None = None
    telefone: str | None = None
    whatsapp: str | None = None
    cadeiras: int | None = None  # postos de atendimento (cadeiras da barbearia, salas ou consultórios)


class UnidadeIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    endereco: str | None = Field(default=None, max_length=200)
    cidade: str | None = Field(default=None, max_length=80)
    telefone: str | None = Field(default=None, max_length=30)
    whatsapp: str | None = Field(default=None, max_length=30)
    cadeiras: int | None = Field(default=None, ge=0, le=200)
    ativa: bool = True


def _saida(d: dict) -> Unidade:
    return Unidade(**{k: d.get(k) for k in Unidade.model_fields if k in d})


async def garantir_principal() -> dict:
    """Empresas anteriores às unidades ganham a unidade principal na primeira leitura."""
    principal = await db.unidades.find_one({"principal": True})
    if principal:
        return principal
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1}) or {}
    doc = {"id": new_id(), "nome": cfg.get("nome_software") or "Unidade principal", "principal": True, "ativa": True,
           "endereco": None, "cidade": None, "telefone": None, "whatsapp": None, "created_at": now_utc()}
    await db.unidades.insert_one(doc)
    return doc


@router.get("", response_model=List[Unidade])
async def listar(principal: Principal = Depends(require("unidade:read"))):
    await garantir_principal()
    docs = await db.unidades.find({}).to_list(200)
    docs.sort(key=lambda d: (not d.get("principal"), not d.get("ativa", True), d.get("nome", "")))
    return [_saida(d) for d in docs]


@router.post("", response_model=Unidade, status_code=201)
async def criar(input: UnidadeIn, principal: Principal = Depends(require("unidade:manage"))):
    await garantir_principal()
    await exigir_limite("unidades")
    if await db.unidades.find_one({"nome": input.nome.strip()}):
        raise HTTPException(409, "Já existe uma unidade com esse nome")
    doc = {"id": new_id(), **input.model_dump(), "nome": input.nome.strip(), "principal": False, "created_at": now_utc()}
    await db.unidades.insert_one(doc)
    return _saida(doc)


@router.put("/{unidade_id}", response_model=Unidade)
async def editar(unidade_id: str, input: UnidadeIn, principal: Principal = Depends(require("unidade:manage"))):
    doc = await db.unidades.find_one({"id": unidade_id})
    if not doc:
        raise HTTPException(404, "Unidade não encontrada")
    if doc.get("principal") and not input.ativa:
        raise HTTPException(409, "A unidade principal não pode ser desativada")
    if input.ativa and not doc.get("ativa", True):
        await exigir_limite("unidades")
    dados = {**input.model_dump(), "nome": input.nome.strip(), "updated_at": now_utc()}
    await db.unidades.update_one({"id": unidade_id}, {"$set": dados})
    return _saida({**doc, **dados})


@router.delete("/{unidade_id}", status_code=204)
async def excluir(unidade_id: str, principal: Principal = Depends(require("unidade:manage"))):
    doc = await db.unidades.find_one({"id": unidade_id})
    if not doc:
        raise HTTPException(404, "Unidade não encontrada")
    if doc.get("principal"):
        raise HTTPException(409, "A unidade principal não pode ser excluída")
    usada = await db.agendamentos.find_one({"unidade_id": unidade_id}, {"id": 1}) or await db.veiculos.find_one({"unidade_id": unidade_id}, {"id": 1})
    if usada:
        raise HTTPException(409, "Esta unidade tem histórico. Desative em vez de excluir.")
    await db.unidades.delete_one({"id": unidade_id})
    return Response(status_code=204)
