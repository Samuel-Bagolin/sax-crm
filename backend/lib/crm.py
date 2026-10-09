"""Regras compartilhadas do CRM: funis padrão, migração dos leads legados e histórico."""

import logging

from lib.db import client, controle, db
from models.common import new_id, now_utc
from models.crm import CrmConfig, Etapa, Funil

logger = logging.getLogger(__name__)

ORIGENS_PADRAO = [
    "Site", "WhatsApp", "Portal ZAP", "VivaReal", "OLX", "Instagram / Facebook Ads",
    "Indicação / Carteira", "Placa no Local", "Telefone",
]
MOTIVOS_PERDA_PADRAO = [
    "Preço acima do orçamento", "Comprou com outra imobiliária", "Financiamento não aprovado",
    "Desistiu da operação", "Sem retorno do cliente", "Imóvel indisponível", "Documentação pendente",
]
ETIQUETAS_PADRAO = ["Quente", "Investidor", "Primeiro imóvel", "Permuta", "Financiamento", "À vista"]

FUNIS_PADRAO = [
    ("Vendas", True, [
        ("Novo contato", 10, 3), ("Em atendimento", 25, 5), ("Visita agendada", 45, 7),
        ("Proposta enviada", 70, 7), ("Negociação e documentação", 85, 10),
    ]),
    ("Locação", False, [
        ("Novo contato", 10, 2), ("Qualificação", 30, 3), ("Visita", 50, 5),
        ("Análise cadastral / garantia", 75, 5), ("Contrato", 90, 5),
    ]),
]

# Etapa (por posição) → estágio legado usado por módulos antigos.
_LEGADO_POR_POSICAO = ["novo", "atendimento", "visita", "proposta"]


def estagio_legado(funil: dict | None, etapa_id: str | None, status: str) -> str:
    if status in ("ganho", "perdido"):
        return status
    if not funil:
        return "novo"
    ids = [e["id"] for e in funil.get("etapas", [])]
    pos = ids.index(etapa_id) if etapa_id in ids else 0
    return _LEGADO_POR_POSICAO[min(pos, len(_LEGADO_POR_POSICAO) - 1)]


def _funis_padrao() -> list[dict]:
    funis = []
    for ordem, (nome, padrao, etapas) in enumerate(FUNIS_PADRAO):
        funis.append(Funil(
            nome=nome, ordem=ordem, padrao=padrao,
            etapas=[Etapa(nome=n, probabilidade=p, dias_parado=d) for n, p, d in etapas],
        ).model_dump())
    return funis


async def garantir_crm(banco=None) -> None:
    """Idempotente: funis padrão, configuração do CRM e migração dos leads antigos."""
    banco = banco if banco is not None else db
    if await banco.funis.count_documents({}) == 0:
        await banco.funis.insert_many(_funis_padrao())
    cfg = await banco.configuracoes.find_one({"id": "singleton"}, {"crm": 1})
    if cfg is not None and not cfg.get("crm"):
        await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {"crm": CrmConfig(
            origens=ORIGENS_PADRAO, motivos_perda=MOTIVOS_PERDA_PADRAO, etiquetas=ETIQUETAS_PADRAO,
        ).model_dump()}})

    from lib.automacoes import garantir_padrao

    await garantir_padrao(banco)
    padrao = await banco.funis.find_one({"padrao": True}) or await banco.funis.find_one({})
    if not padrao:
        return
    etapas = padrao["etapas"]
    mapa = {"novo": 0, "atendimento": 1, "visita": 2, "proposta": 3}
    async for lead in banco.leads.find({"funil_id": {"$in": [None]}}):
        estagio = lead.get("estagio", "novo")
        status = estagio if estagio in ("ganho", "perdido") else "aberto"
        pos = mapa.get(estagio, len(etapas) - 1)
        etapa = etapas[min(pos, len(etapas) - 1)]
        await banco.leads.update_one({"id": lead["id"]}, {"$set": {
            "funil_id": padrao["id"], "etapa_id": etapa["id"], "status": status,
            "etapa_desde": lead.get("updated_at") or lead.get("created_at") or now_utc(),
            "etiquetas": lead.get("etiquetas") or [],
        }})


async def garantir_crm_todas() -> None:
    async for empresa in controle.empresas.find({"ativo": True}, {"db_name": 1}):
        try:
            await garantir_crm(client[empresa["db_name"]])
        except Exception:
            logger.exception("garantir_crm falhou para %s", empresa.get("db_name"))


async def registrar(negocio_id: str, tipo: str, texto: str, principal=None, **extra) -> None:
    await db.historico.insert_one({
        "id": new_id(), "negocio_id": negocio_id, "tipo": tipo, "texto": texto,
        "autor": principal.nome if principal else "Sistema",
        "autor_id": principal.usuario_id if principal else None,
        "fixado": False, "em": now_utc(), **extra,
    })


async def carregar_crm_config() -> CrmConfig:
    doc = await db.configuracoes.find_one({"id": "singleton"}, {"crm": 1})
    data = (doc or {}).get("crm") or {}
    if not data:
        return CrmConfig(origens=ORIGENS_PADRAO, motivos_perda=MOTIVOS_PERDA_PADRAO, etiquetas=ETIQUETAS_PADRAO)
    return CrmConfig(**data)
