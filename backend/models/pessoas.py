"""Cadastro único universal de pessoas — o papel (cliente, corretor, proprietário) é contextual.

Pessoa física (CPF) ou jurídica (CNPJ). Os campos além de nome/contato são opcionais: o mesmo
cadastro serve ao lead que acabou de chegar e ao proprietário com contrato de administração.
"""

import re
from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field, field_validator

from models.common import new_id, now_utc

TipoPessoa = Literal["pf", "pj"]


def so_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", valor or "")


def cpf_valido(cpf: str) -> bool:
    d = so_digitos(cpf)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if (soma * 10 % 11) % 10 != int(d[n]):
            return False
    return True


def cnpj_valido(cnpj: str) -> bool:
    d = so_digitos(cnpj)
    if len(d) != 14 or d == d[0] * 14:
        return False
    for n in (12, 13):
        pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if n == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        resto = sum(int(d[i]) * pesos[i] for i in range(n)) % 11
        if (0 if resto < 2 else 11 - resto) != int(d[n]):
            return False
    return True


def formatar_documento(valor: str | None) -> str | None:
    d = so_digitos(valor)
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return valor or None


class _DadosPessoa(BaseModel):
    """Campos editáveis — compartilhados pelo cadastro e pela edição."""

    nome: str = Field(min_length=1, max_length=1000)  # PF: nome completo · PJ: razão social
    papeis: List[str] = Field(default_factory=list)  # cliente | corretor | proprietario
    tipo_pessoa: TipoPessoa = "pf"
    cpf_cnpj: str | None = Field(default=None, max_length=30)
    telefone: str | None = Field(default=None, max_length=40)
    telefone2: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    # Pessoa física
    rg: str | None = Field(default=None, max_length=40)
    data_nascimento: str | None = Field(default=None, max_length=10)
    estado_civil: str | None = Field(default=None, max_length=40)
    profissao: str | None = Field(default=None, max_length=120)
    nacionalidade: str | None = Field(default=None, max_length=80)
    # Pessoa jurídica
    nome_fantasia: str | None = Field(default=None, max_length=300)
    inscricao_estadual: str | None = Field(default=None, max_length=40)
    responsavel_nome: str | None = Field(default=None, max_length=300)
    responsavel_cpf: str | None = Field(default=None, max_length=20)
    # Endereço
    cep: str | None = Field(default=None, max_length=12)
    logradouro: str | None = Field(default=None, max_length=300)
    numero: str | None = Field(default=None, max_length=20)
    complemento: str | None = Field(default=None, max_length=120)
    bairro: str | None = Field(default=None, max_length=120)
    cidade: str | None = Field(default=None, max_length=120)
    estado: str | None = Field(default=None, max_length=2)
    # Dados para repasse
    banco: str | None = Field(default=None, max_length=120)
    agencia: str | None = Field(default=None, max_length=20)
    conta: str | None = Field(default=None, max_length=30)
    tipo_conta: Literal["corrente", "poupanca"] | None = None
    pix: str | None = Field(default=None, max_length=140)
    observacoes: str | None = Field(default=None, max_length=4000)

    @field_validator("data_nascimento")
    @classmethod
    def _data(cls, v: str | None) -> str | None:
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("Data de nascimento no formato AAAA-MM-DD")
        return v or None


class Pessoa(_DadosPessoa):
    id: str = Field(default_factory=new_id)
    created_at: datetime = Field(default_factory=now_utc)


class PessoaCreate(_DadosPessoa):
    pass


CAMPOS_PESSOA = list(_DadosPessoa.model_fields)
