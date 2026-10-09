"""Provisionamento de empresas (tenants) — cria e popula o banco de uma nova empresa."""

import logging
import secrets
from pymongo.errors import DuplicateKeyError
from fastapi import HTTPException

from lib.db import client, controle, ensure_indexes_empresa
from models.common import new_id, now_utc

logger = logging.getLogger(__name__)

# Plano de contas padrão entregue a toda empresa nova (3 níveis).
PLANO_PADRAO = [
    ("1", "Receitas", "receita", None),
    ("1.1", "Comissões", "receita", "1"),
    ("1.1.1", "Comissão de Venda", "receita", "1.1"),
    ("1.1.2", "Comissão de Locação", "receita", "1.1"),
    ("1.2", "Administração", "receita", "1"),
    ("1.2.1", "Taxa de Administração de Locação", "receita", "1.2"),
    ("2", "Despesas", "despesa", None),
    ("2.1", "Marketing", "despesa", "2"),
    ("2.1.1", "Anúncios em Portais", "despesa", "2.1"),
    ("2.1.2", "Ads / Redes Sociais", "despesa", "2.1"),
    ("2.2", "Operacional", "despesa", "2"),
    ("2.2.1", "Aluguel do Escritório", "despesa", "2.2"),
    ("2.2.2", "Materiais e Expediente", "despesa", "2.2"),
    ("2.3", "Custos de Imóveis", "despesa", "2"),
    ("2.3.1", "IPTU", "despesa", "2.3"),
    ("2.3.2", "Condomínio", "despesa", "2.3"),
    ("2.3.3", "Manutenção e Reparos", "despesa", "2.3"),
]


async def provisionar_empresa(*, nome: str, db_name: str, admin: dict) -> str:
    """Cria o banco da empresa com índices, plano de contas, configuração e o primeiro gestor.

    Devolve a chave de API do site gerada para a empresa.
    """
    banco = client[db_name]
    await ensure_indexes_empresa(db_name)

    if await banco.plano_contas.count_documents({}) == 0:
        ids: dict[str, str] = {}
        docs = []
        for codigo, nome_conta, tipo, pai in PLANO_PADRAO:
            cid = new_id()
            ids[codigo] = cid
            docs.append(
                {
                    "id": cid,
                    "codigo": codigo,
                    "nome": nome_conta,
                    "tipo": tipo,
                    "conta_pai_id": ids.get(pai) if pai else None,
                    "ativo": True,
                    "created_at": now_utc(),
                }
            )
        await banco.plano_contas.insert_many(docs)

    api_key = f"ik_{secrets.token_hex(16)}"
    if not await banco.configuracoes.find_one({"id": "singleton"}):
        await banco.configuracoes.insert_one(
            {
                "id": "singleton",
                "nome_software": nome,
                "slogan": "Gestão Imobiliária Ágil",
                "modulos_ativos": ["dashboard", "imoveis", "crm", "agenda", "contratos", "financeiro", "usuarios"],
                "titulos_modulos": {
                    "dashboard": "Visão Geral",
                    "imoveis": "Imóveis",
                    "crm": "CRM & Funil",
                    "agenda": "Agenda",
                    "contratos": "Contratos",
                    "financeiro": "Financeiro",
                    "usuarios": "Consultores",
                },
                "cor_painel": "#ffffff",
                "cor_fonte": "#1c1c1c",
                "cor_primaria": "#4a03a2",
                "imagem_fundo_login": None,
                "email_remetente_nome": nome,
                "email_resposta": None,
                "whatsapp_numero": None,
                "whatsapp_phone_id": None,
                "whatsapp_token": None,
                "site_url": None,
                "site_api_key": api_key,
                "site_webhook_ativo": True,
                "logo_base64": None,
                "logo_mime": None,
                "atualizado_em": now_utc(),
                "atualizado_por": "Provisionamento",
            }
        )
    else:
        doc = await banco.configuracoes.find_one({"id": "singleton"}, {"site_api_key": 1})
        api_key = doc.get("site_api_key") or api_key

    from lib.crm import garantir_crm

    await garantir_crm(banco)

    if not await banco.usuarios.find_one({"email": admin["email"]}):
        await banco.usuarios.insert_one(admin)

    logger.info("empresa provisionada: %s (%s)", nome, db_name)
    return api_key


async def indexar_usuario(email: str, empresa_id: str, db_name: str) -> None:
    email = email.lower().strip()
    global_user = await controle.usuarios.find_one({"email": email})
    if global_user:
        raise HTTPException(409, "Este e-mail já é usado por outro acesso")
    try:
        await controle.usuarios_index.update_one(
            {"email": email, "empresa_id": empresa_id},
            {"$set": {"db_name": db_name, "em": now_utc()}, "$setOnInsert": {"email": email, "empresa_id": empresa_id}},
            upsert=True,
        )
    except DuplicateKeyError:
        raise HTTPException(409, "Este e-mail já é usado por outra empresa")


async def desindexar_usuario(email: str, empresa_id: str) -> None:
    await controle.usuarios_index.delete_one({"email": email.lower().strip(), "empresa_id": empresa_id})


async def contadores(db_name: str) -> dict:
    banco = client[db_name]
    return {
        "usuarios": await banco.usuarios.count_documents({}),
        "imoveis": await banco.imoveis.count_documents({}),
        "leads": await banco.leads.count_documents({}),
        "contratos": await banco.contratos.count_documents({}),
    }
