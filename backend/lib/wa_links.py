"""Links que o fluxo do WhatsApp manda: agenda online (da empresa ou de um profissional), catálogo do site,
um item (imóvel, veículo, produto ou serviço) ou um endereço livre.

Os endereços são montados na hora do envio, a partir da configuração atual (mudou o endereço da agenda ou
do site, o fluxo acompanha). Nada aqui grava dado.
"""

from __future__ import annotations

import re
import unicodedata

from lib.db import db

TIPOS_LINK = ("agenda", "agenda_profissional", "agenda_citado", "catalogo", "item", "url")


def _base() -> str:
    import os

    return os.environ.get("APP_URL", "").rstrip("/")


def _norm(t: str | None) -> str:
    t = unicodedata.normalize("NFD", (t or "").lower())
    return " ".join("".join(c for c in t if unicodedata.category(c) != "Mn").split())


async def agenda_slug() -> str | None:
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"agenda_online": 1}) or {}
    a = cfg.get("agenda_online") or {}
    return a.get("slug") if a.get("ativo") and a.get("slug") else None


async def profissionais() -> list[dict]:
    """Quem atende e aparece na agenda online, com o endereço da agenda de cada um."""
    docs = await db.usuarios.find({"ativo": {"$ne": False}, "papel": {"$ne": "sysadmin"}},
                                  {"id": 1, "nome": 1, "atende": 1, "agenda_online": 1, "agenda_slug": 1, "pessoa_id": 1}).to_list(300)
    return sorted((u for u in docs if u.get("atende") and u.get("agenda_online", True)), key=lambda u: u.get("nome") or "")


def url_agenda(slug: str, prof_slug: str | None = None) -> str:
    return f"{_base()}/agendar/{slug}" + (f"/{prof_slug}" if prof_slug else "")


def citado(texto: str, profs: list[dict]) -> dict | None:
    """O profissional citado na mensagem pelo nome completo ou pelo primeiro nome (palavra inteira).
    Primeiro nome repetido na equipe só vale com o nome completo."""
    t = f" {_norm(re.sub(r'[^\w\s]', ' ', texto or ''))} "
    for p in profs:
        nome = _norm(p.get("nome"))
        if nome and len(nome) >= 3 and f" {nome} " in t:
            return p
    primeiros: dict[str, list[dict]] = {}
    for p in profs:
        primeiro = _norm(p.get("nome")).split(" ")[0] if p.get("nome") else ""
        if len(primeiro) >= 3:
            primeiros.setdefault(primeiro, []).append(p)
    for primeiro, lista in primeiros.items():
        if len(lista) == 1 and f" {primeiro} " in t:
            return lista[0]
    return None


async def _site() -> str | None:
    from routers.site_imobiliaria import carregar_config

    config, configurado = await carregar_config()
    return config.slug if configurado and config.slug and config.ativo else None


async def item(item_id: str | None) -> dict | None:
    """Imóvel, veículo ou item do catálogo do site, com nome, preço e endereço."""
    if not item_id:
        return None
    slug = await _site()
    for colecao, rotulo in (("imoveis", "imovel"), ("veiculos", "veiculo")):
        d = await db[colecao].find_one({"id": item_id}, {"id": 1, "titulo": 1, "codigo": 1, "valor_venda": 1, "valor_aluguel": 1,
                                                        "preco_venda": 1, "marca": 1, "modelo": 1, "ano_modelo": 1})
        if d:
            nome = d.get("titulo") or " ".join(str(d.get(k) or "") for k in ("marca", "modelo", "ano_modelo")).strip() or d.get("codigo")
            preco = d.get("valor_venda") or d.get("valor_aluguel") or d.get("preco_venda")
            url = f"{_base()}/s/{slug}/imovel/{d.get('codigo')}" if slug and d.get("codigo") else None
            return {"id": d["id"], "nome": nome, "preco": preco, "url": url, "tipo": rotulo}
    d = await db.site_itens.find_one({"id": item_id}, {"id": 1, "nome": 1, "preco": 1, "tipo": 1})
    if d:
        return {"id": d["id"], "nome": d.get("nome"), "preco": d.get("preco"), "url": f"{_base()}/s/{slug}#catalogo" if slug else None,
                "tipo": d.get("tipo") or "produto"}
    return None


