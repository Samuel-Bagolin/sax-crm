"""Estoque de veículos (segmento loja de veículos).

- Custo de aquisição + despesas de preparação = custo total; margem prevista = preço - custo total.
- Dias em estoque contam da entrada até a venda (ou até hoje). Acima de 60 dias, alerta de giro.
- Placa é dado interno: nunca vai para o site.
- Vender gera a receita no Financeiro e marca o negócio do CRM como ganho, se informado.
- Fotos usam a mesma galeria e a mesma URL pública dos imóveis (`/api/publico/foto/{id}`).
"""

from __future__ import annotations

import re
from datetime import date
from typing import List, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from lib.agenda_online import agora_local
from lib.auth import Principal, require
from lib.db import controle, db, empresa_atual_db
from lib.planos import exigir_limite
from models.common import new_id, now_utc

router = APIRouter(prefix="/veiculos", tags=["veiculos"])

Status = Literal["preparacao", "disponivel", "reservado", "vendido"]
PLACA = re.compile(r"^[A-Z]{3}\d[A-Z0-9]\d{2}$")
ALERTA_GIRO_DIAS = 60


class Despesa(BaseModel):
    descricao: str = Field(min_length=2, max_length=120)
    valor: float = Field(ge=0, le=10_000_000)
    data: str | None = None


class VeiculoIn(BaseModel):
    marca: str = Field(min_length=2, max_length=40)
    modelo: str = Field(min_length=1, max_length=60)
    versao: str | None = Field(default=None, max_length=80)
    ano_fabricacao: int = Field(ge=1950, le=2100)
    ano_modelo: int = Field(ge=1950, le=2101)
    km: int = Field(default=0, ge=0, le=3_000_000)
    cor: str | None = Field(default=None, max_length=30)
    cambio: Literal["manual", "automatico", "cvt", "automatizado"] = "manual"
    combustivel: Literal["flex", "gasolina", "etanol", "diesel", "eletrico", "hibrido", "gnv"] = "flex"
    categoria: Literal["hatch", "sedan", "suv", "picape", "utilitario", "moto", "esportivo", "outro"] = "hatch"
    portas: int | None = Field(default=None, ge=0, le=6)
    placa: str | None = Field(default=None, max_length=8)
    opcionais: List[str] = Field(default_factory=list, max_length=60)
    descricao: str | None = Field(default=None, max_length=4000)
    preco_venda: float | None = Field(default=None, ge=0, le=100_000_000)
    preco_fipe: float | None = Field(default=None, ge=0, le=100_000_000)
    custo_aquisicao: float | None = Field(default=None, ge=0, le=100_000_000)
    despesas: List[Despesa] = Field(default_factory=list, max_length=100)
    status: Status = "disponivel"
    data_entrada: str | None = None
    unidade_id: str | None = None
    site_status: Literal["inativo", "ativo", "reservado"] = "inativo"
    site_destaque: bool = False
    aceita_troca: bool = True
    unico_dono: bool = False
    ipva_pago: bool = False
    garantia: str | None = Field(default=None, max_length=80)


class Venda(BaseModel):
    valor: float = Field(gt=0, le=100_000_000)
    data: str | None = None
    cliente_id: str | None = None
    vendedor_usuario_id: str | None = None
    negocio_id: str | None = None
    forma_pagamento: str | None = Field(default=None, max_length=40)


def _custo(v: dict) -> float:
    return round(float(v.get("custo_aquisicao") or 0) + sum(float(d.get("valor") or 0) for d in v.get("despesas") or []), 2)


def _saida(v: dict) -> dict:
    hoje = agora_local().date()
    entrada = v.get("data_entrada") or (v.get("created_at").date().isoformat() if hasattr(v.get("created_at"), "date") else hoje.isoformat())
    fim = date.fromisoformat(v["vendido_em"]) if v.get("vendido_em") else hoje
    try:
        dias = max(0, (fim - date.fromisoformat(entrada)).days)
    except ValueError:
        dias = 0
    custo = _custo(v)
    preco = v.get("valor_vendido") or v.get("preco_venda")
    out = {k: val for k, val in v.items() if k != "_id"}
    out.update(custo_total=custo, dias_estoque=dias, alerta_giro=v.get("status") != "vendido" and dias >= ALERTA_GIRO_DIAS,
               margem=round(float(preco) - custo, 2) if preco and custo else None,
               margem_pct=round((float(preco) - custo) / float(preco) * 100, 1) if preco and custo else None,
               titulo=titulo(v))
    return out


