"""Acesso ao Mongo com **um banco por empresa** (database-per-tenant).

Como funciona:
- `controle` é o banco de controle (registro de empresas, contas de Administrador de Sistema e o
  índice e-mail → empresa). Nome vem de `DB_NAME`.
- Cada empresa tem o seu próprio banco (`<DB_NAME>_t_<slug>`): pessoas, imóveis, leads, contratos,
  financeiro, visitas, usuários e configuração ficam isolados fisicamente.
- `db` é um **proxy** resolvido por request: `principal_atual()` fixa a empresa do token num
  ContextVar e todo `db.colecao` passa a apontar para o banco daquela empresa. Sem empresa no
  token (Administrador de Sistema global), `db` aponta para o banco de controle.

Consequência prática: os routers continuam escrevendo `db.imoveis...` — nenhuma query pode
"escapar" para outra empresa porque o banco é escolhido fora do alcance do request.
"""

import logging
import os
from contextvars import ContextVar
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

# Banco: Firestore (Firebase) quando há FIREBASE_SERVICE_ACCOUNT ou emulador; senão MongoDB.
USA_FIRESTORE = bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT") or os.environ.get("FIRESTORE_EMULATOR_HOST")
                     or (os.environ.get("MONGO_URL") or "").startswith("firestore"))
if USA_FIRESTORE:
    from lib.firestore_mongo import cliente_do_ambiente

    client = cliente_do_ambiente()
else:
    # MONGO_URL (manual) ou MONGODB_URI (criada pela integração MongoDB Atlas do Vercel).
    mongo_url = os.environ.get("MONGO_URL") or os.environ.get("MONGODB_URI") or os.environ.get("MONGODB_URL")
    if not mongo_url:
        raise RuntimeError("Configure FIREBASE_SERVICE_ACCOUNT (Firebase) ou MONGO_URL (MongoDB)")
    if mongo_url.startswith("mongomock://"):  # somente testes locais sem servidor Mongo
        from mongomock_motor import AsyncMongoMockClient

        client = AsyncMongoMockClient()
    else:
        # No Vercel a função precisa responder rápido: falha de conexão aparece em segundos, não em 30 s.
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=8000 if os.environ.get("VERCEL") else 30000)

DB_CONTROLE = os.environ.get("DB_NAME") or "sax_crm"
AMBIENTE = os.environ.get("APP_ENV", "desenvolvimento").lower()

controle: AsyncIOMotorDatabase = client[DB_CONTROLE]

logger = logging.getLogger(__name__)

_empresa_db: ContextVar[str | None] = ContextVar("empresa_db", default=None)


def nome_banco_empresa(slug: str) -> str:
    return f"{DB_CONTROLE}_t_{slug}"


def definir_empresa(nome_db: str | None) -> None:
    """Fixa (ou limpa) o banco da empresa para o request atual."""
    _empresa_db.set(nome_db)


def empresa_atual_db() -> str | None:
    return _empresa_db.get()


def banco_atual() -> AsyncIOMotorDatabase:
    nome = _empresa_db.get()
    return client[nome] if nome else controle


class _BancoProxy:
    """Encaminha `db.colecao` / `db["colecao"]` para o banco da empresa do request."""

    def __getattr__(self, nome: str):
        return getattr(banco_atual(), nome)

    def __getitem__(self, nome: str):
        return banco_atual()[nome]


db = _BancoProxy()

