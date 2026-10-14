"""Etapas com cadeado (lógica do CRM Revendas do O Pudim Perfeito).

Uma etapa pode exigir evidência (`etapa.requisito`): "contato" (um contato concluído com sucesso) ou
"reuniao" (uma reunião realizada). O card só entra nela, ou passa por ela, com a evidência registrada.
Concluir a atividade com resultado positivo avança o card até a etapa do requisito (só avança).
"""

from __future__ import annotations

from lib.db import db

TIPOS = {"contato": {"ligacao", "whatsapp", "email", "visita", "reuniao", "almoco"}, "reuniao": {"reuniao", "visita", "almoco"}}
ROTULO = {"contato": "um contato concluído com sucesso (ligação, WhatsApp ou e-mail)", "reuniao": "uma reunião realizada"}


def _positiva(a: dict) -> bool:
    return bool(a.get("concluida")) and a.get("resultado") != "negativo"


async def evidencias(negocio_id: str) -> set[str]:
    feitas = [a for a in await db.atividades.find({"negocio_id": negocio_id, "concluida": True}).to_list(500) if _positiva(a)]
    return {req for req, tipos in TIPOS.items() if any(a.get("tipo") in tipos for a in feitas)}


async def bloqueio(negocio: dict, funil: dict, etapa_alvo_id: str) -> str | None:
    """Mensagem de por que o card não pode ir para a etapa, ou None."""
    etapas = funil.get("etapas") or []
    alvo = next((i for i, e in enumerate(etapas) if e["id"] == etapa_alvo_id), None)
    atual = next((i for i, e in enumerate(etapas) if e["id"] == negocio.get("etapa_id")), -1)
    if alvo is None or alvo <= atual:
        return None  # voltar sempre pode
    alcancadas = set(negocio.get("etapas_alcancadas") or [])
    exigidas = [e for e in etapas[: alvo + 1] if e.get("requisito") and e["id"] not in alcancadas]
    if not exigidas:
        return None
    tem = await evidencias(negocio["id"])
    for e in exigidas:
        if e["requisito"] not in tem:
            return f"Para entrar em \"{e['nome']}\" registre antes {ROTULO.get(e['requisito'], 'a evidência da etapa')}."
    return None


async def avancar(negocio_id: str, atividade: dict, autor) -> None:
    """Atividade concluída com resultado positivo: o card avança até a etapa que ela destrava."""
    if not negocio_id or not _positiva(atividade):
        return
    neg = await db.leads.find_one({"id": negocio_id})
    if not neg or neg.get("status") != "aberto":
        return
    funil = await db.funis.find_one({"id": neg.get("funil_id")})
    if not funil:
        return
    etapas = funil.get("etapas") or []
    atual = next((i for i, e in enumerate(etapas) if e["id"] == neg.get("etapa_id")), 0)
    tem = await evidencias(negocio_id)
    destino = atual
    for i, e in enumerate(etapas):
        if e.get("requisito") and e["requisito"] in tem and atividade.get("tipo") in TIPOS[e["requisito"]]:
            destino = max(destino, i)
    if destino <= atual:
        return
    if await bloqueio(neg, funil, etapas[destino]["id"]):
        return
    from models.common import now_utc
    from lib.crm import registrar

    alvo = etapas[destino]
    await db.leads.update_one({"id": negocio_id}, {"$set": {"etapa_id": alvo["id"], "etapa_desde": now_utc(), "updated_at": now_utc()},
                                                   "$addToSet": {"etapas_alcancadas": alvo["id"]}})
    await registrar(negocio_id, "etapa", f"Etapa: {etapas[atual]['nome']} → {alvo['nome']} (avançou pela atividade concluída)", autor)
