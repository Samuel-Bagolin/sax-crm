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


def _autorizado(authorization: str | None) -> None:
    segredo = os.environ.get("CRON_SECRET") or os.environ.get("WEBHOOK_CRON_SECRET") or ""
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    if not segredo or not token or not hmac.compare_digest(token, segredo):
        raise HTTPException(401, "Não autorizado")


async def _lembretes(enviar, data_alvo: str) -> int:
    return (await enviar(data_alvo)).emails_enviados


@router.get("/rotina")
async def rotina(authorization: str | None = Header(None)):
    _autorizado(authorization)
    from lib.automacoes import negocios_parados
    from lib.email import drenar_fila
    from routers.agenda import _amanha, enviar_lembretes

    resumo = {"empresas": 0, "emails": 0, "automacoes": 0, "lembretes": 0, "falhas": 0}
    resumo["emails"] += await drenar_fila(controle)
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
