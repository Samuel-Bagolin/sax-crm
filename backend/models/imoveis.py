from models.validated import ISODate, ISOTime, PositiveMoney, Nonnegative, Percent
"""Imóvel — o centro de custo/receita. Toda transação, lead ou operação aponta para ele."""

from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc
from models.financeiro import TransacaoFinanceira
from models.leads import Lead
from models.pessoas import Pessoa


class Imovel(BaseModel):
    id: str = Field(default_factory=new_id)
    # Código exclusivo e legível da captação (ex.: AP-0007) — gerado pelo servidor, nunca editável.
    codigo: str = ""
    titulo: str = Field(min_length=1, max_length=1000)
    tipo: Literal["apartamento", "casa", "terreno", "comercial"]  # apartamento | casa | terreno | comercial
    finalidade: Literal["venda", "locacao", "ambos"]  # venda | locacao | ambos
    status: Literal["captado", "publicado", "vendido", "alugado"] = "captado"  # captado | publicado | vendido | alugado
    endereco: str = Field(min_length=1, max_length=1000)
    bairro: str | None = None
    cidade: str = Field(min_length=1, max_length=1000)
    estado: str | None = None
    cep: str | None = None
    area_util: Nonnegative | None = None
    area_total: Nonnegative | None = None
    quartos: int = Field(default=0, ge=0, le=10000)
    suites: int = Field(default=0, ge=0, le=10000)
    vagas: int = Field(default=0, ge=0, le=10000)
    valor_venda: Nonnegative | None = None
    valor_aluguel: Nonnegative | None = None
    iptu: Nonnegative | None = None
    condominio: Nonnegative | None = None
    proprietario_id: str | None = None
    descricao: str | None = None
    foto_url: str | None = None
    banheiros: int = Field(default=0, ge=0, le=10000)
    publicar_portais: bool = False
    destaque_portal: Literal["STANDARD", "PREMIUM", "SUPER_PREMIUM"] = "STANDARD"
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class ImovelCreate(BaseModel):
    titulo: str = Field(min_length=1, max_length=1000)
    tipo: Literal["apartamento", "casa", "terreno", "comercial"]
    finalidade: Literal["venda", "locacao", "ambos"]
    status: Literal["captado", "publicado", "vendido", "alugado"] = "captado"
    endereco: str = Field(min_length=1, max_length=1000)
    bairro: str | None = None
    cidade: str = Field(min_length=1, max_length=1000)
    estado: str | None = None
    cep: str | None = None
    area_util: Nonnegative | None = None
    area_total: Nonnegative | None = None
    quartos: int = Field(default=0, ge=0, le=10000)
    suites: int = Field(default=0, ge=0, le=10000)
    vagas: int = Field(default=0, ge=0, le=10000)
    valor_venda: Nonnegative | None = None
    valor_aluguel: Nonnegative | None = None
    iptu: Nonnegative | None = None
    condominio: Nonnegative | None = None
    proprietario_id: str | None = None
    descricao: str | None = None
    foto_url: str | None = None
    banheiros: int = Field(default=0, ge=0, le=10000)
    publicar_portais: bool = False
    destaque_portal: Literal["STANDARD", "PREMIUM", "SUPER_PREMIUM"] = "STANDARD"


class ImovelUpdate(BaseModel):
    titulo: str | None = None
    tipo: Literal["apartamento", "casa", "terreno", "comercial"] | None = None
    finalidade: Literal["venda", "locacao", "ambos"] | None = None
    status: Literal["captado", "publicado", "vendido", "alugado"] | None = None
    endereco: str | None = None
    bairro: str | None = None
    cidade: str | None = None
    estado: str | None = None
    cep: str | None = None
    area_util: Nonnegative | None = None
    area_total: Nonnegative | None = None
    quartos: int | None = Field(default=None, ge=0, le=10000)
    suites: int | None = Field(default=None, ge=0, le=10000)
    vagas: int | None = Field(default=None, ge=0, le=10000)
    valor_venda: Nonnegative | None = None
    valor_aluguel: Nonnegative | None = None
    iptu: Nonnegative | None = None
    condominio: Nonnegative | None = None
    proprietario_id: str | None = None
    descricao: str | None = None
    foto_url: str | None = None
    banheiros: int | None = Field(default=None, ge=0, le=10000)
    publicar_portais: bool | None = None
    destaque_portal: Literal["STANDARD", "PREMIUM", "SUPER_PREMIUM"] | None = None


class ImovelDetalhe(Imovel):
    """Ficha completa do imóvel: proprietário + leads e lançamentos ligados a ele."""

    proprietario: Optional[Pessoa] = None
    transacoes: List[TransacaoFinanceira] = []
    leads: List[Lead] = []
    contrato_vigente: Optional["ContratoVigente"] = None
    rendimento_recebido: float = 0  # receitas já pagas do imóvel
    rendimento_a_receber: float = 0  # receitas pendentes
    despesas_pagas: float = 0


class ContratoVigente(BaseModel):
    """Resumo do contrato ativo do imóvel, exibido na ficha."""

    id: str
    numero: str
    tipo: str  # venda | locacao
    valor: float
    inicio: ISODate
    fim: Optional[str] = None
    parcelas: int
    cliente_nome: Optional[str] = None
    corretor_nome: Optional[str] = None
    total_gerado: float = 0
    total_recebido: float = 0
    parcelas_pagas: int = 0


ImovelDetalhe.model_rebuild()