def titulo(v: dict) -> str:
    return " ".join(str(x) for x in (v.get("marca"), v.get("modelo"), v.get("versao"), f"{v.get('ano_fabricacao')}/{v.get('ano_modelo')}") if x)


def _normalizar(input: VeiculoIn) -> dict:
    d = input.model_dump()
    if d["ano_modelo"] < d["ano_fabricacao"] or d["ano_modelo"] > d["ano_fabricacao"] + 1:
        raise HTTPException(422, "Ano do modelo deve ser o mesmo ou o seguinte ao de fabricação")
    if d.get("placa"):
        placa = re.sub(r"[^A-Z0-9]", "", d["placa"].upper())
        if not PLACA.match(placa):
            raise HTTPException(422, "Placa inválida. Use AAA1234 ou AAA1A23.")
        d["placa"] = placa
    d["marca"] = d["marca"].strip()
    d["modelo"] = d["modelo"].strip()
    d["opcionais"] = sorted({o.strip()[:40] for o in d["opcionais"] if o.strip()})
    if d["status"] == "vendido":
        raise HTTPException(422, "Use Registrar venda para marcar o veículo como vendido")
    if d["status"] == "reservado" and d["site_status"] == "ativo":
        d["site_status"] = "reservado"
    return d


async def _proximo_codigo() -> str:
    from pymongo import ReturnDocument

    n = await db.contadores.find_one_and_update({"_id": "veiculo"}, {"$inc": {"n": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return f"VE-{int((n or {}).get('n', 1)):04d}"


async def _veiculo(vid: str) -> dict:
    v = await db.veiculos.find_one({"id": vid})
    if not v:
        raise HTTPException(404, "Veículo não encontrado")
    return v


def _site_check(principal: Principal, d: dict, antes: dict | None = None) -> None:
    mudou = any(d.get(k) != (antes or {}).get(k, "inativo" if k == "site_status" else False) for k in ("site_status", "site_destaque"))
    if mudou and not principal.pode_site:
        raise HTTPException(403, "Só o gestor ou quem ele liberou muda o veículo no site")


@router.get("")
async def listar(status: str | None = None, principal: Principal = Depends(require("veiculo:read"))):
    filtro = {"status": status} if status else {}
    docs = await db.veiculos.find(filtro).to_list(5000)
    docs.sort(key=lambda v: (v.get("status") == "vendido", v.get("created_at") or now_utc()), reverse=False)
    saida = [_saida(v) for v in docs]
    if not principal.is_admin:
        for v in saida:  # custo e margem são da gestão
            for k in ("custo_aquisicao", "despesas", "custo_total", "margem", "margem_pct"):
                v[k] = None
    return saida


@router.get("/resumo")
async def resumo(principal: Principal = Depends(require("veiculo:read"))):
    docs = [_saida(v) for v in await db.veiculos.find({}).to_list(5000)]
    estoque = [v for v in docs if v["status"] != "vendido"]
    hoje = agora_local().date()
    mes = hoje.replace(day=1).isoformat()
    vendidos_mes = [v for v in docs if v["status"] == "vendido" and (v.get("vendido_em") or "") >= mes]
    out = {
        "em_estoque": len(estoque), "disponiveis": sum(1 for v in estoque if v["status"] == "disponivel"),
        "reservados": sum(1 for v in estoque if v["status"] == "reservado"), "preparacao": sum(1 for v in estoque if v["status"] == "preparacao"),
        "valor_estoque": round(sum(float(v.get("preco_venda") or 0) for v in estoque), 2),
        "dias_medio": round(sum(v["dias_estoque"] for v in estoque) / len(estoque), 1) if estoque else None,
        "parados": sum(1 for v in estoque if v["alerta_giro"]), "vendidos_mes": len(vendidos_mes),
        "faturamento_mes": round(sum(float(v.get("valor_vendido") or 0) for v in vendidos_mes), 2),
        "giro_medio_vendidos": round(sum(v["dias_estoque"] for v in vendidos_mes) / len(vendidos_mes), 1) if vendidos_mes else None,
    }
    if principal.is_admin:
        out["custo_estoque"] = round(sum(v["custo_total"] for v in estoque), 2)
        out["margem_mes"] = round(sum(v["margem"] or 0 for v in vendidos_mes), 2)
    return out


@router.get("/{veiculo_id}")
async def obter(veiculo_id: str, principal: Principal = Depends(require("veiculo:read"))):
    v = _saida(await _veiculo(veiculo_id))
    if not principal.is_admin:
        for k in ("custo_aquisicao", "despesas", "custo_total", "margem", "margem_pct"):
            v[k] = None
    from routers.fotos_imovel import listar as listar_fotos, url_publica

    v["fotos"] = [{"id": f["id"], "url": url_publica(f["id"])} for f in await listar_fotos(veiculo_id)]
    v["leads"] = [{k: n.get(k) for k in ("id", "nome", "status", "valor_estimado", "created_at")}
                  for n in await db.leads.find({"veiculo_id": veiculo_id}).to_list(100)]
    return v


@router.post("", status_code=201)
async def criar(input: VeiculoIn, principal: Principal = Depends(require("veiculo:create"))):
    await exigir_limite("imoveis")
    d = _normalizar(input)
    _site_check(principal, d)
    if not principal.is_admin:
        d["custo_aquisicao"] = None
        d["despesas"] = []
    if d.get("placa") and await db.veiculos.find_one({"placa": d["placa"], "status": {"$ne": "vendido"}}, {"id": 1}):
        raise HTTPException(409, "Já existe um veículo em estoque com esta placa")
    v = {"id": new_id(), "codigo": await _proximo_codigo(), **d, "data_entrada": d.get("data_entrada") or agora_local().date().isoformat(),
         "foto_url": None, "criado_por": principal.nome, "created_at": now_utc(), "updated_at": now_utc()}
    await db.veiculos.insert_one(v)
    from routers.site_imobiliaria import limpar_cache

    limpar_cache()
    return _saida(v)


@router.put("/{veiculo_id}")
async def editar(veiculo_id: str, input: VeiculoIn, principal: Principal = Depends(require("veiculo:update"))):
    antes = await _veiculo(veiculo_id)
    if antes.get("status") == "vendido":
        raise HTTPException(409, "Veículo vendido não é editado. Desfaça a venda com o gestor se precisar.")
    d = _normalizar(input)
    _site_check(principal, d, antes)
    if not principal.is_admin:  # vendedor não vê nem altera custo
        d["custo_aquisicao"] = antes.get("custo_aquisicao")
        d["despesas"] = antes.get("despesas") or []
    if d.get("placa") and await db.veiculos.find_one({"placa": d["placa"], "status": {"$ne": "vendido"}, "id": {"$ne": veiculo_id}}, {"id": 1}):
        raise HTTPException(409, "Já existe outro veículo em estoque com esta placa")
    d["updated_at"] = now_utc()
    await db.veiculos.update_one({"id": veiculo_id}, {"$set": d})
    from routers.site_imobiliaria import limpar_cache

    limpar_cache()
    return _saida({**antes, **d})


@router.post("/{veiculo_id}/vender")
async def vender(veiculo_id: str, input: Venda, principal: Principal = Depends(require("veiculo:update"))):
    v = await _veiculo(veiculo_id)
    if v.get("status") == "vendido":
        raise HTTPException(409, "Veículo já vendido")
    dia = input.data or agora_local().date().isoformat()
    conta = await db.plano_contas.find_one({"codigo": "1.1.1"}) or await db.plano_contas.find_one({"tipo": "receita"})
    vendedor = await db.usuarios.find_one({"id": input.vendedor_usuario_id or principal.usuario_id}, {"pessoa_id": 1, "nome": 1}) or {}
    if conta:
        await db.transacoes.insert_one({
            "id": new_id(), "descricao": f"Venda {v.get('codigo')} {titulo(v)}"[:300], "tipo": "receber", "valor": round(input.valor, 2),
            "plano_conta_id": conta["id"], "imovel_id": None, "veiculo_id": veiculo_id, "pessoa_id": input.cliente_id,
            "corretor_id": vendedor.get("pessoa_id"), "evento_id": None, "contrato_id": None, "vencimento": dia, "pagamento": None,
            "status": "pendente", "forma_pagamento": input.forma_pagamento, "vencido": False, "cancelado_em": None, "created_at": now_utc()})
    dados = {"status": "vendido", "site_status": "inativo", "vendido_em": dia, "valor_vendido": round(input.valor, 2),
             "comprador_id": input.cliente_id, "vendedor_nome": vendedor.get("nome"), "updated_at": now_utc()}
    await db.veiculos.update_one({"id": veiculo_id}, {"$set": dados})
    if input.negocio_id:
        await db.leads.update_one({"id": input.negocio_id}, {"$set": {"status": "ganho", "estagio": "ganho", "valor_estimado": round(input.valor, 2),
                                                                     "closed_at": now_utc(), "updated_at": now_utc()}})
    from routers.site_imobiliaria import limpar_cache

    limpar_cache()
    return _saida({**v, **dados})


@router.delete("/{veiculo_id}", status_code=204)
async def excluir(veiculo_id: str, principal: Principal = Depends(require("veiculo:delete"))):
    v = await _veiculo(veiculo_id)
    if v.get("status") == "vendido" or await db.leads.find_one({"veiculo_id": veiculo_id}, {"id": 1}):
        raise HTTPException(409, "Veículo com venda ou negócios vinculados não é excluído")
    from routers.fotos_imovel import remover_todas

    await remover_todas(veiculo_id)
    await db.veiculos.delete_one({"id": veiculo_id})
    return Response(status_code=204)


# ------------------------------------------------------------------ fotos


@router.post("/{veiculo_id}/fotos", status_code=201)
async def enviar_fotos(veiculo_id: str, arquivos: List[UploadFile] = File(...), principal: Principal = Depends(require("veiculo:update"))):
    from routers.fotos_imovel import LIMITE_FOTO, MAX_FOTOS, _mime, listar as listar_fotos, url_publica

    await _veiculo(veiculo_id)
    existentes = await db.fotos_imovel.count_documents({"imovel_id": veiculo_id})
    if existentes + len(arquivos) > MAX_FOTOS:
        raise HTTPException(422, f"Cada veículo aceita até {MAX_FOTOS} fotos")
    ordem = existentes
    for arquivo in arquivos:
        dados = await arquivo.read(LIMITE_FOTO + 1)
        if len(dados) > LIMITE_FOTO:
            raise HTTPException(413, f"{arquivo.filename}: foto acima de 2 MB")
        mime = _mime(dados)
        if not mime:
            raise HTTPException(415, f"{arquivo.filename}: envie JPG, PNG ou WEBP")
        fid = new_id()
        await db.fotos_imovel.insert_one({"id": fid, "imovel_id": veiculo_id, "ordem": ordem, "mime": mime, "dados": dados,
                                          "tamanho": len(dados), "created_by": principal.usuario_id, "created_at": now_utc()})
        await controle.fotos_index.insert_one({"_id": fid, "db_name": empresa_atual_db()})
        ordem += 1
    fotos = await listar_fotos(veiculo_id)
    await db.veiculos.update_one({"id": veiculo_id}, {"$set": {"foto_url": url_publica(fotos[0]["id"]) if fotos else None}})
    return [{"id": f["id"], "url": url_publica(f["id"])} for f in fotos]


@router.delete("/{veiculo_id}/fotos/{foto_id}", status_code=204)
async def remover_foto(veiculo_id: str, foto_id: str, principal: Principal = Depends(require("veiculo:update"))):
    from routers.fotos_imovel import listar as listar_fotos, url_publica

    r = await db.fotos_imovel.delete_one({"id": foto_id, "imovel_id": veiculo_id})
    if not r.deleted_count:
        raise HTTPException(404, "Foto não encontrada")
    await controle.fotos_index.delete_one({"_id": foto_id})
    fotos = await listar_fotos(veiculo_id)
    await db.veiculos.update_one({"id": veiculo_id}, {"$set": {"foto_url": url_publica(fotos[0]["id"]) if fotos else None}})
    return Response(status_code=204)
