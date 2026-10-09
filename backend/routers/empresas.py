"""Empresas (tenants) — plano de controle, exclusivo do Administrador de Sistema.

Cada empresa tem **banco próprio**: criar uma empresa provisiona um banco novo; entrar numa
empresa troca o token para carregar o `empresa_id`, e a partir daí todas as queries do request
apontam para o banco daquela empresa (ver `lib/db.py`).
"""

import json
import logging
import os
import secrets
import string
from datetime import timedelta
from html import escape
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from lib.auth import Principal, criar_token, gravar_cookie, hash_senha, require
from lib.db import AMBIENTE, client, controle, nome_banco_empresa
from lib.email import TERMOS_BLOQUEADOS, send_email
from lib.invites import invite
from lib.integrity import audit
from lib.tenant import contadores, desindexar_usuario, indexar_usuario, provisionar_empresa
from models.common import new_id, now_utc, utc_aware
from models.empresas import (
    Ambiente,
    ComercialEmpresa,
    Empresa,
    EmpresaCreate,
    EmpresaResumo,
    EmpresaUpdate,
    RestauracaoEmpresa,
    UsoEmpresa,
    slugificar,
)
from models.usuarios import Usuario

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/empresas", tags=["empresas"])

COLECOES_BACKUP = [
    "pessoas",
    "imoveis",
    "leads",
    "plano_contas",
    "transacoes",
    "contratos",
    "visitas",
    "configuracoes",
    "config_logs",
    "usuarios", "counters", "site_events", "audit_events",
]
# Coleções do CRM estilo Pipedrive: opcionais na restauração (backups antigos não as têm).
COLECOES_CRM = ["funis", "entradas", "atividades", "historico", "modelos_contrato", "fotos_usuario",
                "documentos", "chat_conversas", "chat_mensagens", "chat_leituras", "fotos_imovel", "vitrines", "propostas"]  # google_contas fica fora: tokens são do ambiente
COLECOES_OBRIGATORIAS = list(COLECOES_BACKUP)
COLECOES_BACKUP = COLECOES_BACKUP + COLECOES_CRM


def senha_provisoria(tamanho: int = 10) -> str:
    """Senha aleatória que não contenha termo bloqueado pelo gate de e-mail (ex.: 'cvv')."""
    alfabeto = string.ascii_letters + string.digits
    for _ in range(50):
        senha = "".join(secrets.choice(alfabeto) for _ in range(tamanho))
        baixa = senha.lower()
        if not any(t in baixa for t in TERMOS_BLOQUEADOS):
            return senha
    return secrets.token_hex(5)  # só dígitos/a-f: nunca casa com os termos


def _app_url() -> str:
    url = os.environ.get("APP_URL", "").rstrip("/")
    return url if url.startswith("https://") else "https://imob-erp-lite.preview.emergentagent.com"


async def enviar_convite_gestor(*, empresa_nome: str, nome: str, email: str, senha: str) -> str | None:
    """Devolve o link de ativação (ou None se não deu para gerar)."""
    index = await controle.usuarios_index.find_one({"email": email})
    if not index: return None
    bank = client[index["db_name"]]
    user = await bank.usuarios.find_one({"email": email})
    try:
        from lib.db import definir_empresa
        definir_empresa(bank.name)
        return await invite(bank, user, empresa_nome)
    except Exception:
        logger.error("Convite não enfileirado; gestor pode solicitar recuperação")
        return None


CAMPOS_DATA = {
    "created_at",
    "updated_at",
    "atualizado_em",
    "lembrete_enviado_em",
    "lembrete_cliente_em",
    "em",
    "ultimo_acesso", "closed_at", "activation_expires", "cancelado_em", "at", "retry_at", "lease_until",
}


def _normalizar(registro: dict) -> dict:
    """No JSON do backup as datas são strings ISO; volta a gravar datetime no Mongo."""
    limpo = {}
    for chave, valor in registro.items():
        if chave == "_id":
            continue
        if chave in CAMPOS_DATA and isinstance(valor, str):
            valor = utc_aware(valor) or valor
        if isinstance(valor, dict): valor = _normalizar(valor)
        elif isinstance(valor, list): valor = [_normalizar(v) if isinstance(v, dict) else v for v in valor]
        limpo[chave] = valor
    return limpo


