from models.validated import ISODate, ISOTime, PositiveMoney, Nonnegative, Percent
"""Plano de contas hierárquico + transações financeiras (contas a pagar/receber) + relatórios."""

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc


class PlanoConta(BaseModel):
    id: str = Field(default_factory=new_id)
    codigo: str  # ex.: "1.1.1" — hierarquia legível
    nome: str = Field(min_length=1, max_length=1000)
    tipo: Literal["receita", "despesa"]  # conta
    conta_pai_id: str | None = None
    created_at: datetime = Field(default_factory=now_utc)


class PlanoContaCreate(BaseModel):
    codigo: str = Field(min_length=1, max_length=1000)
    nome: str = Field(min_length=1, max_length=1000)
    tipo: Literal["receita", "despesa"]
    conta_pai_id: str | None = None


class PlanoContaUpdate(BaseModel):
    codigo: str | None = None
    nome: str | None = None
    tipo: Literal["receita", "despesa"] | None = None
    conta_pai_id: str | None = None


class TransacaoFinanceira(BaseModel):
    """Lançamento de conta a pagar/receber. Vencimento/pagamento são strings ISO YYYY-MM-DD —
    BSON-safe, ordenam lexicograficamente e evitam a armadilha do datetime naive do motor."""

    id: str = Field(default_factory=new_id)
    descricao: str = Field(min_length=1, max_length=1000)
    tipo: Literal["receber", "pagar"]  # título
    valor: PositiveMoney
    plano_conta_id: str
    imovel_id: str | None = None
    pessoa_id: str | None = None
    corretor_id: str | None = None  # dono da comissão (Pessoa do corretor)
    evento_id: str | None = None
    cancelado_em: datetime | None = None
    contrato_id: str | None = None  # parcela gerada por um contrato
    agendamento_id: str | None = None  # receita/comissão de um atendimento concluído
    tratamento_id: str | None = None  # parcela de um plano de tratamento aprovado
    veiculo_id: str | None = None  # venda de veículo
    forma_pagamento: str | None = None
    vencimento: ISODate  # YYYY-MM-DD
    pagamento: ISODate | None = None  # YYYY-MM-DD quando realizado
    status: Literal["pendente", "pago", "cancelado"] = "pendente"  # pendente | pago
    vencido: bool = False  # derivado no servidor: pendente e vencimento < hoje
    created_at: datetime = Field(default_factory=now_utc)


class TransacaoCreate(BaseModel):
    descricao: str = Field(min_length=1, max_length=1000)
    tipo: Literal["receber", "pagar"]
    valor: PositiveMoney
    plano_conta_id: str
    imovel_id: str | None = None
    corretor_id: str | None = None
    pessoa_id: str | None = None
    vencimento: ISODate
    pagamento: ISODate | None = None
    status: Literal["pendente", "pago", "cancelado"] = "pendente"


class TransacaoUpdate(BaseModel):
    descricao: str | None = None
    tipo: Literal["receber", "pagar"] | None = None
    valor: PositiveMoney | None = None
    plano_conta_id: str | None = None
    imovel_id: str | None = None
    pessoa_id: str | None = None
    vencimento: ISODate | None = None
    pagamento: ISODate | None = None
    status: Literal["pendente", "pago", "cancelado"] | None = None


class FluxoMes(BaseModel):
    mes: str  # YYYY-MM
    receitas: float
    despesas: float
    saldo: float


class DreImovel(BaseModel):
    """Receita vs Despesa por imóvel — o resultado real de cada imóvel da carteira."""

    imovel_id: str
    titulo: str
    receitas: float  # realizado (recebido)
    despesas: float  # realizado (pago)
    resultado: float
    a_receber: float  # pendente
    a_pagar: float  # pendente


class ResumoFinanceiro(BaseModel):
    a_receber_pendente: float
    a_pagar_pendente: float
    recebido_mes: float
    pago_mes: float
    fluxo_mensal: List[FluxoMes]
    dre_imoveis: list[DreImovel] = Field(default_factory=list)
