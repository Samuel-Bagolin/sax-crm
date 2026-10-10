"""Session, database-per-company isolation, module entitlements and resource ownership."""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import Depends, HTTPException, Request, Response
from passlib.context import CryptContext
from pydantic import BaseModel

from lib.db import AMBIENTE, controle, db, definir_empresa

logger = logging.getLogger(__name__)

COOKIE_NAME = "imobierp_session"
ALGORITHM = "HS256"
SESSION_DIAS = 7

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _segredo() -> str:
    segredo = os.environ.get("JWT_SECRET")
    if not segredo:
        raise RuntimeError("JWT_SECRET ausente em backend/.env")
    return segredo


def hash_senha(senha: str) -> str:
    return _pwd.hash(senha)


def conferir_senha(senha: str, hash_armazenado: str) -> bool:
    try:
        return _pwd.verify(senha, hash_armazenado)
    except Exception:  # hash corrompido nunca deve autenticar
        return False


def criar_token(usuario_id: str, empresa_id: str | None = None, session_version: int = 0) -> str:
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": usuario_id,
        "emp": empresa_id,
        "sv": session_version,
        "iat": agora,
        "exp": agora + timedelta(days=SESSION_DIAS),
    }
    return jwt.encode(payload, _segredo(), algorithm=ALGORITHM)


def gravar_cookie(response: Response, token: str) -> None:
    # Production cookies are HTTPS-only; HTTP remains available for local tests.
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=AMBIENTE == "producao" or os.environ.get("APP_URL", "").startswith("https://"),
        max_age=SESSION_DIAS * 86400,
        path="/",
    )


def limpar_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


# --------------------------------------------------------------------------- principal


class Principal(BaseModel):
    """Identidade derivada no servidor. `pessoa_id` liga o usuário ao cadastro de Pessoa."""

    usuario_id: str
    nome: str
    email: str
    papel: Literal["sysadmin", "admin", "corretor"]
    pessoa_id: str | None = None
    # Empresa (tenant) do token: define o BANCO usado no request. None = plano de controle.
    empresa_id: str | None = None
    empresa_nome: str | None = None
    suporte: bool = False  # sysadmin operando dentro de uma empresa
    ambiente: str = AMBIENTE
    session_version: int = 0
    tem_foto: bool = False
    foto_v: int = 0
    telefone: str | None = None
    trocar_senha: bool = False  # senha inicial fraca: só pode trocar a senha até resolver
    gerencia_site: bool = False  # gestor liberou este usuário para editar o site da imobiliária
    segmento: str = "imobiliaria"  # lib/segmentos.py
    assinatura: dict | None = None  # resumo da assinatura da plataforma (cadastro público)
    bloqueio: str | None = None  # motivo do bloqueio por cobrança; None = acesso liberado

    @property
    def is_admin(self) -> bool:
        """Visão global (gestor ou administrador de sistema) — usado pelos filtros de ownership."""
        return self.papel in {"admin", "sysadmin"}

    @property
    def is_sysadmin(self) -> bool:
        return self.papel == "sysadmin"

    @property
    def pode_site(self) -> bool:
        """Cria e edita o site da imobiliária e decide o que aparece nele: gestor ou quem ele liberou."""
        return self.is_admin or self.gerencia_site


# L1 — permissões por papel. Deny-by-default: ação fora do conjunto é negada.
# CRM estilo Pipedrive: funis/etapas, caixa de entrada de leads, atividades, assinaturas.
_PERMS_CRM_GESTOR = {
    "funil:read", "funil:write", "atividade:read", "atividade:write",
    "entrada:read", "entrada:write", "entrada:delete", "assinatura:manage",
    "modelo:read", "modelo:write", "equipe:read", "portal:manage", "proprietario:link",
    # segmentos de serviço, saúde e veículos
    "unidade:read", "unidade:manage", "servico:read", "servico:write", "agendamento:read", "agendamento:write",
    "paciente:read", "paciente:write", "paciente:delete", "prontuario:read", "prontuario:write",
    "tratamento:read", "tratamento:write", "veiculo:read", "veiculo:create", "veiculo:update", "veiculo:delete",
    "assinatura_plataforma:manage",
}
_PERMS_CRM_CORRETOR = {
    "funil:read", "atividade:read", "atividade:write", "entrada:read", "entrada:write",
    "assinatura:manage", "modelo:read", "equipe:read", "proprietario:link",
    "unidade:read", "servico:read", "agendamento:read", "agendamento:write",
    "paciente:read", "paciente:write", "prontuario:read", "prontuario:write",
    "tratamento:read", "tratamento:write", "veiculo:read", "veiculo:create", "veiculo:update",
}