async def _uso(doc: dict) -> UsoEmpresa:
    banco = client[doc["db_name"]]
    limite_30d = now_utc() - timedelta(days=30)
    try:
        stats = await banco.command("dbStats")
        armazenamento = round((stats.get("storageSize", 0) or 0) / (1024 * 1024), 2)
    except Exception:
        armazenamento = 0.0

    parcelas = await banco.transacoes.find(
        {"tipo": "receber", "contrato_id": {"$ne": None}}, {"valor": 1}
    ).to_list(None)

    return UsoEmpresa(
        empresa_id=doc["id"],
        nome=doc["nome"],
        slug=doc["slug"],
        plano=doc.get("plano", "essencial"),
        ativo=doc.get("ativo", True),
        criada_em=utc_aware(doc.get("created_at")),
        ultimo_acesso=utc_aware(doc.get("ultimo_acesso")),
        usuarios=await banco.usuarios.count_documents({}),
        usuarios_ativos=await banco.usuarios.count_documents({"ativo": True}),
        corretores=await banco.usuarios.count_documents({"papel": "corretor"}),
        imoveis=await banco.imoveis.count_documents({}),
        imoveis_publicados=await banco.imoveis.count_documents({"status": "publicado"}),
        leads=await banco.leads.count_documents({}),
        leads_30d=await banco.leads.count_documents({"created_at": {"$gte": limite_30d}}),
        contratos=await banco.contratos.count_documents({}),
        contratos_ativos=await banco.contratos.count_documents({"status": "ativo"}),
        visitas=await banco.visitas.count_documents({}),
        transacoes=await banco.transacoes.count_documents({}),
        receita_contratada=round(sum(p.get("valor", 0) for p in parcelas), 2),
        armazenamento_mb=armazenamento,
    )

ROTULOS_AMBIENTE = {
    "producao": "Produção",
    "homologacao": "Homologação",
    "desenvolvimento": "Desenvolvimento",
}


def to_empresa(doc: dict) -> Empresa:
    data = dict(doc)
    data.pop("_id", None)
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    return Empresa(**data)


@router.get("/ambiente", response_model=Ambiente)
async def ambiente():
    """Ambiente em que esta instalação roda — base da faixa de aviso fora de produção."""
    return Ambiente(
        ambiente=AMBIENTE,
        producao=AMBIENTE == "producao",
        rotulo=ROTULOS_AMBIENTE.get(AMBIENTE, AMBIENTE.title()),
        empresas_ativas=await controle.empresas.count_documents({"ativo": True}),
    )


@router.get("", response_model=List[EmpresaResumo])
async def list_empresas(principal: Principal = Depends(require("empresa:manage"))):
    docs = await controle.empresas.find().sort("nome", 1).to_list(None)
    return [await _resumo(d) for d in docs]


async def _resumo(d: dict, **extra) -> EmpresaResumo:
    from lib.planos import carregar_catalogo, plano_de, valores_comerciais

    await carregar_catalogo()

    e = to_empresa(d)
    plano = plano_de(d)
    banco = client[e.db_name]
    return EmpresaResumo(
        **e.model_dump(), **await contadores(e.db_name), **extra,
        comercial=d.get("comercial"), valores=(valores := valores_comerciais(d)),
        plano_nome=plano["nome"], plano_preco=(valores["equivalente_mensal"] if valores else plano["preco"]), limite_usuarios=plano["usuarios"], limite_imoveis=plano["imoveis"],
        usuarios_ativos=await banco.usuarios.count_documents({"ativo": {"$ne": False}, "papel": {"$ne": "sysadmin"}}),
        imoveis_carteira=await banco.imoveis.count_documents({"status": {"$nin": ["vendido", "alugado"]}}),
    )