def _brl(v) -> str:
    try:
        return f"R$ {float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return ""


async def montar(passo: dict, texto_cliente: str = "") -> tuple[str | None, dict]:
    """(url, valores para o texto) do passo de link. url None = não deu para montar agora."""
    tipo = passo.get("link_tipo")
    valores = {"nome": "", "preco": ""}
    if tipo == "url":
        return (passo.get("url") or None), valores
    if tipo in ("catalogo", "item"):
        if tipo == "catalogo":
            slug = await _site()
            return (f"{_base()}/s/{slug}#catalogo" if slug else None), valores
        it = await item(passo.get("destino_id"))
        if not it:
            return None, valores
        valores.update(nome=it["nome"] or "", preco=_brl(it["preco"]) if it.get("preco") else "")
        return it["url"], valores
    slug = await agenda_slug()
    if not slug:
        return None, valores
    prof = None
    if tipo == "agenda_profissional":
        prof = next((p for p in await profissionais() if p["id"] == passo.get("destino_id")), None)
    elif tipo == "agenda_citado":
        prof = citado(texto_cliente, await profissionais())
    if prof:
        valores["nome"] = prof.get("nome") or ""
    return url_agenda(slug, (prof or {}).get("agenda_slug")), valores


def texto_com_link(texto: str, url: str | None, valores: dict) -> str:
    """Troca {link}, {nome} e {preco}. Sem {link} no texto, o link vai numa linha no fim."""
    t = (texto or "").strip()
    if not valores.get("nome"):
        # ninguém citado: "Agenda do {nome}:" vira "Agenda:" em vez de "Agenda do :"
        t = re.sub(r"\s+(?:d[oa]s?|com\s+[oa]|para\s+[oa]|[oa])\s+\{nome\}", "", t, flags=re.I)
    for chave, v in valores.items():
        t = t.replace("{" + chave + "}", v or "")
    if not url:
        return re.sub(r"\{link\}", "", t).strip()
    if "{link}" in t:
        return t.replace("{link}", url)
    return f"{t}\n{url}".strip()


async def opcoes() -> dict:
    """O que a tela do fluxo mostra para escolher: agenda, profissionais, catálogo e itens."""
    slug = await agenda_slug()
    site = await _site()
    profs = [{"id": p["id"], "nome": p.get("nome"), "url": url_agenda(slug, p.get("agenda_slug")) if slug and p.get("agenda_slug") else None}
             for p in await profissionais()]
    itens = []
    for colecao, tipo in (("imoveis", "Imóvel"), ("veiculos", "Veículo")):
        filtro = {"status": {"$in": ["publicado", "captado", "disponivel", "reservado"]}}
        async for d in db[colecao].find(filtro, {"id": 1, "titulo": 1, "codigo": 1, "marca": 1, "modelo": 1, "ano_modelo": 1}).limit(300):
            nome = d.get("titulo") or " ".join(str(d.get(k) or "") for k in ("marca", "modelo", "ano_modelo")).strip()
            itens.append({"id": d["id"], "nome": f"{d.get('codigo') or ''} {nome}".strip(), "tipo": tipo})
    async for d in db.site_itens.find({"ativo": {"$ne": False}}, {"id": 1, "nome": 1, "tipo": 1}).limit(300):
        itens.append({"id": d["id"], "nome": d.get("nome"), "tipo": {"produto": "Produto", "servico": "Serviço", "tratamento": "Tratamento"}.get(d.get("tipo") or "", "Item")})
    return {"agenda": url_agenda(slug) if slug else None, "profissionais": profs,
            "catalogo": f"{_base()}/s/{site}#catalogo" if site else None, "itens": itens}
