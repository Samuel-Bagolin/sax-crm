"""Campanhas de WhatsApp: público filtrado, mensagem com variáveis e envio com limite seguro (lib/wa_campanhas.py).

Só o gestor (whatsapp:gerir) cria, inicia, pausa e vê. Todos os segmentos.
"""

from __future__ import annotations

import hmac
import secrets
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from lib import wa_campanhas as camp
from lib.auth import Principal
from lib.db import controle, db
from models.common import new_id, now_utc
from routers.whatsapp import _gerir, _iso

router = APIRouter(prefix="/whatsapp/campanhas", tags=["whatsapp"])
publico_router = APIRouter(prefix="/publico/whatsapp", tags=["publico"])

DOC_DISPARADOR = "wa_disparador"


class PublicoIn(BaseModel):
    origem: Literal["clientes", "negocios"] = "clientes"
    aniversario: Literal["hoje", "semana", "mes"] | None = None
    sem_atendimento_dias: int | None = Field(default=None, ge=7, le=1095)
    funil_id: str | None = Field(default=None, max_length=60)
    etapa_ids: List[str] = Field(default_factory=list, max_length=30)
    status: Literal["aberto", "ganho", "perdido"] | None = None
    temperaturas: List[Literal["quente", "morno", "frio"]] = Field(default_factory=list)
    etiquetas: List[str] = Field(default_factory=list, max_length=30)
    ja_conversou: bool = True


class CampanhaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    conexao_id: str = Field(min_length=1, max_length=60)
    mensagem: str = Field(min_length=5, max_length=1000)
    publico: PublicoIn = Field(default_factory=PublicoIn)
    intervalo_min: int = Field(default=40, ge=20, le=600)
    intervalo_max: int = Field(default=90, ge=20, le=900)
    teto_diario: int = Field(default=60, ge=1, le=300)
    hora_inicio: str = Field(default="09:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    hora_fim: str = Field(default="19:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    domingo: bool = False
    formulario_id: str | None = Field(default=None, max_length=60)

    @model_validator(mode="after")
    def _coerente(self):
        if self.intervalo_max < self.intervalo_min:
            raise ValueError("O intervalo máximo precisa ser maior ou igual ao mínimo")
        if self.hora_fim <= self.hora_inicio:
            raise ValueError("O horário final precisa ser depois do inicial")
        return self


def _saida(c: dict, hoje: dict[str, int] | None = None) -> dict:
    total = int(c.get("total") or 0)
    return {"id": c["id"], "nome": c.get("nome"), "status": c.get("status"), "conexao_id": c.get("conexao_id"), "conexao_nome": c.get("conexao_nome"),
            "mensagem": c.get("mensagem"), "publico": c.get("publico") or {}, "total": total, "enviados": int(c.get("enviados") or 0),
            "falhas": int(c.get("falhas") or 0), "pulados": int(c.get("pulados") or 0), "cursor": int(c.get("cursor") or 0),
            "intervalo_min": c.get("intervalo_min"), "intervalo_max": c.get("intervalo_max"), "teto_diario": c.get("teto_diario"),
            "formulario_id": c.get("formulario_id"), "hora_inicio": c.get("hora_inicio"), "hora_fim": c.get("hora_fim"), "domingo": bool(c.get("domingo")),
            "motivo_pausa": c.get("motivo_pausa"), "proximo_em": _iso(c.get("proximo_em")), "criado_em": _iso(c.get("criado_em")),
            "criado_por": c.get("criado_por"), "concluida_em": _iso(c.get("concluida_em")),
            "enviados_hoje_no_numero": (hoje or {}).get(c.get("conexao_id") or "", 0)}


async def _campanha(campanha_id: str) -> dict:
    c = await db.wa_campanhas.find_one({"id": campanha_id})
    if not c:
        raise HTTPException(404, "Campanha não encontrada")
    return c


@router.get("")
async def listar(principal: Principal = Depends(_gerir)):
    docs = await db.wa_campanhas.find({}).sort("criado_em", -1).to_list(100)
    hoje = {cid: await camp.enviados_hoje(cid) for cid in {d.get("conexao_id") for d in docs if d.get("status") == "enviando"} if cid}
    sairam = await db.wa_optout.count_documents({})
    return {"campanhas": [_saida(d, hoje) for d in docs], "sairam": sairam}


@router.post("/previa")
async def previa(input: PublicoIn, principal: Principal = Depends(_gerir)):
    r = await camp.montar_publico(input.model_dump())
    d = r["destinatarios"]
    return {"total": len(d), "sem_telefone": r["sem_telefone"], "sairam": r["sairam"], "sem_conversa": r["sem_conversa"],
            "amostra": [x["nome"] for x in d[:8]]}


@router.post("", status_code=201)
async def criar(input: CampanhaIn, principal: Principal = Depends(_gerir)):
    conexao = await db.wa_conexoes.find_one({"id": input.conexao_id})
    if not conexao:
        raise HTTPException(422, "Escolha um número conectado")
    if input.formulario_id and not await db.formularios.find_one({"id": input.formulario_id, "ativo": True}, {"id": 1}):
        raise HTTPException(422, "Escolha uma pesquisa ativa")
    r = await camp.montar_publico(input.publico.model_dump())
    destinos = r["destinatarios"]
    if not destinos:
        raise HTTPException(422, "Nenhum contato nesse público. Mude os filtros ou desmarque \"só quem já conversou\".")
    if len(destinos) > 5000:
        raise HTTPException(422, "Público grande demais para uma campanha (máximo 5.000). Divida com filtros.")
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1}) or {}
    cid = new_id()
    for i, x in enumerate(destinos, start=1):
        await db.wa_campanha_envios.insert_one({"_id": f"{cid}|{i:05d}", "campanha_id": cid, "ordem": i, "status": "pendente", **x})
    doc = {"_id": cid, "id": cid, **input.model_dump(), "conexao_nome": conexao.get("nome"), "status": "rascunho", "total": len(destinos),
           "cursor": 0, "enviados": 0, "falhas": 0, "pulados": 0, "empresa_nome": cfg.get("nome_software") or "",
           "criado_em": now_utc(), "criado_por": principal.nome}
    await db.wa_campanhas.insert_one(doc)
    return _saida(doc)


