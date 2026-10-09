"""Catálogo de planos e plano da empresa logada (para a tela mostrar uso e esconder o que não está contratado)."""

from typing import Dict, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from lib.auth import Principal, principal_atual
from lib.planos import PLANOS, RECURSOS, plano_atual, uso_atual

router = APIRouter(tags=["planos"])


class PlanoCatalogo(BaseModel):
    chave: str
    nome: str
    preco: float | None
    implantacao: float | None
    usuarios: int | None
    imoveis: int | None
    modulos: List[str]
    recursos: List[str]
    resumo: str


class PlanoAtual(PlanoCatalogo):
    uso_usuarios: int = 0
    uso_imoveis: int = 0


class Catalogo(BaseModel):
    planos: List[PlanoCatalogo]
    recursos: Dict[str, str]


@router.get("/planos", response_model=Catalogo)
async def catalogo(principal: Principal = Depends(principal_atual)):
    return Catalogo(planos=[PlanoCatalogo(chave=k, **{c: v[c] for c in PlanoCatalogo.model_fields if c != "chave"}) for k, v in PLANOS.items()],
                    recursos=RECURSOS)


@router.get("/plano", response_model=PlanoAtual)
async def meu_plano(principal: Principal = Depends(principal_atual)):
    plano = await plano_atual()
    uso = await uso_atual() if principal.empresa_id else {"usuarios": 0, "imoveis": 0}
    return PlanoAtual(**{c: plano.get(c) for c in PlanoCatalogo.model_fields}, uso_usuarios=uso["usuarios"], uso_imoveis=uso["imoveis"])
