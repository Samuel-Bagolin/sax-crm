"""Temperatura do lead e do negócio: quente, morno ou frio.

Vem escolhida na tela ou, se ficar em branco, sai da origem pelas regras do CRM (`crm.regras_temperatura`,
ex.: "Google Maps" -> frio). Com `crm.ordenar_por_temperatura`, o quadro e as listas mostram quente em cima,
morno no meio e frio no fim (sem temperatura vem por último).
"""

from __future__ import annotations

import unicodedata

TEMPERATURAS = ("quente", "morno", "frio")
ORDEM = {"quente": 0, "morno": 1, "frio": 2}
ROTULO = {"quente": "Quente", "morno": "Morno", "frio": "Frio"}


def _norm(t: str | None) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (t or "").lower()) if unicodedata.category(c) != "Mn").strip()


def normalizar(valor: str | None) -> str | None:
    """Aceita "Quente", "QUENTE", "frio " etc. Qualquer outra coisa vira None."""
    v = _norm(valor)
    return v if v in TEMPERATURAS else None


def pela_origem(origem: str | None, regras: list) -> str | None:
    """Primeiro a regra igual à origem; depois a primeira cuja palavra aparece na origem."""
    o = _norm(origem)
    if not o:
        return None
    itens = [(_norm(r.get("origem") if isinstance(r, dict) else r.origem), r.get("temperatura") if isinstance(r, dict) else r.temperatura)
             for r in regras or []]
    for chave, temp in itens:
        if chave and chave == o:
            return temp
    for chave, temp in itens:
        if chave and chave in o:
            return temp
    return None


async def definir(data: dict) -> None:
    """Preenche `temperatura` pela origem quando veio vazia (criar lead ou negócio)."""
    data["temperatura"] = normalizar(data.get("temperatura"))
    if data["temperatura"]:
        return
    from lib.crm import carregar_crm_config

    data["temperatura"] = pela_origem(data.get("origem"), (await carregar_crm_config()).regras_temperatura)


def chave_ordem(temp: str | None) -> int:
    return ORDEM.get(temp or "", 3)


async def da_origem(origem: str | None) -> str | None:
    from lib.crm import carregar_crm_config

    return pela_origem(origem, (await carregar_crm_config()).regras_temperatura)


async def ordenar(docs: list, campo: str = "temperatura") -> list:
    """Quente em cima, morno no meio, frio no fim, quando a empresa liga a opção (ordem estável)."""
    from lib.crm import carregar_crm_config

    if not (await carregar_crm_config()).ordenar_por_temperatura:
        return docs
    pega = (lambda d: d.get(campo)) if docs and isinstance(docs[0], dict) else (lambda d: getattr(d, campo, None))
    return sorted(docs, key=lambda d: chave_ordem(pega(d)))
