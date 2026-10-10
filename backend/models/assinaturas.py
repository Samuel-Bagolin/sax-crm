"""Assinatura eletrônica própria de contratos — documento, signatários e trilha de auditoria."""

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from models.common import new_id, now_utc

PapelSignatario = Literal[
    "comprador", "vendedor", "locatario", "locador", "fiador", "testemunha", "imobiliaria", "loja", "corretor", "outro"
]


class Signatario(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=2, max_length=200)
    email: str | None = None
    telefone: str | None = None
    cpf: str | None = None
    papel: PapelSignatario = "outro"
    token: str | None = None  # link de assinatura (capability URL) — só para usuários autorizados
    status: Literal["pendente", "visualizado", "assinado", "recusado"] = "pendente"
    visualizado_em: datetime | None = None
    assinado_em: datetime | None = None
    recusado_em: datetime | None = None
    motivo_recusa: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    nome_assinado: str | None = None
    cpf_informado: str | None = None
    assinatura_tipo: Literal["desenho", "digitada"] | None = None
    tem_assinatura: bool = False
    enviado_em: datetime | None = None


class SignatarioInput(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    telefone: str | None = Field(default=None, max_length=40)
    cpf: str | None = Field(default=None, max_length=20)
    papel: PapelSignatario = "outro"


class DocumentoContrato(BaseModel):
    titulo: str = Field(default="Contrato", max_length=200)
    texto: str = Field(default="", max_length=200_000)
    hash: str | None = None
    modelo_id: str | None = None
    atualizado_em: datetime | None = None


class DocumentoInput(BaseModel):
    titulo: str = Field(min_length=2, max_length=200)
    texto: str = Field(min_length=20, max_length=200_000)


class GerarDocumentoInput(BaseModel):
    modelo_id: str


class EventoAssinatura(BaseModel):
    em: datetime = Field(default_factory=now_utc)
    texto: str
    ip: str | None = None


class PainelAssinatura(BaseModel):
    contrato_id: str
    numero: str
    status: Literal["rascunho", "aguardando", "assinado", "recusado"] = "rascunho"
    documento: DocumentoContrato | None = None
    signatarios: List[Signatario] = Field(default_factory=list)
    eventos: List[EventoAssinatura] = Field(default_factory=list)
    bloqueado: bool = False  # alguém já assinou: o texto não pode mais mudar


class AssinarInput(BaseModel):
    nome: str = Field(min_length=3, max_length=200)
    cpf: str = Field(min_length=11, max_length=20)
    assinatura_png: str = Field(min_length=100, max_length=600_000)
    assinatura_tipo: Literal["desenho", "digitada"] = "desenho"
    aceite: bool


class RecusarInput(BaseModel):
    motivo: str = Field(min_length=3, max_length=500)


class SignatarioPublico(BaseModel):
    nome: str
    papel: str
    status: str
    assinado_em: datetime | None = None


class DocumentoPublico(BaseModel):
    empresa_nome: str
    cor_primaria: str = "#4a03a2"
    tem_logo: bool = False
    empresa_slug: str | None = None
    contrato_numero: str
    titulo: str
    texto: str
    hash: str
    signatario: Signatario
    signatarios: List[SignatarioPublico]
    concluido: bool = False


class ModeloContrato(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=2, max_length=120)
    tipo: Literal["venda", "locacao", "outro"] = "outro"
    texto: str = Field(min_length=20, max_length=200_000)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class ModeloInput(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    tipo: Literal["venda", "locacao", "outro"] = "outro"
    texto: str = Field(min_length=20, max_length=200_000)