@router.post("", response_model=EmpresaResumo, status_code=201)
async def create_empresa(input: EmpresaCreate, principal: Principal = Depends(require("empresa:manage"))):
    slug = slugificar(input.slug or input.nome)
    if await controle.empresas.find_one({"slug": slug}):
        raise HTTPException(status_code=409, detail=f"Já existe empresa com o identificador '{slug}'")

    email = input.admin_email.lower().strip()
    if await controle.usuarios_index.find_one({"email": email}) or await controle.usuarios.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Este e-mail já é usado por outro acesso")
    if input.dados_demonstracao and AMBIENTE == "producao":
        raise HTTPException(status_code=403, detail="Dados de demonstração não são permitidos em produção")

    senha = (input.admin_senha or "").strip() or senha_provisoria()
    if len(senha) < 6:
        raise HTTPException(status_code=422, detail="A senha do gestor deve ter ao menos 6 caracteres")

    db_name = nome_banco_empresa(slug)
    from lib.planos import PLANOS, carregar_catalogo

    await carregar_catalogo()

    if input.plano not in PLANOS:
        raise HTTPException(422, "Plano inválido")
    empresa = Empresa(nome=input.nome.strip(), slug=slug, db_name=db_name, cnpj=input.cnpj, plano=input.plano,
                      plano_aplicado=True, modulos=list(PLANOS[input.plano]["modulos"]))

    gestor = Usuario(
        nome=input.admin_nome.strip(), email=email, senha_hash=hash_senha(senha), papel="admin"
    ).model_dump()

    await indexar_usuario(email, empresa.id, db_name)
    gestor["activation_required"] = not bool(input.admin_senha)
    api_key = await provisionar_empresa(nome=input.nome.strip(), db_name=db_name, admin=gestor)
    empresa.site_api_key = api_key
    await controle.empresas.insert_one(empresa.model_dump())
    await indexar_usuario(email, empresa.id, db_name)

    link = None
    if input.enviar_convite and gestor["activation_required"]:
        link = await enviar_convite_gestor(
            empresa_nome=empresa.nome, nome=gestor["nome"], email=email, senha=senha
        )
    from lib.email import email_configurado
    convite = bool(link) and email_configurado()

    logger.info("empresa criada por %s: %s (convite=%s)", principal.email, slug, convite)
    return await _resumo(empresa.model_dump(), convite_enviado=convite, link_ativacao=link)