# Um item por coleção: todo campo filtrado, ordenado ou deduplicado nas rotas.
INDEXES: dict[str, list[IndexModel]] = {
    "audit_events": [IndexModel([("at", DESCENDING)])],
    "mail_jobs": [IndexModel([("status", ASCENDING), ("retry_at", ASCENDING)])],
    "site_events": [IndexModel([("created_at", ASCENDING)])],
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "pessoas": [
        IndexModel([("nome", ASCENDING)], name="nome_asc"),
        IndexModel([("papeis", ASCENDING)], name="papeis"),
    ],
    "imoveis": [
        IndexModel([("codigo", ASCENDING)], name="codigo", unique=True, sparse=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("proprietario_id", ASCENDING)], name="proprietario"),
    ],
    "leads": [
        IndexModel([("estagio", ASCENDING), ("created_at", DESCENDING)], name="estagio_created"),
        IndexModel([("imovel_id", ASCENDING)], name="imovel"),
        IndexModel([("corretor_id", ASCENDING), ("created_at", DESCENDING)], name="corretor_created"),
    ],
    "plano_contas": [
        IndexModel([("codigo", ASCENDING)], name="codigo"),
        IndexModel([("conta_pai_id", ASCENDING)], name="conta_pai"),
    ],
    "transacoes": [
        IndexModel([("vencimento", DESCENDING)], name="vencimento_desc"),
        IndexModel([("imovel_id", ASCENDING)], name="imovel"),
        IndexModel([("status", ASCENDING)], name="status"),
        IndexModel([("corretor_id", ASCENDING), ("vencimento", DESCENDING)], name="corretor_venc"),
        IndexModel([("contrato_id", ASCENDING)], name="contrato"),
    ],
    "contratos": [
        IndexModel([("lead_id", ASCENDING)], name="active_lead_unique", unique=True,
                   partialFilterExpression={"lead_id": {"$type": "string"}, "status": "ativo"}),
        IndexModel([("numero", ASCENDING)], name="numero", unique=True, sparse=True),
        IndexModel([("imovel_id", ASCENDING)], name="imovel"),
        IndexModel([("corretor_id", ASCENDING)], name="corretor"),
    ],
    "visitas": [
        IndexModel([("data", ASCENDING), ("hora", ASCENDING)], name="data_hora"),
        IndexModel([("corretor_id", ASCENDING)], name="corretor"),
    ],
    "usuarios": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING)], name="email", unique=True),
        IndexModel([("pessoa_id", ASCENDING)], name="pessoa"),
    ],
    # --- CRM estilo Pipedrive ---
    "funis": [IndexModel([("ordem", ASCENDING)], name="ordem")],
    "entradas": [
        IndexModel([("portal_lead_id", ASCENDING)], name="portal_lead", unique=True, partialFilterExpression={"portal_lead_id": {"$type": "string"}}),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("corretor_id", ASCENDING)], name="corretor"),
    ],
    "atividades": [
        IndexModel([("data", ASCENDING), ("hora", ASCENDING)], name="data_hora"),
        IndexModel([("corretor_id", ASCENDING), ("data", ASCENDING)], name="corretor_data"),
        IndexModel([("negocio_id", ASCENDING)], name="negocio"),
    ],
    "historico": [IndexModel([("negocio_id", ASCENDING), ("em", DESCENDING)], name="negocio_em")],
    "modelos_contrato": [IndexModel([("nome", ASCENDING)], name="nome")],
    "google_contas": [IndexModel([("usuario_id", ASCENDING)], name="usuario", unique=True)],
    "documentos": [
        IndexModel([("negocio_id", ASCENDING), ("created_at", DESCENDING)], name="negocio"),
        IndexModel([("contrato_id", ASCENDING)], name="contrato"),
    ],
    "chat_conversas": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("membros", ASCENDING)], name="membros")],
    "chat_mensagens": [IndexModel([("conversa_id", ASCENDING), ("em", DESCENDING)], name="conversa_em")],
    "chat_leituras": [IndexModel([("conversa_id", ASCENDING), ("usuario_id", ASCENDING)], name="leitura", unique=True)],
    # --- diferenciais (match, propostas, portais, fotos) ---
    "fotos_imovel": [IndexModel([("imovel_id", ASCENDING), ("ordem", ASCENDING)], name="imovel_ordem"),
                     IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "vitrines": [IndexModel([("negocio_id", ASCENDING), ("criado_em", DESCENDING)], name="negocio"),
                 IndexModel([("imovel_ids", ASCENDING)], name="imoveis")],
    "propostas": [IndexModel([("negocio_id", ASCENDING), ("created_at", DESCENDING)], name="negocio"),
                  IndexModel([("imovel_id", ASCENDING)], name="imovel"),
                  IndexModel([("numero", ASCENDING)], name="numero", unique=True, sparse=True)],
}

# Coleções exclusivas do banco de controle.
INDEXES_CONTROLE: dict[str, list[IndexModel]] = {
    "rate_limits": [IndexModel([("expires", ASCENDING)], expireAfterSeconds=0)],
    "empresas": [
        IndexModel([("slug", ASCENDING)], name="slug", unique=True),
        IndexModel([("site_api_key", ASCENDING)], name="api_key", sparse=True),
    ],
    "usuarios_index": [IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "assinaturas_index": [IndexModel([("contrato_id", ASCENDING)], name="contrato")],
    "links_publicos": [IndexModel([("tipo", ASCENDING), ("ref", ASCENDING), ("db_name", ASCENDING)], name="tipo_ref")],
    "usuarios": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING)], name="email", unique=True),
    ],
}


async def _aplicar(banco: AsyncIOMotorDatabase, mapa: dict[str, list[IndexModel]]) -> None:
    for collection, models in mapa.items():
        for model in models:  # um a um: um spec ruim pula apenas a si mesmo
            try:
                await banco[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s.%s): %s", banco.name, collection, model.document["name"], exc)


async def ensure_indexes() -> None:
    """Índices do banco de controle + do banco de cada empresa ativa."""
    await _aplicar(controle, INDEXES_CONTROLE)
    await _aplicar(controle, INDEXES)
    async for empresa in controle.empresas.find({"ativo": True}, {"db_name": 1}):
        if empresa.get("db_name"):
            await _aplicar(client[empresa["db_name"]], INDEXES)


async def ensure_indexes_empresa(nome_db: str) -> None:
    await _aplicar(client[nome_db], INDEXES)
