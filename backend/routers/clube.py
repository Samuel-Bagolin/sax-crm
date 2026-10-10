"""Clube de assinantes (barbearia): o cliente paga um valor fixo por mês e corta quantas vezes quiser
(ou até um limite). O painel mostra quantas vezes cada assinante vem, quanto ele consumiria pela tabela
e se o plano está dando lucro, além de quem parou de vir (risco de cancelar).

- Planos do clube: nome, valor mensal, serviços incluídos e limite de usos no mês (vazio = ilimitado).
- Assinante: cliente + plano + dia de vencimento. Pausar e cancelar guardam a data.
- Mensalidades: um clique lança a receita do mês de cada assinante ativo no Financeiro. Não duplica:
  cada mensalidade tem um id fixo (assinante + mês) e a gravação falha se já existir.
- Atendimento de assinante concluído com serviço incluído entra no caixa como "assinatura" (valor zero),
  e conta como uso do plano.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.agenda_online import agora_local
from lib.auth import Principal, require
from lib.db import db
from models.common import new_id, now_utc

router = APIRouter(prefix="/clube", tags=["clube"])


class PlanoClubeIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    valor_mensal: float = Field(gt=0, le=100_000)
    servico_ids: List[str] = Field(default_factory=list, max_length=30)
    limite_mes: int | None = Field(default=None, ge=1, le=100)  # vazio = ilimitado
    descricao: str | None = Field(default=None, max_length=300)
    ativo: bool = True


class AssinanteIn(BaseModel):
    cliente_id: str
    plano_id: str
    dia_vencimento: int = Field(default=10, ge=1, le=28)
    inicio: str | None = None


class AssinanteUpdate(BaseModel):
    plano_id: str | None = None
    dia_vencimento: int | None = Field(default=None, ge=1, le=28)
    status: Literal["ativo", "pausado", "cancelado"] | None = None


def _limpo(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "_id"}


def _mes(ref: str | None) -> tuple[date, date]:
    hoje = agora_local().date()
    try:
        ini = date.fromisoformat(f"{ref}-01") if ref else hoje.replace(day=1)
    except ValueError:
        raise HTTPException(422, "Mês inválido. Use AAAA-MM.")
    fim = (ini.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return ini, fim


# ------------------------------------------------------------------ planos do clube


@router.get("/planos")
async def listar_planos(principal: Principal = Depends(require("agendamento:read"))):
    docs = await db.clube_planos.find({}).to_list(100)
    docs.sort(key=lambda p: (not p.get("ativo", True), p.get("valor_mensal", 0)))
    return [_limpo(p) for p in docs]


@router.post("/planos", status_code=201)
async def criar_plano(input: PlanoClubeIn, principal: Principal = Depends(require("unidade:manage"))):
    doc = {"id": new_id(), **input.model_dump(), "created_at": now_utc()}
    await db.clube_planos.insert_one(doc)
    return _limpo(doc)


@router.put("/planos/{plano_id}")
async def editar_plano(plano_id: str, input: PlanoClubeIn, principal: Principal = Depends(require("unidade:manage"))):
    if not await db.clube_planos.find_one({"id": plano_id}, {"id": 1}):
        raise HTTPException(404, "Plano não encontrado")
    dados = {**input.model_dump(), "updated_at": now_utc()}
    await db.clube_planos.update_one({"id": plano_id}, {"$set": dados})
    # O nome e o valor novos valem para os próximos lançamentos dos assinantes do plano.
    await db.clube_assinantes.update_many({"plano_id": plano_id}, {"$set": {"plano_nome": input.nome, "valor": input.valor_mensal}})
    return _limpo(await db.clube_planos.find_one({"id": plano_id}))


# ------------------------------------------------------------------ assinantes


@router.post("/assinantes", status_code=201)
async def criar_assinante(input: AssinanteIn, principal: Principal = Depends(require("agendamento:write"))):
    plano = await db.clube_planos.find_one({"id": input.plano_id, "ativo": {"$ne": False}})
    if not plano:
        raise HTTPException(422, "Plano do clube não encontrado")
    cliente = await db.pessoas.find_one({"id": input.cliente_id})
    if not cliente:
        raise HTTPException(422, "Cliente não encontrado")
    if await db.clube_assinantes.find_one({"cliente_id": input.cliente_id, "status": {"$in": ["ativo", "pausado"]}}, {"id": 1}):
        raise HTTPException(409, f"{cliente['nome']} já é assinante. Troque o plano na lista de assinantes.")
    inicio = input.inicio or agora_local().date().isoformat()
    doc = {"id": new_id(), "cliente_id": cliente["id"], "cliente_nome": cliente["nome"], "telefone": cliente.get("telefone"),
           "plano_id": plano["id"], "plano_nome": plano["nome"], "valor": plano["valor_mensal"], "dia_vencimento": input.dia_vencimento,
           "inicio": inicio, "status": "ativo", "created_at": now_utc(), "criado_por": principal.nome}
    await db.clube_assinantes.insert_one(doc)
    await db.pessoas.update_one({"id": cliente["id"]}, {"$set": {"assinante_clube": True}})
    return _limpo(doc)


@router.patch("/assinantes/{assinante_id}")
async def editar_assinante(assinante_id: str, input: AssinanteUpdate, principal: Principal = Depends(require("agendamento:write"))):
    a = await db.clube_assinantes.find_one({"id": assinante_id})
    if not a:
        raise HTTPException(404, "Assinante não encontrado")
    dados: dict = {"updated_at": now_utc()}
    if input.plano_id:
        plano = await db.clube_planos.find_one({"id": input.plano_id})
        if not plano:
            raise HTTPException(422, "Plano do clube não encontrado")
        dados.update(plano_id=plano["id"], plano_nome=plano["nome"], valor=plano["valor_mensal"])
    if input.dia_vencimento:
        dados["dia_vencimento"] = input.dia_vencimento
    if input.status and input.status != a["status"]:
        dados["status"] = input.status
        if input.status == "cancelado":
            dados["cancelado_em"] = agora_local().date().isoformat()
        if input.status == "pausado":
            dados["pausado_em"] = agora_local().date().isoformat()
        await db.pessoas.update_one({"id": a["cliente_id"]}, {"$set": {"assinante_clube": input.status == "ativo"}})
    await db.clube_assinantes.update_one({"id": assinante_id}, {"$set": dados})
    return _limpo({**a, **dados})


@router.get("/cliente/{cliente_id}")
async def assinatura_do_cliente(cliente_id: str, principal: Principal = Depends(require("agendamento:read"))):
    """Usado na conclusão do atendimento: o cliente é assinante ativo? Quais serviços o plano cobre e quantos usos restam."""
    a = await db.clube_assinantes.find_one({"cliente_id": cliente_id, "status": "ativo"})
    if not a:
        return None
    plano = await db.clube_planos.find_one({"id": a["plano_id"]}) or {}
    ini, fim = _mes(None)
    usos = await db.agendamentos.count_documents({"cliente_id": cliente_id, "status": "concluido", "pelo_clube": True,
                                                  "data": {"$gte": ini.isoformat(), "$lte": fim.isoformat()}})
    limite = plano.get("limite_mes")
    return {"assinante_id": a["id"], "plano_nome": a["plano_nome"], "servico_ids": plano.get("servico_ids") or [],
            "limite_mes": limite, "usos_mes": usos, "restantes": None if limite is None else max(0, limite - usos)}


# ------------------------------------------------------------------ painel de frequência


@router.get("/painel")
async def painel(mes: str | None = None, principal: Principal = Depends(require("agendamento:read"))):
    ini, fim = _mes(mes)
    hoje = agora_local().date()
    tres_meses = (ini - timedelta(days=90)).isoformat()
    assinantes = await db.clube_assinantes.find({}).to_list(3000)
    planos = {p["id"]: p for p in await db.clube_planos.find({}).to_list(100)}
    servicos = {s["id"]: s for s in await db.servicos.find({}, {"id": 1, "nome": 1, "preco": 1}).to_list(500)}
    ids = [a["cliente_id"] for a in assinantes]
    visitas: dict[str, list[dict]] = {i: [] for i in ids}
    if ids:
        async for ag in db.agendamentos.find({"cliente_id": {"$in": ids}, "status": "concluido", "data": {"$gte": tres_meses, "$lte": fim.isoformat()}},
                                             {"cliente_id": 1, "data": 1, "servico_ids": 1, "pelo_clube": 1}):
            visitas.setdefault(ag["cliente_id"], []).append(ag)
    linhas = []
    for a in assinantes:
        if a["status"] == "cancelado" and (a.get("cancelado_em") or "") < ini.isoformat():
            continue
        plano = planos.get(a["plano_id"], {})
        incluidos = set(plano.get("servico_ids") or [])
        todas = visitas.get(a["cliente_id"], [])
        no_mes = [v for v in todas if ini.isoformat() <= v["data"] <= fim.isoformat()]
        anteriores = [v for v in todas if v["data"] < ini.isoformat()]
        consumido = round(sum(float(servicos[s]["preco"]) for v in no_mes for s in v.get("servico_ids", [])
                              if s in servicos and (not incluidos or s in incluidos)), 2)
        ultima = max((v["data"] for v in todas), default=None)
        dias_sem_vir = (hoje - date.fromisoformat(ultima)).days if ultima else None
        valor = float(a.get("valor") or 0)
        linhas.append({
            "id": a["id"], "cliente_id": a["cliente_id"], "cliente_nome": a["cliente_nome"], "telefone": a.get("telefone"),
            "plano_nome": a["plano_nome"], "valor": valor, "status": a["status"], "inicio": a.get("inicio"),
            "dia_vencimento": a.get("dia_vencimento"), "visitas_mes": len(no_mes),
            "media_3_meses": round(len(anteriores) / 3, 1), "ultima_visita": ultima, "dias_sem_vir": dias_sem_vir,
            "consumido_tabela": consumido, "custo_por_visita": round(valor / len(no_mes), 2) if no_mes else None,
            "saldo": round(valor - consumido, 2), "limite_mes": plano.get("limite_mes"),
            "risco": a["status"] == "ativo" and (dias_sem_vir is None or dias_sem_vir > 21),
        })
    linhas.sort(key=lambda x: (x["status"] != "ativo", -x["visitas_mes"], x["cliente_nome"]))
    ativos = [x for x in linhas if x["status"] == "ativo"]
    total_visitas = sum(x["visitas_mes"] for x in ativos)
    receita = round(sum(x["valor"] for x in ativos), 2)
    consumido = round(sum(x["consumido_tabela"] for x in ativos), 2)
    faixas = {"0": 0, "1": 0, "2-3": 0, "4+": 0}
    for x in ativos:
        n = x["visitas_mes"]
        faixas["0" if n == 0 else "1" if n == 1 else "2-3" if n <= 3 else "4+"] += 1
    return {
        "mes": ini.strftime("%Y-%m"), "assinantes": linhas,
        "resumo": {"ativos": len(ativos), "pausados": len([x for x in linhas if x["status"] == "pausado"]),
                   "receita_mensal": receita, "visitas": total_visitas,
                   "media_visitas": round(total_visitas / len(ativos), 1) if ativos else 0,
                   "receita_por_visita": round(receita / total_visitas, 2) if total_visitas else None,
                   "consumido_tabela": consumido, "resultado": round(receita - consumido, 2),
                   "em_risco": len([x for x in ativos if x["risco"]]), "faixas": faixas},
    }


# ------------------------------------------------------------------ mensalidades


class Mensalidades(BaseModel):
    mes: str | None = None


@router.post("/mensalidades")
async def lancar_mensalidades(input: Mensalidades, principal: Principal = Depends(require("unidade:manage"))):
    """Lança a mensalidade do mês de cada assinante ativo no Financeiro. Rodar de novo não duplica."""
    ini, _ = _mes(input.mes)
    conta = await db.plano_contas.find_one({"codigo": "1.1.1"}) or await db.plano_contas.find_one({"tipo": "receita"})
    if not conta:
        raise HTTPException(409, "Cadastre uma conta de receita no plano de contas")
    lancadas, ja = 0, 0
    async for a in db.clube_assinantes.find({"status": "ativo"}):
        chave = f"clube-{a['id']}-{ini.strftime('%Y-%m')}"
        venc = ini.replace(day=min(int(a.get("dia_vencimento") or 10), 28)).isoformat()
        doc = {"_id": chave, "id": chave, "descricao": f"Clube {a['plano_nome']} | {a['cliente_nome']} ({ini.strftime('%m/%Y')})"[:300],
               "tipo": "receber", "valor": round(float(a["valor"]), 2), "plano_conta_id": conta["id"], "imovel_id": None,
               "pessoa_id": a["cliente_id"], "corretor_id": None, "evento_id": None, "contrato_id": None, "vencimento": venc,
               "pagamento": None, "status": "pendente", "forma_pagamento": None, "vencido": False, "cancelado_em": None,
               "clube_assinante_id": a["id"], "created_at": now_utc()}
        try:
            await db.transacoes.insert_one(doc)
            lancadas += 1
        except Exception:
            ja += 1  # já lançada neste mês
    return {"lancadas": lancadas, "ja_existiam": ja, "mes": ini.strftime("%Y-%m")}
