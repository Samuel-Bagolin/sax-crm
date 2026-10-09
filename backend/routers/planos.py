"""Catálogo de planos e adicionais (editável pelo Administrador de Sistema) e plano da empresa logada."""

import re
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from lib.auth import Principal, principal_atual, require
from lib.db import controle
from lib.planos import ADICIONAIS, PLANOS, RECURSOS, TIPOS_ADICIONAL, carregar_catalogo, plano_atual, uso_atual
from models.config import MODULOS, TITULOS_PADRAO

router = APIRouter(tags=["planos"])

Dinheiro = Field(default=None, ge=0, le=10_000_000)


class PlanoCatalogo(BaseModel):
    chave: str
    nome: str
    preco: float | None
    preco_mensal: float | None = None
    preco_anual: float | None = None
    implantacao: float | None
    usuarios: int | None
    imoveis: int | None
    modulos: List[str]
    recursos: List[str]
    resumo: str
    ativo: bool = True
    ordem: int = 50


class Adicional(BaseModel):
    chave: str
    nome: str
    descricao: str = ""
    tipo: Literal["recurso", "usuarios", "imoveis", "servico"]
    recurso: str | None = None
    quantidade_por_unidade: int = 1
    preco_mensal: float = 0
    preco_anual: float | None = None
    ativo: bool = True


class PlanoAtual(PlanoCatalogo):
    uso_usuarios: int = 0
    uso_imoveis: int = 0


class Catalogo(BaseModel):
    planos: List[PlanoCatalogo]
    adicionais: List[Adicional] = []
    recursos: Dict[str, str]
    modulos: Dict[str, str] = {}
    tipos_adicional: Dict[str, str] = {}


class PlanoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=60)
    resumo: str = Field(default="", max_length=300)
    preco_mensal: float = Field(ge=0, le=10_000_000)
    preco_anual: Optional[float] = Dinheiro
    implantacao: Optional[float] = Dinheiro
    usuarios: Optional[int] = Field(default=None, ge=1, le=100_000)
    imoveis: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    modulos: List[str] = Field(default_factory=list)
    recursos: List[str] = Field(default_factory=list)
    ativo: bool = True
    ordem: int = Field(default=50, ge=0, le=999)

    @field_validator("modulos")
    @classmethod
    def _modulos(cls, v: List[str]) -> List[str]:
        if any(m not in MODULOS for m in v):
            raise ValueError("Módulo inválido")
        return sorted(set(v) | {"dashboard"}, key=MODULOS.index)

    @field_validator("recursos")
    @classmethod
    def _recursos(cls, v: List[str]) -> List[str]:
        if any(r not in RECURSOS for r in v):
            raise ValueError("Funcionalidade inválida")
        return [r for r in RECURSOS if r in v]


class AdicionalIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    descricao: str = Field(default="", max_length=300)
    tipo: Literal["recurso", "usuarios", "imoveis", "servico"]
    recurso: Optional[str] = None
    quantidade_por_unidade: int = Field(default=1, ge=1, le=100_000)
    preco_mensal: float = Field(ge=0, le=10_000_000)
    preco_anual: Optional[float] = Dinheiro
    ativo: bool = True


def _chave(nome: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40] or "item"


def _plano_saida(chave: str, p: dict) -> PlanoCatalogo:
    return PlanoCatalogo(chave=chave, **{c: p.get(c) for c in PlanoCatalogo.model_fields if c != "chave"})


@router.get("/planos", response_model=Catalogo)
async def catalogo(todos: bool = Query(False), principal: Principal = Depends(principal_atual)):
    await carregar_catalogo()
    mostrar_inativos = todos and principal.is_sysadmin
    return Catalogo(
        planos=[_plano_saida(k, v) for k, v in PLANOS.items() if mostrar_inativos or v.get("ativo", True)],
        adicionais=[Adicional(**v) for v in ADICIONAIS.values() if mostrar_inativos or v.get("ativo", True)],
        recursos=RECURSOS,
        modulos={m: TITULOS_PADRAO.get(m, m) for m in MODULOS},
        tipos_adicional=TIPOS_ADICIONAL,
    )


@router.get("/plano", response_model=PlanoAtual)
async def meu_plano(principal: Principal = Depends(principal_atual)):
    plano = await plano_atual()
    uso = await uso_atual() if principal.empresa_id else {"usuarios": 0, "imoveis": 0}
    return PlanoAtual(**{c: plano.get(c) for c in PlanoCatalogo.model_fields}, uso_usuarios=uso["usuarios"], uso_imoveis=uso["imoveis"])


