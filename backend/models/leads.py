from models.validated import ISODate, ISOTime, PositiveMoney, Nonnegative, Percent
"""Negócio (deal) do CRM — coleção `leads` mantida por compatibilidade com contratos/visitas.

Modelo estilo Pipedrive: o negócio vive em um FUNIL (`funil_id`) e numa ETAPA (`etapa_id`);
o resultado é um STATUS separado (aberto | ganho | perdido). O campo legado `estagio` continua
sincronizado para os módulos antigos (contrato exige negócio ganho).
"""

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc

ESTAGIOS = ["novo", "atendimento", "visita", "proposta", "ganho", "perdido"]
ESTAGIOS_FECHADOS = {"ganho", "perdido"}
STATUS_NEGOCIO = ["aberto", "ganho", "perdido"]

Estagio = Literal["novo", "atendimento", "visita", "proposta", "ganho", "perdido"]
StatusNegocio = Literal["aberto", "ganho", "perdido"]


class Lead(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=1, max_length=1000)
    cliente_id: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    origem: str = "Indicação / Carteira"
    estagio: Estagio = "novo"  # legado — derivado de etapa/status
    valor_estimado: Nonnegative | None = None
    observacoes: str | None = None
    # --- Pipedrive ---
    funil_id: str | None = None
    etapa_id: str | None = None
    status: StatusNegocio = "aberto"
    etapa_desde: datetime | None = None  # quando entrou na etapa atual (para "negócio parado")
    motivo_perda: str | None = None
    previsao_fechamento: ISODate | None = None
    etiquetas: List[str] = Field(default_factory=list)
    entrada_id: str | None = None  # lead da caixa de entrada que originou o negócio
    etapas_alcancadas: List[str] = Field(default_factory=list)  # funil por alcance: voltar o card não apaga
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)
    closed_at: datetime | None = None


class LeadCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=1000)
    cliente_id: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    origem: str = "Indicação / Carteira"
    estagio: Estagio | None = None
    valor_estimado: Nonnegative | None = None
    observacoes: str | None = None
    funil_id: str | None = None
    etapa_id: str | None = None
    previsao_fechamento: ISODate | None = None
    etiquetas: List[str] = Field(default_factory=list)


class LeadUpdate(BaseModel):
    nome: str | None = None
    cliente_id: str | None = None
    imovel_id: str | None = None
    corretor_id: str | None = None
    origem: str | None = None
    estagio: Estagio | None = None
    valor_estimado: Nonnegative | None = None
    observacoes: str | None = None
    funil_id: str | None = None
    etapa_id: str | None = None
    previsao_fechamento: ISODate | None = None
    etiquetas: List[str] | None = None


class OrigemCount(BaseModel):
    origem: str
    total: int


class LeadMetricas(BaseModel):
    """Métricas automáticas do funil — calculadas no servidor a partir do clock UTC do pod."""

    total_leads: int
    leads_abertos: int
    tempo_medio_fechamento_dias: float | None = None
    taxa_conversao: float | None = None
    por_estagio: dict[str, int] = Field(default_factory=dict)
    origens: List[OrigemCount] = Field(default_factory=list)
    # Pipedrive
    valor_aberto: float = 0
    valor_ponderado: float = 0
    ganhos_valor: float = 0
    ganhos_mes: int = 0
    perdidos_mes: int = 0
    motivos_perda: List[OrigemCount] = Field(default_factory=list)
