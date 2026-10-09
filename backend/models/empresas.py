"""Registro de empresas (tenants) — vive no banco de CONTROLE, nunca no banco de uma empresa."""

import re
from datetime import datetime
from typing import List

from pydantic import BaseModel, Field, EmailStr

from models.common import new_id, now_utc


def slugificar(texto: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "", texto.lower().replace(" ", ""))
    return base[:24] or "empresa"


class Empresa(BaseModel):
    id: str = Field(default_factory=new_id)
    nome: str = Field(min_length=2)
    slug: str  # identificador técnico; compõe o nome do banco
    db_name: str
    cnpj: str | None = None
    plano: str = "essencial"
    plano_aplicado: bool = False  # False = empresa anterior aos planos (sem limites)
    limites_personalizados: dict | None = None  # {"usuarios": int|None, "imoveis": int|None, "recursos_extras": [...]}
    ativo: bool = True
    modulos: List[str] = Field(default_factory=list)  # vazio = herda a configuração da empresa
    site_api_key: str | None = None  # espelhado da config da empresa para o webhook do site
    observacoes: str | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class EmpresaCreate(BaseModel):
    nome: str = Field(min_length=2)
    slug: str | None = None
    cnpj: str | None = None
    plano: str = "essencial"
    # Primeiro gestor da empresa (criado no banco dela)
    admin_nome: str = Field(min_length=2)
    admin_email: EmailStr
    # Em branco: o servidor gera uma senha provisória e envia o convite por e-mail.
    admin_senha: str | None = None
    enviar_convite: bool = True
    dados_demonstracao: bool = False  # só permitido fora de produção


class LimitesPersonalizados(BaseModel):
    usuarios: int | None = Field(default=None, ge=1, le=10000)
    imoveis: int | None = Field(default=None, ge=1, le=1000000)
    recursos_extras: List[str] = Field(default_factory=list)


class EmpresaUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2)
    cnpj: str | None = None
    plano: str | None = None
    limites_personalizados: LimitesPersonalizados | None = None
    remover_limites_personalizados: bool | None = None
    ativo: bool | None = None
    observacoes: str | None = None
    modulos: List[str] | None = None


class EmpresaResumo(Empresa):
    """Empresa + contadores lidos do banco dela (painel do Administrador de Sistema)."""

    plano_nome: str | None = None
    plano_preco: float | None = None
    limite_usuarios: int | None = None
    limite_imoveis: int | None = None
    usuarios_ativos: int = 0
    imoveis_carteira: int = 0
    usuarios: int = 0
    imoveis: int = 0
    leads: int = 0
    contratos: int = 0
    convite_enviado: bool = False
    link_ativacao: str | None = None  # só na resposta da criação, para o Administrador de Sistema


class UsoEmpresa(BaseModel):
    """Painel de uso por empresa — base para acompanhar plano e cobrança."""

    empresa_id: str
    nome: str
    slug: str
    plano: str
    ativo: bool
    criada_em: datetime
    ultimo_acesso: datetime | None = None
    usuarios: int = 0
    usuarios_ativos: int = 0
    corretores: int = 0
    imoveis: int = 0
    imoveis_publicados: int = 0
    leads: int = 0
    leads_30d: int = 0
    contratos: int = 0
    contratos_ativos: int = 0
    visitas: int = 0
    transacoes: int = 0
    receita_contratada: float = 0  # soma das parcelas a receber geradas por contrato
    armazenamento_mb: float = 0


class RestauracaoEmpresa(BaseModel):
    """Conteúdo de um backup gerado por `GET /api/empresas/{id}/backup`."""

    formato: str
    conteudo: str = Field(max_length=100_000_000)


class Ambiente(BaseModel):
    """Identificação do ambiente — exibida na faixa de aviso fora de produção."""

    ambiente: str  # desenvolvimento | homologacao | producao
    producao: bool
    rotulo: str
    empresas_ativas: int = 0