@router.post("/{campanha_id}/iniciar")
async def iniciar(campanha_id: str, principal: Principal = Depends(_gerir)):
    c = await _campanha(campanha_id)
    if c.get("status") not in ("rascunho", "pausada"):
        raise HTTPException(409, "Esta campanha não pode ser iniciada agora")
    conexao = await db.wa_conexoes.find_one({"id": c.get("conexao_id")})
    if not conexao or conexao.get("status") != "conectado":
        raise HTTPException(409, "O número da campanha está desconectado. Leia o QR code e tente de novo.")
    mudar = {"status": "enviando", "motivo_pausa": None, "falhas_seguidas": 0, "proximo_em": now_utc()}
    await db.wa_campanhas.update_one({"id": campanha_id, "status": c["status"]}, {"$set": mudar})
    c = {**c, **mudar}
    await camp.marcar_ativa(c)
    return _saida(c)


@router.post("/{campanha_id}/pausar")
async def pausar(campanha_id: str, principal: Principal = Depends(_gerir)):
    c = await _campanha(campanha_id)
    if c.get("status") != "enviando":
        raise HTTPException(409, "A campanha não está enviando")
    mudar = {"status": "pausada", "motivo_pausa": f"Pausada por {principal.nome}"}
    await db.wa_campanhas.update_one({"id": campanha_id}, {"$set": mudar})
    await camp.marcar_ativa({**c, **mudar})
    return _saida({**c, **mudar})


@router.post("/{campanha_id}/cancelar")
async def cancelar(campanha_id: str, principal: Principal = Depends(_gerir)):
    c = await _campanha(campanha_id)
    if c.get("status") in ("concluida", "cancelada"):
        raise HTTPException(409, "A campanha já terminou")
    mudar = {"status": "cancelada", "motivo_pausa": None, "concluida_em": now_utc()}
    await db.wa_campanhas.update_one({"id": campanha_id}, {"$set": mudar})
    await camp.marcar_ativa({**c, **mudar})
    return _saida({**c, **mudar})


@router.get("/{campanha_id}/envios")
async def envios(campanha_id: str, principal: Principal = Depends(_gerir)):
    await _campanha(campanha_id)
    docs = await db.wa_campanha_envios.find({"campanha_id": campanha_id}).sort("ordem", 1).to_list(5000)
    return [{"ordem": d.get("ordem"), "nome": d.get("nome"), "telefone": d.get("telefone"), "status": d.get("status"), "erro": d.get("erro"),
             "em": _iso(d.get("em"))} for d in docs]


@router.post("/processar")
async def processar(principal: Principal = Depends(_gerir)):
    """Toque da tela aberta: anda a fila das campanhas desta empresa."""
    enviados = await camp.processar_empresa()
    return {"enviados": enviados}


@router.get("/saidas")
async def saidas(principal: Principal = Depends(_gerir)):
    docs = await db.wa_optout.find({}).sort("em", -1).to_list(2000)
    return [{"id": d["_id"], "nome": d.get("nome"), "telefone": d.get("telefone"), "em": _iso(d.get("em"))} for d in docs]


@router.delete("/saidas/{chave}", status_code=204)
async def readmitir(chave: str, principal: Principal = Depends(_gerir)):
    """Só quando o próprio contato pedir para voltar a receber."""
    await db.wa_optout.delete_one({"_id": chave})


# ------------------------------------------------------------------ disparador externo


async def token_disparador(criar: bool = True) -> str | None:
    d = await controle.plataforma.find_one({"_id": DOC_DISPARADOR})
    if d and d.get("token"):
        return d["token"]
    if not criar:
        return None
    token = secrets.token_urlsafe(24)
    await controle.plataforma.update_one({"_id": DOC_DISPARADOR}, {"$set": {"token": token, "criado_em": now_utc()}}, upsert=True)
    return token


@publico_router.get("/disparar/{token}")
async def disparar(token: str, request: Request):
    """Chamado por um agendador externo de 1 em 1 minuto (o Vercel Hobby só tem cron diário)."""
    certo = await token_disparador(criar=False)
    if not certo or not hmac.compare_digest(token, certo):
        raise HTTPException(404, "Não encontrado")
    return {"enviados": await camp.processar_todas(40)}
