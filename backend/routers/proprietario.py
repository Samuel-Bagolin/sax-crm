"""Relatório do proprietário por link.

O proprietário acompanha, sem login, o trabalho feito no imóvel dele: visitas (com o retorno que o
corretor escreveu para ele), interessados, vitrines enviadas, propostas recebidas e publicação em
portais. Nunca mostra nome, telefone ou e-mail dos clientes interessados.
"""

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib import links
from lib.auth import Principal, require
from lib.dates import today_iso
from lib.db import db
from lib.match import pontuar
from lib.planos import exigir_recurso, recurso_liberado
from models.common import now_utc, utc_aware

router = APIRouter(prefix="/imoveis", tags=["proprietario"])


def _tz():
    import os
    from zoneinfo import ZoneInfo
    return ZoneInfo(os.environ.get("APP_TZ", "America/Sao_Paulo"))
publico_router = APIRouter(prefix="/publico/proprietario", tags=["publico"])


class LinkRelatorio(BaseModel):
    url: str | None = None
    proprietario_nome: str | None = None
    proprietario_telefone: str | None = None


class VisitaRelatorio(BaseModel):
    data: str
    status: str
    retorno: str | None = None


class PropostaRelatorio(BaseModel):
    data: str
    valor: float
    situacao: str
    autor: str


class RelatorioProprietario(BaseModel):
    empresa_nome: str
    cor_primaria: str
    tem_logo: bool
    proprietario_nome: str | None = None
    codigo: str
    titulo: str
    bairro: str | None = None
    cidade: str
    finalidade: str
    status: str
    valor: float | None = None
    foto_url: str | None = None
    dias_no_mercado: int
    visitas_realizadas: int
    visitas_agendadas: int
    interessados: int
    vitrines: int
    reacoes_positivas: int
    publicado_portais: bool
    propostas: List[PropostaRelatorio]
    visitas: List[VisitaRelatorio]
    corretor_nome: str | None = None
    corretor_telefone: str | None = None
    gerado_em: str


async def _imovel(imovel_id: str) -> dict:
    im = await db.imoveis.find_one({"id": imovel_id})
    if not im:
        raise HTTPException(404, "Imóvel não encontrado")
    return im


async def _link(im: dict) -> LinkRelatorio:
    dono = await db.pessoas.find_one({"id": im.get("proprietario_id")}, {"nome": 1, "telefone": 1}) if im.get("proprietario_id") else None
    token = im.get("relatorio_token")
    ativo = token and await links.existe("proprietario", im["id"])
    return LinkRelatorio(url=f"/proprietario/{token}" if ativo else None, proprietario_nome=(dono or {}).get("nome"),
                         proprietario_telefone=(dono or {}).get("telefone"))


@router.get("/{imovel_id}/relatorio-proprietario", response_model=LinkRelatorio)
async def ver_link(imovel_id: str, principal: Principal = Depends(require("proprietario:link"))):
    return await _link(await _imovel(imovel_id))


@router.post("/{imovel_id}/relatorio-proprietario", response_model=LinkRelatorio)
async def criar_link(imovel_id: str, novo: bool = False, principal: Principal = Depends(require("proprietario:link"))):
    await exigir_recurso("proprietario")
    im = await _imovel(imovel_id)
    if not novo and im.get("relatorio_token") and await links.existe("proprietario", imovel_id):
        return await _link(im)
    token = await links.criar("proprietario", imovel_id, substituir=True)
    await db.imoveis.update_one({"id": imovel_id}, {"$set": {"relatorio_token": token}})
    return await _link({**im, "relatorio_token": token})


@router.delete("/{imovel_id}/relatorio-proprietario", status_code=204)
async def revogar_link(imovel_id: str, principal: Principal = Depends(require("proprietario:link"))):
    await _imovel(imovel_id)
    await links.revogar("proprietario", imovel_id)
    await db.imoveis.update_one({"id": imovel_id}, {"$unset": {"relatorio_token": ""}})
    return None


