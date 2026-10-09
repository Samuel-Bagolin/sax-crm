"""Cadastro único universal de pessoas — o papel (cliente, corretor, proprietário) é contextual."""

from datetime import datetime
from typing import List

from pydantic import BaseModel, Field

from models.common import new_id, now_utc


class Pessoa(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=1, max_length=1000)
    papeis: List[str] = Field(default_factory=list)  # cliente | corretor | proprietario
    cpf_cnpj: str | None = None
    telefone: str | None = None
    email: str | None = None
    created_at: datetime = Field(default_factory=now_utc)


class PessoaCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=1000)
    papeis: List[str] = Field(default_factory=list)
    cpf_cnpj: str | None = None
    telefone: str | None = None
    email: str | None = None