_PERMS_ADMIN = _PERMS_CRM_GESTOR | {
    "imovel:read", "imovel:create", "imovel:update", "imovel:delete",
    "lead:read", "lead:create", "lead:update", "lead:delete",
    "pessoa:read", "pessoa:create", "pessoa:update", "pessoa:delete",
    "plano:read", "plano:write",
    "transacao:read", "transacao:write",
    "financeiro:empresa",
    "usuario:manage",
    "contrato:read", "contrato:write", "contrato:create", "contrato:update", "contrato:delete",
    "visita:read", "visita:write",
    "relatorio:pdf",
}

PERMISSOES: dict[str, set[str]] = {
    # Administrador de Sistema: tudo do gestor + configuração do sistema e gestão de outros
    # administradores de sistema.
    "sysadmin": _PERMS_ADMIN | {"config:read", "config:write", "usuario:manage_sysadmin", "empresa:manage"},
    "admin": {
        "imovel:read", "imovel:create", "imovel:update", "imovel:delete",
        "lead:read", "lead:create", "lead:update", "lead:delete",
        "pessoa:read", "pessoa:create", "pessoa:update", "pessoa:delete",
        "plano:read", "plano:write",
        "transacao:read", "transacao:write",
        "financeiro:empresa",
        "usuario:manage",
        "contrato:read", "contrato:write", "contrato:create", "contrato:update", "contrato:delete",
        "visita:read", "visita:write",
        "relatorio:pdf",
    } | _PERMS_CRM_GESTOR,
    # Corretor: imóveis todos; leads e comissões apenas os próprios; financeiro da
    # imobiliária (fluxo de caixa, DRE, plano de contas) oculto.
    "corretor": {
        "imovel:read", "imovel:create", "imovel:update",
        "lead:read", "lead:create", "lead:update", "lead:delete",
        "pessoa:read", "pessoa:create",
        "plano:read",
        "transacao:read",
        "contrato:read",
        "contrato:create",
        "visita:read", "visita:write",
    } | _PERMS_CRM_CORRETOR,
}

FORBIDDEN = "FORBIDDEN"
NOT_VISIBLE = "NOT_VISIBLE"


def authorize(principal: Principal, action: str, resource: dict | None = None) -> None:
    """Única função de decisão. Levanta 403 (pode ver, não pode agir) ou 404 (não pode ver).

    404 em vez de 403 para recurso de outro corretor: um 403 revelaria que o registro existe.
    """
    perms = PERMISSOES.get(principal.papel)
    if not perms or action not in perms:
        raise HTTPException(status_code=403, detail="Seu perfil não permite esta ação")

    if resource is None or principal.is_admin:
        return

    # L3 — relação/dono. Admin já retornou acima; corretor só alcança o que é seu.
    if _precisa_dono(action):
        dono = resource.get("corretor_id")
        if dono is None or dono != principal.pessoa_id:
            raise HTTPException(status_code=404, detail="Registro não encontrado")


def _precisa_dono(action: str) -> bool:
    return action.split(":")[0] in {"lead", "transacao", "contrato", "visita", "atividade", "entrada"}


def filtro_do_principal(principal: Principal, recurso: str) -> dict:
    """Compila a visibilidade do principal em PREDICADO DE QUERY.

    Aplicado antes de qualquer paginação/agregação: registros de outro corretor nunca são
    carregados (em vez de buscar tudo e filtrar depois).
    """
    if principal.is_admin:
        return {}
    if recurso in {"leads", "transacoes", "contratos", "visitas", "atividades", "entradas"}:
        # Um corretor sem pessoa_id vinculada não enxerga nada (fail-closed).
        return {"corretor_id": principal.pessoa_id or "__sem_vinculo__"}
    return {}


