"""Praças e supervisões (lib/supervisoes.py): quem vê o quê na rede de lojas."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib import supervisoes as sv
from lib.auth import Principal, require
from lib.db import db
from models.common import new_id, now_utc

router = APIRouter(prefix="/supervisoes", tags=["supervisoes"])


class SupervisaoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=60)
    praca: str = Field(min_length=2, max_length=60)
    pixels: list[str] = Field(default_factory=list, max_length=50)
    ativa: bool = True


def _gestor(principal: Principal) -> None:
    if not principal.is_admin:
        raise HTTPException(403, "Só a diretoria e os gerentes mexem nas supervisões")


async def _saida(s: dict, contagem: dict[str, int], pessoas: dict[str, list[str]]) -> dict:
    return {"id": s["id"], "nome": s.get("nome"), "praca": s.get("praca"), "pixels": list(s.get("pixels") or []),
            "ativa": s.get("ativa", True), "abertos": contagem.get(s["id"], 0), "equipe": pessoas.get(s["id"], [])}


@router.get("")
async def listar(principal: Principal = Depends(require("funil:read"))):
    docs = await db.supervisoes.find({}).to_list(200)
    contagem: dict[str, int] = {}
    for n in await db.leads.find({"status": "aberto"}, {"supervisao_id": 1}).to_list(20000):
        if n.get("supervisao_id"):
            contagem[n["supervisao_id"]] = contagem.get(n["supervisao_id"], 0) + 1
    pessoas: dict[str, list[str]] = {}
    for u in await db.usuarios.find({"ativo": True}, {"nome": 1, "supervisoes": 1, "perfil": 1}).to_list(1000):
        for s in u.get("supervisoes") or []:
            pessoas.setdefault(s, []).append(f"{u.get('nome')} ({'supervisor' if u.get('perfil') == 'supervisor' else 'líder'})")
    saida = [await _saida(s, contagem, pessoas) for s in docs]
    return {"pracas": await sv.pracas(), "supervisoes": sorted(saida, key=lambda x: (x["praca"] or "", x["nome"] or ""))}


async def _reaplicar_pixels(sup: dict) -> int:
    """Negócios e leads em aberto, sem supervisão, cujo pixel bate com a supervisão passam para ela."""
    pixels = {sv.chave(p) for p in sup.get("pixels") or []} | {sv.chave(sup.get("nome"))}
    n = 0
    for colecao, aberto in ((db.leads, {"status": "aberto"}), (db.entradas, {"status": {"$in": ["novo", "em_contato"]}})):
        for d in await colecao.find(aberto, {"id": 1, "pixel": 1, "supervisao_id": 1}).to_list(20000):
            if not d.get("supervisao_id") and d.get("pixel") and sv.chave(d["pixel"]) in pixels:
                await colecao.update_one({"id": d["id"]}, {"$set": {"supervisao_id": sup["id"], "praca": sup.get("praca")}})
                n += 1
    return n


@router.post("", status_code=201)
async def criar(input: SupervisaoIn, principal: Principal = Depends(require("funil:read"))):
    _gestor(principal)
    if await db.supervisoes.find_one({"nome": input.nome.strip()}):
        raise HTTPException(409, "Já existe uma supervisão com esse nome")
    doc = {"id": new_id(), "nome": input.nome.strip(), "praca": input.praca.strip(), "ativa": input.ativa,
           "pixels": sorted({p.strip() for p in input.pixels if p.strip()}), "created_at": now_utc()}
    await db.supervisoes.insert_one(doc)
    movidos = await _reaplicar_pixels(doc)
    return {**doc, "_id": None, "movidos": movidos}


@router.put("/{sup_id}")
async def editar(sup_id: str, input: SupervisaoIn, principal: Principal = Depends(require("funil:read"))):
    _gestor(principal)
    doc = await db.supervisoes.find_one({"id": sup_id})
    if not doc:
        raise HTTPException(404, "Supervisão não encontrada")
    mudar = {"nome": input.nome.strip(), "praca": input.praca.strip(), "ativa": input.ativa,
             "pixels": sorted({p.strip() for p in input.pixels if p.strip()})}
    await db.supervisoes.update_one({"id": sup_id}, {"$set": mudar})
    doc.update(mudar)
    return {"ok": True, "movidos": await _reaplicar_pixels(doc)}


@router.delete("/{sup_id}", status_code=204)
async def excluir(sup_id: str, principal: Principal = Depends(require("funil:read"))):
    _gestor(principal)
    if await db.leads.find_one({"supervisao_id": sup_id, "status": "aberto"}, {"id": 1}):
        raise HTTPException(409, "Há negócios em aberto nesta supervisão. Mude a supervisão deles ou desative em vez de excluir.")
    await db.supervisoes.delete_one({"id": sup_id})
    for u in await db.usuarios.find({}, {"id": 1, "supervisoes": 1}).to_list(1000):
        if sup_id in (u.get("supervisoes") or []):
            await db.usuarios.update_one({"id": u["id"]}, {"$set": {"supervisoes": [s for s in u["supervisoes"] if s != sup_id]}})


@router.get("/atuacao")
async def atuacao(principal: Principal = Depends(require("funil:read"))):
    """Para as telas: praças, supervisões, lojas e onde cada pessoa da equipe atua."""
    sups = await db.supervisoes.find({}).to_list(200)
    lojas = await db.unidades.find({}, {"id": 1, "nome": 1, "cidade": 1, "supervisao_id": 1, "ativa": 1}).to_list(500)
    nomes_sup = {s["id"]: s.get("nome") for s in sups}
    nomes_loja = {u["id"]: u.get("nome") for u in lojas}
    equipe = []
    for u in await db.usuarios.find({"ativo": True}).to_list(1000):
        if not u.get("pessoa_id"):
            continue
        equipe.append({"pessoa_id": u["pessoa_id"], "nome": u.get("nome"), "perfil": u.get("perfil"),
                       "supervisoes": u.get("supervisoes") or [], "pracas": u.get("pracas") or [], "unidade_id": u.get("unidade_id"),
                       "atua_em": sv.descricao_atuacao(u, nomes_sup, nomes_loja)})
    return {"pracas": await sv.pracas(), "supervisoes": [{"id": s["id"], "nome": s.get("nome"), "praca": s.get("praca"), "ativa": s.get("ativa", True)} for s in sups],
            "lojas": [{"id": u["id"], "nome": u.get("nome"), "praca": u.get("cidade"), "supervisao_id": u.get("supervisao_id")} for u in lojas if u.get("ativa", True)],
            "equipe": equipe, "eu": {"supervisoes": principal.escopo_supervisoes, "pracas": principal.escopo_pracas, "equipe": principal.escopo_equipe}}