@publico_router.get("/{token}", response_model=RelatorioProprietario)
async def relatorio(token: str):
    imovel_id = await links.resolver(token, "proprietario")
    if not await recurso_liberado("proprietario"):
        raise HTTPException(404, "Link indisponível")
    im = await _imovel(imovel_id)
    hoje = today_iso()
    visitas_docs = await db.visitas.find({"imovel_id": imovel_id, "status": {"$ne": "cancelada"}}).sort([("data", -1), ("hora", -1)]).to_list(200)
    realizadas = [v for v in visitas_docs if v.get("status") == "realizada" or (v.get("status") == "agendada" and v["data"] < hoje)]
    agendadas = [v for v in visitas_docs if v.get("status") == "agendada" and v["data"] >= hoje]

    interessados = {n["id"] async for n in db.leads.find({"status": "aberto", "imovel_id": imovel_id}, {"id": 1})}
    async for n in db.leads.find({"status": "aberto", "perfil_busca": {"$ne": None}}, {"id": 1, "perfil_busca": 1}):
        nota = pontuar(n["perfil_busca"], im)
        if nota and nota["score"] >= 60:
            interessados.add(n["id"])
    vitrines = await db.vitrines.find({"imovel_ids": imovel_id}, {"reacoes": 1}).to_list(500)
    positivas = sum(1 for v in vitrines for r in v.get("reacoes", []) if r["imovel_id"] == imovel_id and r["reacao"] in ("gostei", "quero_visitar"))

    from routers.propostas import STATUS_LABEL, _status

    propostas = [
        PropostaRelatorio(data=utc_aware(p["created_at"]).astimezone(_tz()).date().isoformat(), valor=p["valor"],
                          situacao=STATUS_LABEL.get(_status(p), p["status"]), autor="Comprador" if p["autor"] == "cliente" else "Você (contraproposta)")
        async for p in db.propostas.find({"imovel_id": imovel_id, "status": {"$ne": "cancelada"}}).sort("created_at", -1).limit(30)
    ]
    dono = await db.pessoas.find_one({"id": im.get("proprietario_id")}, {"nome": 1}) if im.get("proprietario_id") else None
    corretor = await db.leads.find_one({"imovel_id": imovel_id, "corretor_id": {"$ne": None}}, {"corretor_id": 1}, sort=[("updated_at", -1)])
    pessoa_corretor = await db.pessoas.find_one({"id": corretor["corretor_id"]}, {"id": 1, "nome": 1, "telefone": 1}) if corretor else None
    usuario = await db.usuarios.find_one({"pessoa_id": pessoa_corretor["id"]}, {"telefone": 1}) if pessoa_corretor else None
    fin = im.get("finalidade")
    valor = im.get("valor_aluguel") if fin == "locacao" else im.get("valor_venda")
    criado = utc_aware(im.get("created_at")) or now_utc()
    return RelatorioProprietario(
        **await links.marca_publica(), proprietario_nome=((dono or {}).get("nome") or "").split(" ")[0] or None,
        codigo=im.get("codigo") or "", titulo=im["titulo"], bairro=im.get("bairro"), cidade=im.get("cidade", ""), finalidade=fin,
        status=im.get("status", "captado"), valor=valor, foto_url=im.get("foto_url"),
        dias_no_mercado=max(0, (now_utc() - criado).days), visitas_realizadas=len(realizadas), visitas_agendadas=len(agendadas),
        interessados=len(interessados), vitrines=len(vitrines), reacoes_positivas=positivas,
        publicado_portais=bool(im.get("publicar_portais")) and await recurso_liberado("portais"),
        propostas=propostas,
        visitas=[VisitaRelatorio(data=v["data"], status="Agendada" if v in agendadas else "Realizada", retorno=v.get("feedback_proprietario"))
                 for v in visitas_docs[:30]],
        corretor_nome=(pessoa_corretor or {}).get("nome"),
        corretor_telefone=(usuario or {}).get("telefone") or (pessoa_corretor or {}).get("telefone"),
        gerado_em=datetime.now(_tz()).isoformat(timespec="minutes"),
    )


@publico_router.get("/{token}/logo")
async def logo(token: str):
    await links.resolver(token, "proprietario")
    from routers.match import logo_empresa
    return await logo_empresa()
