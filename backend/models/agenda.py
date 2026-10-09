from models.validated import ISODate, ISOTime, PositiveMoney, Nonnegative, Percent
"""Agenda de Visitas — visita agendada ligada a um lead/imóvel e ao corretor responsável."""

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc

STATUS_VISITA = ["agendada", "realizada", "cancelada"]


class Visita(BaseModel):
    id: str = Field(default_factory=new_id)
    titulo: str = Field(min_length=1, max_length=1000)
    data: ISODate  # YYYY-MM-DD (data local da imobiliária, ancorada no servidor)
    hora: ISOTime = "09:00"  # HH:MM
    duracao_min: int = Field(default=60, ge=1, le=1440)
    lead_id: str | None = None
    imovel_id: str | None = None
    cliente_id: str | None = None
    corretor_id: str | None = None  # dono do registro (pessoa_id do corretor)
    local: str | None = None
    observacoes: str | None = None
    feedback_proprietario: str | None = Field(default=None, max_length=1000)  # aparece no relatório do proprietário
    status: Literal["agendada", "realizada", "cancelada"] = "agendada"
    lembrete_enviado_em: datetime | None = None
    lembrete_cliente_em: datetime | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class VisitaCreate(BaseModel):
    titulo: str = Field(min_length=1, max_length=1000)
    data: ISODate
    hora: ISOTime = "09:00"
    duracao_min: int = Field(default=60, ge=1, le=1440)
    lead_id: str | None = None
    imovel_id: str | None = None
    cliente_id: str | None = None
    corretor_id: str | None = None
    local: str | None = None
    observacoes: str | None = None
    feedback_proprietario: str | None = Field(default=None, max_length=1000)
    status: Literal["agendada", "realizada", "cancelada"] = "agendada"


class VisitaUpdate(BaseModel):
    titulo: str | None = None
    data: ISODate | None = None
    hora: ISOTime | None = None
    duracao_min: int | None = Field(default=None, ge=1, le=1440)
    lead_id: str | None = None
    imovel_id: str | None = None
    cliente_id: str | None = None
    corretor_id: str | None = None
    local: str | None = None
    observacoes: str | None = None
    feedback_proprietario: str | None = Field(default=None, max_length=1000)
    status: Literal["agendada", "realizada", "cancelada"] | None = None


class AvisoVisitas(BaseModel):
    """Aviso do dia anterior: o que o corretor vê no topo do sistema."""

    amanha: str  # YYYY-MM-DD
    total_amanha: int
    total_hoje: int
    visitas_amanha: List[Visita] = Field(default_factory=list)
    visitas_hoje: List[Visita] = Field(default_factory=list)


class LembreteResultado(BaseModel):
    data_alvo: str
    visitas_encontradas: int
    emails_enviados: int
    detalhes: List[str] = Field(default_factory=list)
