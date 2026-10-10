import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes, controle
from lib.security import SecurityMiddleware
from lib.email import mail_worker

# Módulos do monolito modular — um router por domínio, todos registrados sob /api
from routers import site_imobiliaria, proprietarios, rotina, fotos_imovel, match, planos, portais, propostas, proprietario
from routers import agenda, assinaturas, relatorios, google, documentos, chat, auth, config, contratos, crm, empresas, financeiro, imoveis, leads, pessoas, usuarios, operacao
from lib.crm import garantir_crm_todas


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
SERVERLESS = bool(os.environ.get("VERCEL"))
_inicializado = False
_trava_inicio = asyncio.Lock()


async def inicializar() -> None:
    """Índices e dados padrão do CRM. Idempotente; roda uma vez por instância."""
    global _inicializado
    if _inicializado:
        return
    async with _trava_inicio:
        if not _inicializado:
            from lib.autoconfig import carregar_segredos, trancar_regras
            await carregar_segredos(controle)
            await trancar_regras(client)
            await ensure_indexes()
            await garantir_crm_todas()
            await _primeiro_administrador()
            await _migrar_marca()
            from lib.planos import carregar_catalogo
            await carregar_catalogo(forcar=True)
            _inicializado = True


async def _migrar_marca() -> None:
    """Configurações gravadas com o nome antigo (CedroNexxo Gestão) passam a ser SAX. Roda uma vez."""
    marca = await controle["_sistema"].find_one({"_id": "marca_sax"})
    if marca and marca.get("versao") == 2:
        return
    nome_antigo = {"nome_software": {"$in": ["CedroNexxo Gestão", "CedroNexxo"]}}
    slogan_antigo = {"slogan": "Gestão Imobiliária Ágil"}
    bancos = [controle] + [client[e["db_name"]] async for e in controle.empresas.find({}, {"db_name": 1})]
    for banco in bancos:
        await banco.configuracoes.update_many(nome_antigo, {"$set": {"nome_software": "SAX"}})
        await banco.configuracoes.update_many(slogan_antigo, {"$set": {"slogan": ""}})
    await controle["_sistema"].update_one({"_id": "marca_sax"}, {"$set": {"versao": 2}}, upsert=True)


async def _primeiro_administrador() -> None:
    """Banco novo (ex.: MongoDB Atlas vazio): cria o Administrador de Sistema a partir de
    ADMIN_INICIAL_EMAIL/ADMIN_INICIAL_SENHA. Só age se ainda não existir nenhum."""
    email = (os.environ.get("ADMIN_INICIAL_EMAIL") or "").strip().lower()
    senha = os.environ.get("ADMIN_INICIAL_SENHA") or ""
    if not email or len(senha) < 10:
        return
    if await controle.usuarios.find_one({"papel": "sysadmin"}, {"_id": 1}):
        return
    from lib.auth import hash_senha
    from models.usuarios import Usuario
    nome = os.environ.get("ADMIN_INICIAL_NOME") or "Administrador"
    await controle.usuarios.insert_one(Usuario(nome=nome, email=email, senha_hash=hash_senha(senha), papel="sysadmin").model_dump())
    logging.getLogger(__name__).warning("Administrador de Sistema inicial criado: %s (remova ADMIN_INICIAL_SENHA das variáveis)", email)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if SERVERLESS:
        # Vercel: sem tarefas contínuas; a inicialização acontece na primeira requisição
        # e o trabalho periódico vem do Vercel Cron (/api/cron/rotina).
        yield
        return
    await inicializar()
    worker = asyncio.create_task(mail_worker())
    from lib.automacoes import worker as automacoes_worker
    rotina = asyncio.create_task(automacoes_worker())
    try:
        yield
    finally:
        worker.cancel()
        rotina.cancel()
        import contextlib
        with contextlib.suppress(asyncio.CancelledError): await worker
        with contextlib.suppress(asyncio.CancelledError): await rotina
        client.close()


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.get("/status")
async def health():
    """Diagnóstico: abre no navegador para ver se o banco responde."""
    from lib.db import USA_FIRESTORE
    from starlette.responses import JSONResponse
    banco = "firestore" if USA_FIRESTORE else "mongodb"
    try:
        await controle.command("ping")
    except Exception as exc:
        return JSONResponse({"status": "erro", "banco": banco, "erro": type(exc).__name__, "detalhe": str(exc)[:300]}, status_code=503)
    from lib.autoconfig import ESTADO, local_do_banco
    erro_inicio = None
    if not _inicializado:
        try:
            await inicializar()
        except Exception as exc:
            erro_inicio = f"{type(exc).__name__}: {str(exc)[:300]}"
    saida = {"status": "ok" if not erro_inicio else "erro", "banco": banco, "inicializado": _inicializado}
    if erro_inicio:
        saida["erro_inicializacao"] = erro_inicio
    if USA_FIRESTORE:
        saida.update({"regras_firebase": ESTADO["regras"], "segredos": ESTADO["segredos"],
                      "local_do_banco": await local_do_banco(client), "regiao_vercel": os.environ.get("VERCEL_REGION")})
    saida["app_url"] = os.environ.get("APP_URL") or None
    return saida

