"""Rotina agendada única para ambientes sem processo contínuo (Vercel Cron).

O Vercel chama `GET /api/cron/rotina` com `Authorization: Bearer <CRON_SECRET>`. Cada chamada:
envia a fila de e-mails, roda as automações de negócio parado e enfileira os lembretes de visita
de amanhã (idempotentes: visita já avisada não é avisada de novo).
"""

import hmac
import logging
import os

from fastapi import APIRouter, Header, HTTPException

from lib.db import client, controle, definir_empresa

router = APIRouter(prefix="/cron", tags=["cron"])
logger = logging.getLogger(__name__)


async def _autorizado(authorization: str | None, agente: str | None) -> None:
    segredo = os.environ.get("CRON_SECRET") or os.environ.get("WEBHOOK_CRON_SECRET") or ""
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    if segredo and token and hmac.compare_digest(token, segredo):
        return
    # Sem CRON_SECRET cadastrado no Vercel, o Vercel Cron chama sem senha. Aceita a chamada dele no
    # máximo a cada 20 min (a rotina é idempotente; quem forjar o cabeçalho só adianta a rotina).
    from lib.autoconfig import ESTADO

    if ESTADO.get("segredos") == "banco" and (agente or "").startswith("vercel-cron"):
        from datetime import timedelta

        from pymongo.errors import DuplicateKeyError

        from models.common import now_utc

        agora = now_utc()
        try:
            r = await controle["_sistema"].update_one({"_id": "cron", "ultima": {"$lt": agora - timedelta(minutes=20)}},
                                                      {"$set": {"ultima": agora}}, upsert=True)
            if r.modified_count or r.upserted_id is not None:
                return
        except DuplicateKeyError:
            pass
        raise HTTPException(429, "Rotina executada há pouco")
    raise HTTPException(401, "Não autorizado")


async def _lembretes(enviar, data_alvo: str) -> int:
    return (await enviar(data_alvo)).emails_enviados


@router.get("/rotina")
async def rotina(authorization: str | None = Header(None), user_agent: str | None = Header(None)):
    await _autorizado(authorization, user_agent)
    from lib.automacoes import negocios_parados
    from lib.email import drenar_fila
    from routers.agenda import _amanha, enviar_lembretes

    resumo = {"empresas": 0, "emails": 0, "automacoes": 0, "lembretes": 0, "falhas": 0}
    resumo["emails"] += await drenar_fila(controle)
    try:  # Firestore não tem índice TTL: limpa os contadores de tentativa de login vencidos
        from models.common import now_utc
        await controle.rate_limits.delete_many({"expires": {"$lt": now_utc()}})
    except Exception:
        logger.exception("limpeza de rate_limits falhou")
    async for empresa in controle.empresas.find({"ativo": True}, {"db_name": 1}):
        nome = empresa["db_name"]
        definir_empresa(nome)
        resumo["empresas"] += 1
        etapas = (
            ("automacoes", negocios_parados),
            ("lembretes", lambda: _lembretes(enviar_lembretes, _amanha())),
            ("emails", lambda: drenar_fila(client[nome])),
        )
        for chave, etapa in etapas:  # uma etapa com falha não impede as outras
            try:
                resumo[chave] += await etapa()
            except Exception:
                resumo["falhas"] += 1
                logger.exception("rotina: %s falhou em %s", chave, nome)
        definir_empresa(None)
    return resumo
