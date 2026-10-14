"""Praças e supervisões (lógica do CRM Revendas & Eventos do O Pudim Perfeito).

- Praça = cidade de atuação (Curitiba, São Paulo, Brasília). Uma praça pode ser dividida em supervisões
  (ex.: CWB Norte e CWB Sul), cada uma com os seus pixels de campanha.
- Perfis da equipe (`usuarios.perfil`): diretoria e gerentes são gestores (veem tudo); `supervisor` vê o que é
  dele, os negócios das supervisões dele, os dos líderes que acompanha e os da praça que ainda não têm
  supervisão (o lead não se perde); sem supervisão escolhida, vê a praça inteira; `lider` vê só os próprios cards.
- Negócio, lead e atividade guardam `praca`, `supervisao_id` e `unidade_id` (loja).
- Pixel do lead -> supervisão -> praça (`rotear`); sem pixel, a praça vem da localidade.
"""

from __future__ import annotations

import unicodedata

from lib.db import db

PERFIS = {
    "diretoria": ("admin", "Diretoria"),
    "gerente_op": ("admin", "Gerente de Operações"),
    "gerente_exp": ("admin", "Gerente de Expansão"),
    "supervisor": ("corretor", "Supervisor de Lojas"),
    "lider": ("corretor", "Líder de Loja"),
}
TODAS = "TODAS"


def chave(t: str | None) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn").upper().strip()


APELIDOS = {"SP": "SAO PAULO", "SAMPA": "SAO PAULO", "CWB": "CURITIBA", "BSB": "BRASILIA", "DF": "BRASILIA"}


async def pracas() -> list[str]:
    """Praças da empresa: cidades das lojas e das supervisões."""
    nomes = {u.get("cidade") for u in await db.unidades.find({}, {"cidade": 1}).to_list(500) if u.get("cidade")}
    nomes |= {s.get("praca") for s in await db.supervisoes.find({}, {"praca": 1}).to_list(200) if s.get("praca")}
    return sorted(nomes)


async def praca_de(texto: str | None) -> str | None:
    k = chave(texto)
    k = APELIDOS.get(k, k)
    for p in await pracas():
        if chave(p) == k or (k and chave(p).startswith(k)):
            return p
    return None


async def rotear(pixel: str | None, localidade: str | None) -> tuple[str | None, str | None]:
    """(praça, supervisao_id) do lead: o pixel manda (aceita também o nome da supervisão); senão a localidade."""
    p = chave(pixel)
    if p:
        for s in await db.supervisoes.find({}).to_list(200):
            if s.get("ativa", True) and (p == chave(s.get("nome")) or p in {chave(x) for x in s.get("pixels") or []}):
                return s.get("praca"), s["id"]
    return await praca_de(localidade), None


async def escopo_do_supervisor(doc: dict) -> dict:
    sups = [s for s in (doc.get("supervisoes") or []) if s]
    pracas_doc = [p for p in (doc.get("pracas") or []) if p and p != TODAS]
    praca_toda = not sups
    if sups:
        pracas_doc = sorted({s.get("praca") for s in await db.supervisoes.find({"id": {"$in": sups[:30]}}).to_list(30) if s.get("praca")}
                            | set(pracas_doc))
    elif TODAS in (doc.get("pracas") or []):
        pracas_doc = await pracas()
    equipe = []
    for u in await db.usuarios.find({"papel": "corretor", "ativo": True}, {"id": 1, "pessoa_id": 1, "supervisoes": 1, "pracas": 1, "perfil": 1}).to_list(1000):
        if u.get("id") == doc.get("id") or not u.get("pessoa_id") or u.get("perfil") == "supervisor":
            continue
        if set(u.get("supervisoes") or []) & set(sups) or (praca_toda and set(u.get("pracas") or []) & set(pracas_doc)):
            equipe.append(u["pessoa_id"])
    return {"escopo_supervisoes": sups, "escopo_pracas": pracas_doc, "escopo_praca_toda": praca_toda, "escopo_equipe": equipe}


def descricao_atuacao(u: dict, sups: dict[str, str], lojas: dict[str, str]) -> str:
    perfil = u.get("perfil")
    if perfil in ("diretoria",):
        return "Tudo"
    partes = []
    if u.get("unidade_id") and lojas.get(u["unidade_id"]):
        partes.append(lojas[u["unidade_id"]])
    nomes = [sups[s] for s in u.get("supervisoes") or [] if s in sups]
    partes += nomes
    if not nomes:
        pr = u.get("pracas") or []
        partes.append("Todas as praças" if TODAS in pr else (", ".join(pr) + (" (praça toda)" if perfil == "supervisor" else "") if pr else ""))
    return " · ".join(p for p in partes if p)
