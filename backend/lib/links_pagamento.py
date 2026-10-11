"""Links de pagamento do Asaas para vender os planos fora do cadastro do site (WhatsApp, proposta, e-mail).

Um link por plano ativo do catálogo, por período (mensal e anual) e por forma de pagamento:
- cartão de crédito no preço da tabela, cobrado sozinho a cada ciclo;
- Pix com 10% de desconto: a cada ciclo o Asaas envia uma nova cobrança Pix para o cliente pagar.

O Asaas não tem campo de desconto no link, por isso o desconto do Pix já vai no valor do link.
Quem paga pelo link não ganha conta no CRM sozinho: a equipe libera o acesso.

A sincronização é idempotente: link com o mesmo valor é mantido; preço mudou, o link antigo é
removido no Asaas e um novo é criado; plano desativado tem o link removido. Roda em lotes para caber
no tempo máximo da função no Vercel, e uma trava impede dois cliques de criarem links duplicados.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from lib import asaas
from lib.db import controle
from models.common import now_utc, utc_aware

COLECAO = "links_pagamento"
LOTE = 12
DESCONTO_PIX = Decimal("0.10")
FORMAS = {
    "cartao": {"billing": "CREDIT_CARD", "rotulo": "Cartão de crédito", "fator": Decimal("1")},
    "pix": {"billing": "PIX", "rotulo": "Pix 10% off", "fator": Decimal("1") - DESCONTO_PIX},
}
PERIODOS = {"mensal": {"ciclo": "MONTHLY", "rotulo": "Mensal"}, "anual": {"ciclo": "YEARLY", "rotulo": "Anual"}}


def _reais(v: Decimal) -> float:
    return float(v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def planejar(catalogo: dict[str, dict]) -> list[dict]:
    """Links que devem existir agora, a partir do catálogo de planos (ativos e com preço)."""
    from lib.planos import _preco
    from lib.segmentos import SEGMENTOS

    itens = []
    ordenados = sorted(catalogo.items(), key=lambda kv: (kv[1].get("segmento") or "imobiliaria", kv[1].get("ordem") or 99, kv[0]))
    for chave, p in ordenados:
        if not p.get("ativo", True):
            continue
        seg = p.get("segmento") or "imobiliaria"
        for periodo, info_p in PERIODOS.items():
            tabela = Decimal(str(_preco(p, periodo)))
            if tabela <= 0:
                continue
            for forma, info_f in FORMAS.items():
                valor = _reais(tabela * info_f["fator"])
                seg_nome = (SEGMENTOS.get(seg) or {}).get("nome", seg)
                itens.append({
                    "_id": f"{chave}:{periodo}:{forma}", "plano": chave, "plano_nome": p.get("nome") or chave, "segmento": seg,
                    "segmento_nome": seg_nome, "periodo": periodo, "forma": forma, "valor": valor, "valor_tabela": _reais(tabela),
                    "nome": f"SAX CRM {seg_nome} {p.get('nome') or chave} {info_p['rotulo']} ({info_f['rotulo']})"[:120],
                })
    return itens


def _corpo(item: dict) -> dict:
    periodo = "mês" if item["periodo"] == "mensal" else "ano"
    forma = ("Pagamento no Pix com 10% de desconto. A cada " + periodo + " você recebe uma nova cobrança Pix."
             if item["forma"] == "pix" else "Pagamento no cartão de crédito, renovado automaticamente a cada " + periodo + ".")
    return {
        "name": item["nome"], "billingType": FORMAS[item["forma"]]["billing"], "chargeType": "RECURRENT",
        "subscriptionCycle": PERIODOS[item["periodo"]]["ciclo"], "value": item["valor"], "dueDateLimitDays": 3,
        "description": (f"Assinatura do SAX CRM, plano {item['plano_nome']} para {item['segmento_nome']}. {forma} "
                        "Depois do pagamento, nossa equipe libera o seu acesso.")[:500],
        "externalReference": f"sax-plano:{item['_id']}", "notificationEnabled": True, "isAddressRequired": False,
    }


def _pendentes(plano: list[dict], salvos: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    """(criar ou trocar, remover)."""
    criar = [i for i in plano if not ((s := salvos.get(i["_id"])) and s.get("asaas_id") and s.get("ativo") and s.get("valor") == i["valor"])]
    ids = {i["_id"] for i in plano}
    remover = [s for k, s in salvos.items() if k not in ids and s.get("ativo") and s.get("asaas_id")]
    return criar, remover


async def _salvos() -> dict[str, dict]:
    return {d["_id"]: d for d in await controle[COLECAO].find({}).to_list(1000)}


async def _catalogo() -> dict[str, dict]:
    from lib.planos import _catalogo_ou_padrao, carregar_catalogo

    await carregar_catalogo()
    return _catalogo_ou_padrao()


def _saida(plano: list[dict], salvos: dict[str, dict]) -> dict:
    criar, remover = _pendentes(plano, salvos)
    linhas = []
    for i in plano:
        s = salvos.get(i["_id"]) or {}
        ok = bool(s.get("ativo") and s.get("valor") == i["valor"] and s.get("url"))
        linhas.append({**{k: i[k] for k in ("_id", "plano", "plano_nome", "segmento", "segmento_nome", "periodo", "forma", "valor", "valor_tabela")},
                       "url": s.get("url") if ok else None, "erro": s.get("erro") if not ok else None})
    for linha in linhas:
        linha["chave"] = linha.pop("_id")
    return {"links": linhas, "pendentes": len(criar) + len(remover), "total": len(plano),
            "prontos": sum(1 for x in linhas if x["url"])}


async def painel() -> dict:
    return _saida(planejar(await _catalogo()), await _salvos())


async def _travar() -> str:
    token = now_utc().isoformat()
    try:
        await controle.travas_plataforma.insert_one({"_id": "links_pagamento", "token": token, "ate": now_utc() + timedelta(minutes=3)})
        return token
    except DuplicateKeyError:
        atual = await controle.travas_plataforma.find_one({"_id": "links_pagamento"}) or {}
        if atual.get("ate") and utc_aware(atual["ate"]) > utc_aware(now_utc()):
            raise HTTPException(409, "Os links já estão sendo gerados. Aguarde alguns segundos e atualize a lista.")
        r = await controle.travas_plataforma.update_one({"_id": "links_pagamento", "token": atual.get("token")},
                                                         {"$set": {"token": token, "ate": now_utc() + timedelta(minutes=3)}})
        if r.modified_count != 1:
            raise HTTPException(409, "Os links já estão sendo gerados. Aguarde alguns segundos e atualize a lista.")
        return token


async def _destravar(token: str) -> None:
    await controle.travas_plataforma.delete_one({"_id": "links_pagamento", "token": token})


async def _criar(item: dict, anterior: dict | None) -> None:
    try:
        r = await asaas._chamar("POST", "/paymentLinks", _corpo(item))
    except asaas.ErroAsaas as e:
        if e.status in (503, 504):
            raise
        await controle[COLECAO].update_one({"_id": item["_id"]}, {"$set": {**item, "erro": e.mensagem, "atualizado_em": now_utc()}}, upsert=True)
        return
    if anterior and anterior.get("asaas_id") and anterior.get("ativo"):
        await _remover_no_asaas(anterior["asaas_id"])
    await controle[COLECAO].update_one({"_id": item["_id"]}, {"$set": {
        **item, "asaas_id": r.get("id"), "url": r.get("url"), "ativo": True, "erro": None, "atualizado_em": now_utc()}}, upsert=True)


async def _remover_no_asaas(asaas_id: str) -> None:
    try:
        await asaas._chamar("DELETE", f"/paymentLinks/{asaas_id}")
    except asaas.ErroAsaas:
        pass  # já removido no Asaas: segue


async def sincronizar() -> dict:
    """Processa um lote. A tela chama de novo enquanto houver pendentes."""
    cfg = await asaas.config()
    if not cfg["chave"]:
        raise HTTPException(503, "Configure a chave do Asaas em Pagamentos antes de gerar os links.")
    token = await _travar()
    try:
        plano = planejar(await _catalogo())
        salvos = await _salvos()
        criar, remover = _pendentes(plano, salvos)
        # Itens que já deram erro de validação vão por último, para não travar o lote.
        criar.sort(key=lambda i: bool((salvos.get(i["_id"]) or {}).get("erro")))
        lote_criar = criar[:LOTE]
        lote_remover = remover[: max(0, LOTE - len(lote_criar))]
        sem = asyncio.Semaphore(4)

        async def um(item):
            async with sem:
                await _criar(item, salvos.get(item["_id"]))

        try:
            await asyncio.gather(*(um(i) for i in lote_criar))
        except asaas.ErroAsaas as e:
            raise asaas.http(e)
        for s in lote_remover:
            await _remover_no_asaas(s["asaas_id"])
            await controle[COLECAO].update_one({"_id": s["_id"]}, {"$set": {"ativo": False, "url": None, "atualizado_em": now_utc()}})
        resultado = _saida(plano, await _salvos())
        # Só erros de validação sobrando: não adianta repetir sem mudar algo.
        resultado["parar"] = resultado["pendentes"] > 0 and all(x["erro"] for x in resultado["links"] if not x["url"])
        return resultado
    finally:
        await _destravar(token)
