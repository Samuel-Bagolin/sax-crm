"""Configuração do sistema — documento único (`configuracoes`, id fixo "singleton").

Só o Administrador de Sistema lê/escreve o documento completo; a parte de identidade visual é
exposta publicamente (`ConfiguracaoPublica`) porque a tela de login precisa dela antes da sessão.
Segredos (token do WhatsApp, chave de API do site) NUNCA entram na versão pública.
"""

from datetime import datetime
from typing import List

from pydantic import BaseModel, Field

from models.common import new_id, now_utc

CONFIG_ID = "singleton"

# Módulos que podem ser ligados/desligados pelo Administrador de Sistema.
MODULOS = ["dashboard", "imoveis", "crm", "agenda", "contratos", "financeiro", "usuarios"]

TITULOS_PADRAO: dict[str, str] = {
    "dashboard": "Visão Geral",
    "imoveis": "Imóveis",
    "crm": "CRM & Funil",
    "agenda": "Agenda",
    "contratos": "Contratos",
    "financeiro": "Financeiro",
    "usuarios": "Consultores",
}


class Configuracao(BaseModel):
    id: str = CONFIG_ID
    nome_software: str = "SAX"
    slogan: str = "Gestão Imobiliária Ágil"
    modulos_ativos: List[str] = Field(default_factory=lambda: list(MODULOS))
    titulos_modulos: dict[str, str] = Field(default_factory=lambda: dict(TITULOS_PADRAO))
    # Identidade visual (valores CSS: hex ou oklch)
    cor_painel: str = "#ffffff"
    cor_fonte: str = "#1c1c1c"
    cor_primaria: str = "#4a03a2"
    imagem_fundo_login: str | None = None
    # E-mail (envio gerenciado pela Emergent — aqui só remetente visível e resposta)
    email_remetente_nome: str = "ImobiERP Lite"
    email_resposta: str | None = None
    # WhatsApp — guardado para a integração futura (nada é enviado nesta etapa)
    whatsapp_numero: str | None = None
    whatsapp_phone_id: str | None = None
    whatsapp_token: str | None = None
    # Integração com site
    site_url: str | None = None
    site_api_key: str | None = None
    site_webhook_ativo: bool = True
    # Logotipo próprio (bytes em base64 — servido por GET /api/configuracoes/logo)
    logo_base64: str | None = None
    logo_mime: str | None = None
    atualizado_em: datetime = Field(default_factory=now_utc)
    atualizado_por: str | None = None


class ConfiguracaoUpdate(BaseModel):
    nome_software: str | None = Field(default=None, min_length=2)
    slogan: str | None = None
    modulos_ativos: List[str] | None = None
    titulos_modulos: dict[str, str] | None = None
    cor_painel: str | None = None
    cor_fonte: str | None = None
    cor_primaria: str | None = None
    imagem_fundo_login: str | None = None
    email_remetente_nome: str | None = None
    email_resposta: str | None = None
    whatsapp_numero: str | None = None
    whatsapp_phone_id: str | None = None
    whatsapp_token: str | None = None
    site_url: str | None = None
    site_webhook_ativo: bool | None = None


class ConfiguracaoPublica(BaseModel):
    """Identidade visual + módulos ativos. Sem segredos — serve a tela de login."""

    nome_software: str
    slogan: str
    modulos_ativos: List[str]
    titulos_modulos: dict[str, str]
    cor_painel: str
    cor_fonte: str
    cor_primaria: str
    imagem_fundo_login: str | None = None
    tem_logo: bool = False


class LogoInput(BaseModel):
    """Upload do logotipo: conteúdo em base64 (o frontend lê o arquivo com FileReader)."""

    base64: str = Field(min_length=16)
    mime: str = "image/png"


class ConfigLog(BaseModel):
    """Trilha de alterações do configurador — quem mudou o quê e quando."""

    id: str = Field(default_factory=new_id)
    campo: str
    de: str | None = None
    para: str | None = None
    usuario: str
    em: datetime = Field(default_factory=now_utc)


class LeadDoSite(BaseModel):
    """Payload aceito no webhook do site (autenticado pela chave de API)."""

    nome: str = Field(min_length=2)
    email: str | None = None
    telefone: str | None = None
    mensagem: str | None = None
    codigo_imovel: str | None = None
    origem: str = "Site"