# ------------------------------------------------------------------ edição do catálogo (Administrador de Sistema)


@router.post("/planos", response_model=PlanoCatalogo, status_code=201)
async def criar_plano(input: PlanoIn, principal: Principal = Depends(require("empresa:manage"))):
    await carregar_catalogo(forcar=True)
    chave = _chave(input.nome)
    if chave in PLANOS or chave == "legado":
        raise HTTPException(409, "Já existe um plano com esse nome")
    doc = {"_id": chave, "chave": chave, **input.model_dump()}
    await controle.planos_catalogo.insert_one(doc)
    await carregar_catalogo(forcar=True)
    return _plano_saida(chave, PLANOS[chave])


@router.put("/planos/{chave}", response_model=PlanoCatalogo)
async def editar_plano(chave: str, input: PlanoIn, principal: Principal = Depends(require("empresa:manage"))):
    await carregar_catalogo(forcar=True)
    if chave not in PLANOS:
        raise HTTPException(404, "Plano não encontrado")
    if not input.ativo and not [p for k, p in PLANOS.items() if k != chave and p.get("ativo", True)]:
        raise HTTPException(422, "Mantenha pelo menos um plano ativo")
    await controle.planos_catalogo.update_one({"_id": chave}, {"$set": input.model_dump()})
    await carregar_catalogo(forcar=True)
    return _plano_saida(chave, PLANOS[chave])


@router.delete("/planos/{chave}", status_code=204)
async def excluir_plano(chave: str, principal: Principal = Depends(require("empresa:manage"))):
    await carregar_catalogo(forcar=True)
    if chave not in PLANOS:
        raise HTTPException(404, "Plano não encontrado")
    em_uso = await controle.empresas.count_documents({"plano": chave, "plano_aplicado": True})
    if em_uso:
        raise HTTPException(409, f"{em_uso} empresa(s) usam este plano. Desative o plano em vez de excluir.")
    await controle.planos_catalogo.delete_one({"_id": chave})
    await carregar_catalogo(forcar=True)
    return None


def _validar_adicional(input: AdicionalIn) -> dict:
    data = input.model_dump()
    if input.tipo == "recurso":
        if input.recurso not in RECURSOS:
            raise HTTPException(422, "Escolha a funcionalidade que o adicional libera")
    else:
        data["recurso"] = None
    if input.tipo not in ("usuarios", "imoveis"):
        data["quantidade_por_unidade"] = 1
    return data


@router.post("/adicionais", response_model=Adicional, status_code=201)
async def criar_adicional(input: AdicionalIn, principal: Principal = Depends(require("empresa:manage"))):
    await carregar_catalogo(forcar=True)
    chave = _chave(input.nome)
    if chave in ADICIONAIS:
        raise HTTPException(409, "Já existe um adicional com esse nome")
    data = _validar_adicional(input)
    await controle.adicionais.insert_one({"_id": chave, "chave": chave, **data})
    await carregar_catalogo(forcar=True)
    return Adicional(**ADICIONAIS[chave])


@router.put("/adicionais/{chave}", response_model=Adicional)
async def editar_adicional(chave: str, input: AdicionalIn, principal: Principal = Depends(require("empresa:manage"))):
    await carregar_catalogo(forcar=True)
    if chave not in ADICIONAIS:
        raise HTTPException(404, "Adicional não encontrado")
    await controle.adicionais.update_one({"_id": chave}, {"$set": _validar_adicional(input)})
    await carregar_catalogo(forcar=True)
    return Adicional(**ADICIONAIS[chave])


@router.delete("/adicionais/{chave}", status_code=204)
async def excluir_adicional(chave: str, principal: Principal = Depends(require("empresa:manage"))):
    await carregar_catalogo(forcar=True)
    if chave not in ADICIONAIS:
        raise HTTPException(404, "Adicional não encontrado")
    em_uso = 0
    async for e in controle.empresas.find({}, {"comercial": 1}):
        if any(a.get("chave") == chave for a in ((e.get("comercial") or {}).get("adicionais") or [])):
            em_uso += 1
    if em_uso:
        raise HTTPException(409, f"{em_uso} empresa(s) têm este adicional. Desative-o em vez de excluir.")
    await controle.adicionais.delete_one({"_id": chave})
    await carregar_catalogo(forcar=True)
    return None
