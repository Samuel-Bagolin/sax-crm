"""Automações do CRM: follow-up que não depende da memória do corretor.

Cada regra cria UMA atividade para o responsável do negócio/lead. A execução é idempotente: a
chave em `automacoes_execucoes` impede que a mesma regra dispare duas vezes para o mesmo evento
(reenvio, clique duplo, rotina periódica rodando de novo).

Gatilhos imediatos (chamados pelas rotas): lead_novo, entrou_etapa, negocio_ganho, negocio_perdido.
Gatilho periódico (rotina a cada 10 min): negocio_parado — negócio aberto há mais dias na etapa do
que o limite configurado nela e sem nenhuma atividade pendente.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from lib.crm import carregar_crm_config, registrar
from lib.db import client, controle, db, definir_empresa
from models.common import new_id, now_utc, utc_aware
from models.crm import Atividade, Automacao

logger = logging.getLogger(__name__)
INTERVALO_SEG = 600


def _tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("APP_TZ", "America/Sao_Paulo"))


def _data_util(dias: int) -> str:
    """Hoje + N dias; se cair no domingo, passa para segunda."""
    d = datetime.now(_tz()).date() + timedelta(days=dias)
    if d.weekday() == 6:
        d += timedelta(days=1)
    return d.isoformat()


async def _primeira_vez(chave: str) -> bool:
    try:
        await db.automacoes_execucoes.insert_one({"_id": chave, "em": now_utc()})
        return True
    except DuplicateKeyError:
        return False


async def _criar_atividade(regra: Automacao, *, negocio: dict | None = None, entrada: dict | None = None,
                           hora: str | None = None, data: str | None = None) -> str:
    alvo = negocio or entrada or {}
    atividade = Atividade(
        tipo=regra.tipo_atividade, assunto=regra.assunto, data=data or _data_util(regra.prazo_dias), hora=hora,
        negocio_id=(negocio or {}).get("id") or (entrada or {}).get("negocio_id"),
        entrada_id=(entrada or {}).get("id"), pessoa_id=alvo.get("cliente_id"), imovel_id=alvo.get("imovel_id"),
        corretor_id=alvo.get("corretor_id"), notas=regra.notas, created_by="automacao",
    )
    await db.atividades.insert_one({**atividade.model_dump(), "automacao_id": regra.id})
    if atividade.negocio_id:
        await registrar(atividade.negocio_id, "automacao", f"Automação “{regra.nome}” criou: {regra.assunto} ({_br(atividade.data)})")
    await _sincronizar_google(atividade.id)
    return atividade.id


def _br(iso: str) -> str:
    return f"{iso[8:10]}/{iso[5:7]}"


async def _sincronizar_google(atividade_id: str) -> None:
    """Leva a atividade automática ao Google Agenda do responsável, sem segurar a requisição."""
    async def tarefa():
        try:
            from routers.google import sincronizar_atividade

            await sincronizar_atividade(atividade_id)
        except Exception:
            logger.debug("sincronização Google da automação falhou", exc_info=True)

    if os.environ.get("VERCEL"):
        await tarefa()  # serverless: sem tarefas soltas depois da resposta
        return
    try:
        asyncio.get_running_loop().create_task(tarefa())
    except RuntimeError:
        pass


async def _regras(gatilho: str) -> list[Automacao]:
    from lib.planos import recurso_liberado

    if not await recurso_liberado("automacoes"):
        return []
    return [a for a in (await carregar_crm_config()).automacoes if a.ativo and a.gatilho == gatilho]


def _aplica(regra: Automacao, negocio: dict) -> bool:
    return not regra.funil_id or regra.funil_id == negocio.get("funil_id")


# ------------------------------------------------------------------ gatilhos imediatos


async def lead_novo(entrada: dict) -> None:
    """Lead entrou na caixa de entrada: primeira ação com horário = agora + SLA (se houver)."""
    try:
        cfg = await carregar_crm_config()
        for regra in await _regras("lead_novo"):
            if not await _primeira_vez(f"{regra.id}:entrada:{entrada['id']}"):
                continue
            hora, data = None, None
            if cfg.sla_primeiro_contato_min and regra.prazo_dias == 0:
                limite = datetime.now(_tz()) + timedelta(minutes=cfg.sla_primeiro_contato_min)
                data, hora = limite.date().isoformat(), limite.strftime("%H:%M")
            await _criar_atividade(regra, entrada=entrada, hora=hora, data=data)
    except Exception:
        logger.exception("automação lead_novo falhou")


async def negocio_alterado(antes: dict | None, depois: dict) -> None:
    """Chamado depois de criar/mover/ganhar/perder um negócio."""
    try:
        status_antes = (antes or {}).get("status", "aberto")
        status = depois.get("status", "aberto")
        if status == "aberto" and (antes is None or depois.get("etapa_id") != antes.get("etapa_id")):
            for regra in await _regras("entrou_etapa"):
                if regra.etapa_id == depois.get("etapa_id") and _aplica(regra, depois):
                    chave = f"{regra.id}:{depois['id']}:{depois.get('etapa_id')}:{utc_aware(depois.get('etapa_desde')) or ''}"
                    if await _primeira_vez(chave):
                        await _criar_atividade(regra, negocio=depois)
        if status != status_antes and status in ("ganho", "perdido"):
            for regra in await _regras(f"negocio_{status}"):
                if _aplica(regra, depois) and await _primeira_vez(f"{regra.id}:{depois['id']}:{status}"):
                    await _criar_atividade(regra, negocio=depois)
    except Exception:
        logger.exception("automação de negócio falhou")


# ------------------------------------------------------------------ rotina periódica


async def negocios_parados() -> int:
    regras = await _regras("negocio_parado")
    if not regras:
        return 0
    criadas = 0
    limites = {}
    async for f in db.funis.find({}, {"id": 1, "etapas": 1}):
        for e in f.get("etapas", []):
            if e.get("dias_parado"):
                limites[e["id"]] = e["dias_parado"]
    agora = now_utc()
    async for n in db.leads.find({"status": "aberto", "etapa_id": {"$in": list(limites)}}):
        desde = utc_aware(n.get("etapa_desde"))
        if not desde or agora - desde < timedelta(days=limites[n["etapa_id"]]):
            continue
        if await db.atividades.find_one({"negocio_id": n["id"], "concluida": False}, {"id": 1}):
            continue
        for regra in regras:
            if _aplica(regra, n) and await _primeira_vez(f"{regra.id}:{n['id']}:{n['etapa_id']}:{desde.isoformat()}"):
                await _criar_atividade(regra, negocio=n)
                criadas += 1
    return criadas


async def rodar_uma_vez() -> None:
    async for empresa in controle.empresas.find({"ativo": True}, {"db_name": 1}):
        definir_empresa(empresa["db_name"])
        try:
            await negocios_parados()
        except Exception:
            logger.exception("automações periódicas falharam em %s", empresa.get("db_name"))
        finally:
            definir_empresa(None)


async def worker() -> None:
    await asyncio.sleep(30)
    while True:
        try:
            await rodar_uma_vez()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("rotina de automações falhou")
        await asyncio.sleep(INTERVALO_SEG)


# ------------------------------------------------------------------ regras padrão


def regras_padrao(funis: list[dict]) -> list[dict]:
    """Ponto de partida sensato; o gestor liga/desliga e edita em Configurar CRM."""
    regras = [
        Automacao(nome="Primeiro contato com lead novo", gatilho="lead_novo", tipo_atividade="ligacao",
                  assunto="Primeiro contato com o lead", prazo_dias=0),
        Automacao(nome="Retomar negócio parado", gatilho="negocio_parado", tipo_atividade="whatsapp",
                  assunto="Retomar contato: negócio parado", prazo_dias=0),
        Automacao(nome="Pós-venda: pedir indicação", gatilho="negocio_ganho", tipo_atividade="ligacao",
                  assunto="Pós-venda: satisfação e pedido de indicação", prazo_dias=30),
    ]
    vendas = next((f for f in funis if f.get("nome") == "Vendas"), None)
    if vendas:
        for etapa in vendas.get("etapas", []):
            nome = etapa["nome"].lower()
            if "proposta" in nome:
                regras.append(Automacao(nome="Follow-up da proposta", gatilho="entrou_etapa", funil_id=vendas["id"], etapa_id=etapa["id"],
                                        tipo_atividade="ligacao", assunto="Follow-up da proposta enviada", prazo_dias=2))
            elif "visita" in nome:
                regras.append(Automacao(nome="Confirmar visita", gatilho="entrou_etapa", funil_id=vendas["id"], etapa_id=etapa["id"],
                                        tipo_atividade="whatsapp", assunto="Confirmar visita e enviar localização", prazo_dias=0))
    return [r.model_dump() for r in regras]


async def garantir_padrao(banco) -> None:
    """Grava as regras padrão uma única vez por empresa (marca `automacoes_iniciadas`)."""
    cfg = await banco.configuracoes.find_one({"id": "singleton"}, {"crm": 1})
    crm = (cfg or {}).get("crm")
    if cfg is None or not crm or crm.get("automacoes_iniciadas"):
        return
    funis = await banco.funis.find({}, {"id": 1, "nome": 1, "etapas": 1}).to_list(None)
    await banco.configuracoes.update_one({"id": "singleton"}, {"$set": {
        "crm.automacoes": crm.get("automacoes") or regras_padrao(funis), "crm.automacoes_iniciadas": True,
        "crm.sla_primeiro_contato_min": crm.get("sla_primeiro_contato_min", 30),
    }})


async def garantir_padrao_todas() -> None:
    async for empresa in controle.empresas.find({"ativo": True}, {"db_name": 1}):
        try:
            await garantir_padrao(client[empresa["db_name"]])
        except Exception:
            logger.exception("automações padrão falharam para %s", empresa.get("db_name"))
