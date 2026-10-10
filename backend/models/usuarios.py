"""Usuários do sistema (identidade + papel). O papel vive AQUI, nunca nos documentos de domínio."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from models.common import new_id, now_utc


class Usuario(BaseModel):
    """Documento interno — `senha_hash` nunca sai em resposta (use UsuarioPublico)."""

    id: str = Field(default_factory=new_id)
    nome: str
    email: str
    senha_hash: str
    papel: Literal["sysadmin", "admin", "corretor"] = "corretor"
    pessoa_id: str | None = None  # vínculo com o cadastro de Pessoa (corretor)
    ativo: bool = True
    telefone: str | None = None
    cargo: str | None = None
    creci: str | None = None
    cor: str | None = None  # cor do consultor na agenda da equipe
    gerencia_site: bool = False  # liberado pelo gestor para editar o site da imobiliária
    created_at: datetime = Field(default_factory=now_utc)


class UsuarioPublico(BaseModel):
    id: str
    nome: str
    email: str
    papel: Literal["sysadmin", "admin", "corretor"]
    pessoa_id: str | None = None
    ativo: bool
    telefone: str | None = None
    cargo: str | None = None
    creci: str | None = None
    cor: str | None = None
    gerencia_site: bool = False
    tem_foto: bool = False
    foto_v: int = 0
    created_at: datetime


class UsuarioCreate(BaseModel):
    nome: str = Field(min_length=2)
    email: EmailStr
    senha: str = Field(min_length=6)
    papel: Literal["sysadmin", "admin", "corretor"] = "corretor"
    telefone: str | None = Field(default=None, max_length=40)
    cargo: str | None = Field(default=None, max_length=80)
    creci: str | None = Field(default=None, max_length=40)
    cor: str | None = Field(default=None, max_length=20)
    gerencia_site: bool = False


class UsuarioUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2)
    papel: Literal["sysadmin", "admin", "corretor"] | None = None
    ativo: bool | None = None
    senha: str | None = Field(default=None, min_length=6)
    telefone: str | None = Field(default=None, max_length=40)
    cargo: str | None = Field(default=None, max_length=80)
    creci: str | None = Field(default=None, max_length=40)
    cor: str | None = Field(default=None, max_length=20)
    gerencia_site: bool | None = None


class FotoInput(BaseModel):
    """Foto do usuário em base64 (o navegador recorta e comprime antes de enviar)."""

    base64: str = Field(min_length=16, max_length=1_200_000)
    mime: str = "image/jpeg"


class PerfilUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2)
    telefone: str | None = Field(default=None, max_length=40)
    cargo: str | None = Field(default=None, max_length=80)
    creci: str | None = Field(default=None, max_length=40)


class LoginInput(BaseModel):
    email: EmailStr
    senha: str


class MinhasComissoes(BaseModel):
    """Resumo financeiro do corretor — apenas as comissões dos seus próprios negócios."""

    comissoes_recebidas: float
    comissoes_a_receber: float
    total_leads: int
    leads_ganhos: int