# Domínios do sistema de gestão imobiliária
api_router.include_router(auth.router)
api_router.include_router(usuarios.router)
api_router.include_router(pessoas.router)
api_router.include_router(imoveis.router)
api_router.include_router(proprietarios.router)
api_router.include_router(leads.router)
api_router.include_router(financeiro.router)
api_router.include_router(agenda.router)
api_router.include_router(contratos.router)
api_router.include_router(config.router)
api_router.include_router(config.site_router)
api_router.include_router(empresas.router)
api_router.include_router(agenda.cron_router)
api_router.include_router(operacao.router)
api_router.include_router(crm.router)
api_router.include_router(relatorios.router)
api_router.include_router(google.router)
api_router.include_router(documentos.router)
api_router.include_router(chat.router)
api_router.include_router(assinaturas.router)
api_router.include_router(assinaturas.publico_router)
api_router.include_router(usuarios.perfil_router)
api_router.include_router(fotos_imovel.router)
api_router.include_router(fotos_imovel.publico_router)
api_router.include_router(match.router)
api_router.include_router(match.publico_router)
api_router.include_router(propostas.router)
api_router.include_router(portais.router)
api_router.include_router(portais.publico_router)
api_router.include_router(proprietario.router)
api_router.include_router(proprietario.publico_router)
api_router.include_router(planos.router)
api_router.include_router(rotina.router)
api_router.include_router(site_imobiliaria.router)
api_router.include_router(site_imobiliaria.publico_router)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(SecurityMiddleware)


_ultima_falha_inicio = 0.0


@app.middleware("http")
async def _inicializar_na_primeira_requisicao(request, call_next):
    global _ultima_falha_inicio
    import time
    from lib.firestore_mongo import cache_requisicao
    cache_requisicao.set({})  # leituras repetidas na mesma requisição não vão de novo ao Firestore
    if SERVERLESS and not _inicializado and request.url.path != "/api/status":
        try:
            if _ultima_falha_inicio and time.monotonic() - _ultima_falha_inicio < 30:
                raise RuntimeError("inicialização falhou há pouco; nova tentativa em instantes")
            await inicializar()
        except Exception as exc:
            _ultima_falha_inicio = time.monotonic()
            logging.getLogger(__name__).error("Inicialização falhou (banco inacessível?): %s: %s", type(exc).__name__, str(exc)[:300])
            from starlette.responses import JSONResponse
            return JSONResponse({"detail": "Banco de dados indisponível. Abra /api/status para ver o motivo.",
                                 "erro": type(exc).__name__}, status_code=503)
    return await call_next(request)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '').split(',') if o.strip() and o.strip() != '*'],
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-API-Key", "Idempotency-Key"],
    expose_headers=["X-Next-Offset"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
