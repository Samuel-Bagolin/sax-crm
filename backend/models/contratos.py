from models.validated import ISODate, ISOTime, PositiveMoney, Nonnegative, Percent
"""Contrato — o elo final: transforma o lead ganho em operação financeira (parcelas geradas)."""

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc
from models.financeiro import TransacaoFinanceira

TIPOS_CONTRATO = ["venda", "locacao"]


class Contrato(BaseModel):
    id: str = Field(default_factory=new_id)
    numero: str  # legível: CT-2026-0001
    tipo: Literal["venda", "locacao"]
    lead_id: str | None = None
    imovel_id: str | None = None  # imobiliária
    veiculo_id: str | None = None  # loja de veículos
    forma_pagamento: str | None = None  # loja de veículos: à vista, financiado, troca...
    cliente_id: str | None = None  # comprador/inquilino
    proprietario_id: str | None = None
    corretor_id: str | None = None  # dono do contrato (pessoa_id do corretor)
    valor: PositiveMoney  # venda: valor total · locação: aluguel mensal
    comissao_pct: Percent = 5.0
    taxa_admin_pct: Percent = 10.0  # só locação
    inicio: ISODate  # YYYY-MM-DD
    fim: ISODate | None = None  # vigência (obrigatória na locação)
    parcelas: int = Field(default=1, ge=1, le=600)
    dia_vencimento: int = Field(default=10, ge=1, le=31)
    status: Literal["ativo", "encerrado", "cancelado"] = "ativo"
    financeiro_status: str = "legado"
    assinatura_status: str = "rascunho"  # rascunho | aguardando | assinado | recusado
    observacoes: str | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class ContratoCreate(BaseModel):
    request_id: str | None = Field(default=None, min_length=16, max_length=100)
    tipo: Literal["venda", "locacao"]
    imovel_id: str | None = None
    veiculo_id: str | None = None
    forma_pagamento: str | None = Field(default=None, max_length=120)
    lead_id: str | None = None
    cliente_id: str | None = None
    proprietario_id: str | None = None
    corretor_id: str | None = None
    valor: PositiveMoney
    comissao_pct: Percent = 5.0
    taxa_admin_pct: Percent = 10.0
    inicio: ISODate
    fim: ISODate | None = None
    # Deixe nulo para o servidor calcular (venda = 1; locação = meses da vigência).
    parcelas: int | None = Field(default=None, ge=1, le=600)
    dia_vencimento: int | None = Field(default=None, ge=1, le=31)
    observacoes: str | None = None


class ContratoUpdate(BaseModel):
    """Edição de valores/vigência é exclusiva do admin (ação `contrato:update`)."""

    valor: PositiveMoney | None = None
    comissao_pct: Percent | None = None
    taxa_admin_pct: Percent | None = None
    inicio: ISODate | None = None
    fim: ISODate | None = None
    status: Literal["ativo", "encerrado", "cancelado"] | None = None
    observacoes: str | None = None


class ContratoDetalhe(Contrato):
    imovel_titulo: str | None = None
    veiculo_titulo: str | None = None
    cliente_nome: str | None = None
    proprietario_nome: str | None = None
    corretor_nome: str | None = None
    total_gerado: float = 0
    total_recebido: float = 0
    transacoes: List[TransacaoFinanceira] = Field(default_factory=list)