async def _principal_do_request(request: Request) -> Principal | None:
    definir_empresa(None)
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(token, _segredo(), algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

    usuario_id = payload.get("sub")
    if not usuario_id:
        return None

    # A empresa vem do TOKEN (nunca do corpo/query) e define o banco deste request.
    empresa_id = payload.get("emp")
    empresa_nome = None
    empresa = None
    sysadmin_global = await controle.usuarios.find_one({"id": usuario_id, "papel": "sysadmin"})
    if empresa_id:
        empresa = await controle.empresas.find_one({"id": empresa_id})
        if not empresa or not empresa.get("ativo", True):
            return None
        definir_empresa(empresa["db_name"])
        empresa_nome = empresa["nome"]

    # Re-leitura da fonte da verdade: papel/vínculo/ativo mudam no meio da sessão.
    doc = await db.usuarios.find_one({"id": usuario_id}) if not sysadmin_global else sysadmin_global
    if not doc or not doc.get("ativo", True) or payload.get("sv", 0) != doc.get("session_version", 0):
        return None

    return Principal(
        usuario_id=doc["id"],
        nome=doc["nome"],
        email=doc["email"],
        papel=doc["papel"],
        pessoa_id=doc.get("pessoa_id"),
        empresa_id=empresa_id,
        empresa_nome=empresa_nome,
        suporte=bool(empresa_id and doc["papel"] == "sysadmin"),
        session_version=doc.get("session_version", 0),
        tem_foto=bool(doc.get("tem_foto")),
        foto_v=int(doc.get("foto_v", 0)),
        telefone=doc.get("telefone"),
        trocar_senha=bool(doc.get("trocar_senha")),
        gerencia_site=bool(doc.get("gerencia_site")),
        **_dados_empresa(empresa, sysadmin=bool(sysadmin_global)),
    )


def _dados_empresa(empresa: dict | None, sysadmin: bool) -> dict:
    if not empresa:
        return {}
    from lib.assinatura import bloqueio, resumo_publico
    from lib.segmentos import segmento_de

    ass = empresa.get("assinatura")
    return {"segmento": segmento_de(empresa), "assinatura": resumo_publico(ass),
            "bloqueio": None if sysadmin else bloqueio(ass)}


async def principal_atual(request: Request) -> Principal:
    """Dependência obrigatória: rota sem principal falha fechada com 401."""
    principal = await _principal_do_request(request)
    if principal is None:
        raise HTTPException(status_code=401, detail="Sessão expirada ou inexistente")
    if principal.trocar_senha and request.url.path not in _LIBERADO_SEM_TROCA:
        raise HTTPException(status_code=403, detail="Troque a senha inicial para continuar")
    if principal.bloqueio and request.url.path not in _LIBERADO_SEM_TROCA and not request.url.path.startswith(_LIBERADO_BLOQUEIO):
        raise HTTPException(status_code=402, detail=principal.bloqueio)
    return principal


_LIBERADO_SEM_TROCA = {"/api/auth/me", "/api/auth/senha", "/api/auth/logout"}
# Com a cobrança bloqueada, o gestor ainda vê a assinatura e troca o cartão.
_LIBERADO_BLOQUEIO = ("/api/assinatura", "/api/configuracoes/publica", "/api/plano")


async def principal_opcional(request: Request) -> Principal | None:
    return await _principal_do_request(request)


def require(action: str):
    """Declara a ação da rota: `dependencies=[Depends(require("imovel:delete"))]`."""

    async def _guard(principal: Principal = Depends(principal_atual)) -> Principal:
        authorize(principal, action)
        await require_module(principal, action)
        return principal

    return _guard


def pode_conceder(principal: Principal, papel_alvo: str) -> bool:
    """Ninguém concede papel acima do próprio.

    - sysadmin: concede qualquer papel (inclusive outro sysadmin).
    - admin (gestor): concede apenas admin e corretor — nunca sysadmin.
    """
    if principal.is_sysadmin:
        return papel_alvo in {"sysadmin", "admin", "corretor"}
    return principal.papel == "admin" and papel_alvo in {"admin", "corretor"}


MODULE_ACTION = {"imovel": "imoveis", "lead": "crm", "plano": "financeiro", "transacao": "financeiro", "financeiro": "financeiro", "contrato": "contratos", "visita": "agenda", "usuario": "usuarios", "relatorio": "financeiro", "funil": "crm", "atividade": "crm", "entrada": "crm", "assinatura": "contratos", "modelo": "contratos", "portal": "imoveis", "proprietario": "imoveis",
                 "veiculo": "veiculos", "servico": "atendimentos", "agendamento": "atendimentos",
                 "paciente": "pacientes", "prontuario": "pacientes", "tratamento": "pacientes"}

async def require_module(principal: Principal, action: str):
    module = MODULE_ACTION.get(action.split(":")[0])
    if not module: return
    if not principal.empresa_id:
        if action.startswith("usuario:"): return
        raise HTTPException(403, "Entre em uma empresa antes de acessar dados operacionais")
    config = await db.configuracoes.find_one({"id": "singleton"})
    empresa = await controle.empresas.find_one({"id": principal.empresa_id})
    active = (config or {}).get("modulos_ativos", [])
    entitled = (empresa or {}).get("modulos", [])
    if module not in active or (entitled and module not in entitled):
        raise HTTPException(403, "Módulo não habilitado para esta empresa")