@router.post("/{empresa_id}/reenviar-convite")
async def reenviar_convite(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    """Gera nova senha provisória para o primeiro gestor e reenvia o convite por e-mail."""
    empresa = await controle.empresas.find_one({"id": empresa_id})
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    banco = client[empresa["db_name"]]
    gestor = await banco.usuarios.find_one({"papel": "admin", "ativo": True}, sort=[("created_at", 1)])
    if not gestor:
        raise HTTPException(status_code=409, detail="Esta empresa não tem gestor ativo cadastrado")

    from lib.db import definir_empresa
    definir_empresa(banco.name)
    try:
        link = await invite(banco, gestor, empresa["nome"])
    except Exception:
        raise HTTPException(502, "Não foi possível enfileirar o convite; o acesso anterior foi preservado")
    from lib.email import email_configurado
    return {"enviado": email_configurado(), "email": gestor["email"], "nome": gestor.get("nome"), "link_ativacao": link}



@router.get("/uso", response_model=List[UsoEmpresa])
async def uso_geral(principal: Principal = Depends(require("empresa:manage"))):
    """Painel de uso de todas as empresas — acompanhamento de plano e capacidade."""
    docs = await controle.empresas.find().sort("nome", 1).to_list(None)
    return [await _uso(d) for d in docs]


@router.get("/{empresa_id}/uso", response_model=UsoEmpresa)
async def uso_empresa(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return await _uso(doc)


async def _transactions_available():
    hello = await client.admin.command("hello")
    if not (hello.get("setName") or hello.get("msg") == "isdbgrid"):
        raise HTTPException(503, "Backup/restauração consistente exige MongoDB replica set; nenhum dado foi alterado")


@router.get("/{empresa_id}/backup")
async def backup_empresa(empresa_id: str, principal: Principal = Depends(require("empresa:manage"))):
    from lib.backups import cipher, seal
    from pymongo.read_concern import ReadConcern
    cipher()
    await _transactions_available()
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc: raise HTTPException(404, "Empresa não encontrada")
    banco = client[doc["db_name"]]
    async with await client.start_session() as session:
        async with session.start_transaction(read_concern=ReadConcern("snapshot")):
            colecoes = {name: await banco[name].find({}, session=session).to_list(None) for name in COLECOES_BACKUP}
    payload = {"empresa_id": empresa_id, "empresa_slug": doc["slug"], "gerado_em": now_utc(), "colecoes": colecoes}
    return Response(content=json.dumps(seal(payload)), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="backup-{doc["slug"]}-{now_utc():%Y%m%d-%H%M}.json"', "Cache-Control": "no-store"})


@router.post("/{empresa_id}/restaurar")
async def restaurar_empresa(empresa_id: str, input: RestauracaoEmpresa, principal: Principal = Depends(require("empresa:manage"))):
    from lib.backups import unseal
    from pymongo.errors import PyMongoError
    if input.formato != "cedronexxo-encrypted-v1": raise HTTPException(422, "Formato não suportado; migre backups antigos em homologação")
    payload = unseal(input.conteudo)
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc: raise HTTPException(404, "Empresa não encontrada")
    if payload.get("empresa_id") != empresa_id or payload.get("empresa_slug") != doc["slug"]:
        raise HTTPException(422, "Este backup não pertence à empresa selecionada")
    collections = payload.get("colecoes", {})
    if not set(COLECOES_OBRIGATORIAS) <= set(collections) or set(collections) - set(COLECOES_BACKUP) or any(not isinstance(v, list) for v in collections.values()):
        raise HTTPException(422, "Backup incompleto")
    users = collections["usuarios"]
    if not any(u.get("ativo") and u.get("papel") == "admin" for u in users):
        raise HTTPException(422, "Backup sem gestor ativo")
    if any(u.get("papel") == "sysadmin" for u in users): raise HTTPException(422, "Papel de sistema inválido no tenant")
    await _transactions_available()
    banco = client[doc["db_name"]]
    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                existing = {u["id"]: u.get("session_version", 0) for u in await banco.usuarios.find({}, session=session).to_list(None)}
                for user in users:
                    user["session_version"] = max(existing.get(user["id"], 0), user.get("session_version", 0)) + 1
                    user.pop("activation_digest", None)
                    user.pop("activation_expires", None)
                    if await controle.usuarios.find_one({"email": user["email"]}, session=session):
                        raise HTTPException(409, "E-mail reservado ao plano de controle")
                    await controle.usuarios_index.update_one({"email": user["email"], "empresa_id": empresa_id},
                        {"$set": {"db_name": doc["db_name"]}}, upsert=True, session=session)
                for name, rows in collections.items():
                    await banco[name].delete_many({}, session=session)
                    if rows:
                        normalized = [{**_normalizar(row), **({"_id": row["_id"]} if "_id" in row else {})} for row in rows]
                        await banco[name].insert_many(normalized, session=session)
                await controle.usuarios_index.delete_many({"empresa_id": empresa_id, "email": {"$nin": [u["email"] for u in users]}}, session=session)
                config = await banco.configuracoes.find_one({"id": "singleton"}, session=session)
                await controle.empresas.update_one({"id": empresa_id}, {"$set": {"site_api_key": (config or {}).get("site_api_key")}}, session=session)
                await banco.audit_events.insert_one({"id": new_id(), "action": "empresa.restaurar", "actor": principal.usuario_id, "at": now_utc()}, session=session)
                # Fotos de imóveis são servidas por URL pública indexada no banco de controle.
                for foto in collections.get("fotos_imovel") or []:
                    if foto.get("id"):
                        await controle.fotos_index.update_one({"_id": foto["id"]}, {"$set": {"db_name": doc["db_name"]}}, upsert=True, session=session)
    except PyMongoError:
        raise HTTPException(409, "Restauração não concluída; transação revertida. Verifique conflitos de e-mail e integridade")
    return {"restaurado": {name: len(rows) for name, rows in collections.items()}}


@router.patch("/{empresa_id}", response_model=Empresa)
async def update_empresa(
    empresa_id: str, input: EmpresaUpdate, principal: Principal = Depends(require("empresa:manage"))
):
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    from lib.validation import patch_data
    from models.config import MODULOS
    from lib.planos import PLANOS, RECURSOS, carregar_catalogo

    await carregar_catalogo()

    data = patch_data(input, ("nome", "plano", "ativo", "modulos"))
    if "modulos" in data and any(m not in MODULOS for m in data["modulos"]):
        raise HTTPException(422, "Módulo inválido")
    if "plano" in data:
        if data["plano"] == "legado":
            data.pop("plano")
            data["plano_aplicado"] = False
            data.setdefault("modulos", [])
        elif data["plano"] in PLANOS:
            data["plano_aplicado"] = True
            if "modulos" not in data and (data["plano"] != doc.get("plano") or not doc.get("plano_aplicado")):
                data["modulos"] = list(PLANOS[data["plano"]]["modulos"])
        else:
            raise HTTPException(422, "Plano inválido")
    if data.pop("remover_limites_personalizados", None):
        data["limites_personalizados"] = None
    elif data.get("limites_personalizados") is not None:
        extras = data["limites_personalizados"].get("recursos_extras") or []
        if any(r not in RECURSOS for r in extras):
            raise HTTPException(422, "Recurso inválido")
    if data:
        data["updated_at"] = now_utc()
        await controle.empresas.update_one({"id": empresa_id}, {"$set": data})
    return to_empresa(await controle.empresas.find_one({"id": empresa_id}))


@router.put("/{empresa_id}/comercial", response_model=EmpresaResumo)
async def condicoes_comerciais(empresa_id: str, input: ComercialEmpresa, principal: Principal = Depends(require("empresa:manage"))):
    """Periodicidade, adicionais, desconto e taxa de instalação negociados com a empresa."""
    from lib.planos import ADICIONAIS, carregar_catalogo

    await carregar_catalogo(forcar=True)
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc:
        raise HTTPException(404, "Empresa não encontrada")
    chaves = [a.chave for a in input.adicionais]
    if any(c not in ADICIONAIS for c in chaves):
        raise HTTPException(422, "Adicional inválido")
    if len(chaves) != len(set(chaves)):
        raise HTTPException(422, "Adicional repetido. Ajuste a quantidade em vez de incluir duas vezes.")
    if input.desconto_tipo == "percentual" and input.desconto_valor > 100:
        raise HTTPException(422, "Desconto percentual vai até 100%")
    dados = input.model_dump()
    if not input.desconto_tipo:
        dados["desconto_valor"] = 0
    await controle.empresas.update_one({"id": empresa_id}, {"$set": {"comercial": dados, "updated_at": now_utc()}})
    logger.info("condições comerciais da empresa %s alteradas por %s", doc.get("slug"), principal.email)
    return await _resumo(await controle.empresas.find_one({"id": empresa_id}))


@router.delete("/{empresa_id}", status_code=204)
async def delete_empresa(
    empresa_id: str,
    confirmar: str = Query(..., description="Repita o identificador (slug) da empresa"),
    principal: Principal = Depends(require("empresa:manage")),
):
    """Apaga a empresa E o banco dela. Exige confirmação explícita do slug."""
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if confirmar != doc["slug"]:
        raise HTTPException(status_code=422, detail="Confirmação não corresponde ao identificador da empresa")

    emails = [u["email"] async for u in client[doc["db_name"]].usuarios.find({}, {"email": 1})]
    for email in emails:
        await desindexar_usuario(email, empresa_id)
    await client.drop_database(doc["db_name"])
    await controle.empresas.delete_one({"id": empresa_id})
    logger.warning("empresa excluída por %s: %s", principal.email, doc["slug"])
    return None


@router.post("/{empresa_id}/acessar", response_model=Principal)
async def acessar_empresa(
    empresa_id: str, response: Response, principal: Principal = Depends(require("empresa:manage"))
):
    """Administrador de Sistema entra na empresa (suporte): novo token com `empresa_id`."""
    doc = await controle.empresas.find_one({"id": empresa_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if not doc.get("ativo", True):
        raise HTTPException(status_code=403, detail="Empresa desativada")

    gravar_cookie(response, criar_token(principal.usuario_id, empresa_id=empresa_id, session_version=principal.session_version))
    return Principal(
        **{**principal.model_dump(exclude={"empresa_id", "empresa_nome", "suporte"}),
           "empresa_id": empresa_id, "empresa_nome": doc["nome"], "suporte": True}
    )


@router.post("/sair", response_model=Principal)
async def sair_da_empresa(response: Response, principal: Principal = Depends(require("empresa:manage"))):
    """Volta ao plano de controle (sem empresa no token)."""
    gravar_cookie(response, criar_token(principal.usuario_id, session_version=principal.session_version))
    return Principal(
        **{**principal.model_dump(exclude={"empresa_id", "empresa_nome", "suporte"}),
           "empresa_id": None, "empresa_nome": None, "suporte": False}
    )


__all__ = ["router", "new_id"]
