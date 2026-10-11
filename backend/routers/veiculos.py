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
    # Consignação: o carro é de um cliente e a loja vende em nome dele.
    consignado: bool = False
    consignante_id: str | None = None  # Pessoa dona do veículo
    repasse_valor: float | None = Field(default=None, gt=0, le=100_000_000)  # quanto o dono recebe na venda
    consignacao_comissao_pct: float | None = Field(default=None, ge=0, le=100)
    consignacao_fim: str | None = None  # prazo da consignação (AAAA-MM-DD)


class Venda(BaseModel):
    valor: float = Field(gt=0, le=100_000_000)
    data: str | None = None
    cliente_id: str | None = None
    vendedor_usuario_id: str | None = None
    negocio_id: str | None = None
    forma_pagamento: str | None = Field(default=None, max_length=120)


def _custo(v: dict) -> float:
    return round(float(v.get("custo_aquisicao") or 0) + sum(float(d.get("valor") or 0) for d in v.get("despesas") or []), 2)


def _saida(v: dict) -> dict:
    hoje = agora_local().date()
    entrada = v.get("data_entrada") or (v.get("created_at").date().isoformat() if hasattr(v.get("created_at"), "date") else hoje.isoformat())
    try:
        fim = date.fromisoformat(str(v["vendido_em"])[:10]) if v.get("vendido_em") else hoje
        dias = max(0, (fim - date.fromisoformat(str(entrada)[:10])).days)
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
    if d["consignado"]:
        if not d.get("consignante_id"):
            raise HTTPException(422, "Informe o dono do veículo consignado")
        if not d.get("repasse_valor"):
            raise HTTPException(422, "Informe o valor de repasse ao dono do veículo")
        if d.get("consignacao_fim"):
            from lib.agenda_online import validar_data

            d["consignacao_fim"] = validar_data(d["consignacao_fim"]).isoformat()
    else:
        d.update(consignante_id=None, repasse_valor=None, consignacao_comissao_pct=None, consignacao_fim=None)
    return d


async def sincronizar_consignacao(v: dict, principal: Principal) -> dict | None:
    """Mantém o contrato de consignação do veículo: cria quando o carro passa a ser consignado,
    atualiza repasse, comissão e prazo enquanto ninguém assinou e cancela quando deixa de ser."""
    from models.contratos import Contrato
    from routers.contratos import _proximo_numero

    ativo = await db.contratos.find_one({"veiculo_id": v["id"], "tipo": "consignacao", "status": "ativo"})
    if not v.get("consignado"):
        if ativo:
            await db.contratos.update_one({"id": ativo["id"]}, {"$set": {"status": "cancelado", "updated_at": now_utc()}})
        return None
    if not await db.pessoas.find_one({"id": v["consignante_id"]}, {"id": 1}):
        raise HTTPException(422, "Dono do veículo não encontrado no cadastro")
    campos = {"proprietario_id": v["consignante_id"], "valor": round(float(v["repasse_valor"]), 2),
              "comissao_pct": float(v.get("consignacao_comissao_pct") or 0), "fim": v.get("consignacao_fim")}
    if ativo:
        assinado = any(s.get("status") == "assinado" for s in ativo.get("signatarios") or [])
        if not assinado and any(ativo.get(k) != val for k, val in campos.items()):
            await db.contratos.update_one({"id": ativo["id"]}, {"$set": {**campos, "updated_at": now_utc()}})
        return {**ativo, **campos}
    c = Contrato(numero=await _proximo_numero(), tipo="consignacao", veiculo_id=v["id"], inicio=agora_local().date().isoformat(),
                 corretor_id=principal.pessoa_id, financeiro_status="concluido", parcelas=1, taxa_admin_pct=0, **campos).model_dump()
    await db.contratos.insert_one(c)
    return c


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
    v["contratos"] = [{k: c.get(k) for k in ("id", "numero", "tipo", "status", "assinatura_status", "valor")}
                      for c in await db.contratos.find({"veiculo_id": veiculo_id}).to_list(50)]
    if v.get("consignante_id"):
        dono = await db.pessoas.find_one({"id": v["consignante_id"]}, {"nome": 1, "telefone": 1, "cpf_cnpj": 1})
        v["consignante"] = {k: (dono or {}).get(k) for k in ("nome", "telefone", "cpf_cnpj")} if dono else None
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
    if v["consignado"] and not await db.pessoas.find_one({"id": v["consignante_id"]}, {"id": 1}):
        raise HTTPException(422, "Dono do veículo não encontrado no cadastro")
    await db.veiculos.insert_one(v)
    await sincronizar_consignacao(v, principal)
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
    if d["consignado"] and not await db.pessoas.find_one({"id": d["consignante_id"]}, {"id": 1}):
        raise HTTPException(422, "Dono do veículo não encontrado no cadastro")
    await db.veiculos.update_one({"id": veiculo_id}, {"$set": d})
    await sincronizar_consignacao({**antes, **d}, principal)
    from routers.site_imobiliaria import limpar_cache

    limpar_cache()
    return _saida({**antes, **d})


@router.post("/{veiculo_id}/vender")
async def vender(veiculo_id: str, input: Venda, principal: Principal = Depends(require("veiculo:update"))):
    if input.vendedor_usuario_id and input.vendedor_usuario_id != principal.usuario_id and not principal.is_admin:
        raise HTTPException(403, "Só o gestor registra venda em nome de outro vendedor")
    return _saida(await registrar_venda(veiculo_id, input, principal))


async def registrar_venda(veiculo_id: str, input: Venda, principal: Principal, contrato_id: str | None = None) -> dict:
    """Marca o veículo como vendido e lança a receita uma vez só. Usado pela venda direta e pelo contrato."""
    from lib.agenda_online import validar_data
    from lib.auth import authorize

    v = await _veiculo(veiculo_id)
    if v.get("status") == "vendido":
        raise HTTPException(409, "Veículo já vendido")
    dia = validar_data(input.data).isoformat() if input.data else agora_local().date().isoformat()
    negocio = None
    if input.negocio_id:
        negocio = await db.leads.find_one({"id": input.negocio_id})
        if not negocio:
            raise HTTPException(404, "Negócio não encontrado")
        authorize(principal, "lead:update", negocio)  # vendedor só fecha negócio dele
    conta = await db.plano_contas.find_one({"codigo": "1.1.1"}) or await db.plano_contas.find_one({"tipo": "receita"})
    vendedor = await db.usuarios.find_one({"id": input.vendedor_usuario_id or principal.usuario_id}, {"pessoa_id": 1, "nome": 1}) or {}
    dados = {"status": "vendido", "site_status": "inativo", "vendido_em": dia, "valor_vendido": round(input.valor, 2),
             "comprador_id": input.cliente_id, "vendedor_nome": vendedor.get("nome"), "forma_pagamento": input.forma_pagamento,
             "contrato_id": contrato_id, "updated_at": now_utc()}
    # Marca como vendido com condição no status: duas vendas ao mesmo tempo não lançam a receita duas vezes.
    r = await db.veiculos.update_one({"id": veiculo_id, "status": {"$ne": "vendido"}}, {"$set": dados})
    if r.modified_count != 1:
        raise HTTPException(409, "Veículo já vendido")
    if conta:
        try:
            await db.transacoes.insert_one({
                "id": new_id(), "descricao": f"Venda {v.get('codigo')} {titulo(v)}"[:300], "tipo": "receber", "valor": round(input.valor, 2),
                "plano_conta_id": conta["id"], "imovel_id": None, "veiculo_id": veiculo_id, "pessoa_id": input.cliente_id,
                "corretor_id": vendedor.get("pessoa_id"), "evento_id": None, "contrato_id": contrato_id, "vencimento": dia, "pagamento": None,
                "status": "pendente", "forma_pagamento": input.forma_pagamento, "vencido": False, "cancelado_em": None, "created_at": now_utc()})
        except Exception:
            await db.veiculos.update_one({"id": veiculo_id}, {"$set": {k: v.get(k) for k in dados}})
            raise
    if v.get("consignado") and v.get("consignante_id"):
        await _lancar_repasse(v, input.valor, dia, contrato_id)
    if negocio:
        await db.leads.update_one({"id": negocio["id"]}, {"$set": {"status": "ganho", "estagio": "ganho", "valor_estimado": round(input.valor, 2),
                                                                  "closed_at": now_utc(), "updated_at": now_utc()}})
    from routers.site_imobiliaria import limpar_cache

    limpar_cache()
    return {**v, **dados}


async def _conta_repasse() -> str | None:
    """Conta 2.4.4 (repasse de consignados). Lojas antigas ganham a conta na primeira venda consignada."""
    conta = await db.plano_contas.find_one({"codigo": "2.4.4"})
    if conta:
        return conta["id"]
    pai = await db.plano_contas.find_one({"codigo": "2.4"}) or await db.plano_contas.find_one({"tipo": "despesa"})
    if not pai:
        return None
    doc = {"id": new_id(), "codigo": "2.4.4", "nome": "Repasse de veículos consignados", "tipo": "despesa",
           "conta_pai_id": pai["id"] if pai.get("codigo") == "2.4" else None, "ativo": True, "created_at": now_utc()}
    await db.plano_contas.insert_one(doc)
    return doc["id"]


async def _lancar_repasse(v: dict, valor_venda: float, dia: str, contrato_id: str | None) -> None:
    """Venda de carro consignado: conta a pagar ao dono, com id fixo por veículo (não duplica)."""
    repasse = v.get("repasse_valor")
    if not repasse:
        repasse = valor_venda * (1 - float(v.get("consignacao_comissao_pct") or 0) / 100)
    evento = f"repasse:{v['id']}:{v.get('vendido_em') or dia}"
    await db.transacoes.update_one({"_id": evento}, {"$setOnInsert": {
        "id": new_id(), "descricao": f"Repasse ao dono, {v.get('codigo')} {titulo(v)}"[:300], "tipo": "pagar",
        "valor": round(float(repasse), 2), "plano_conta_id": await _conta_repasse(), "imovel_id": None, "veiculo_id": v["id"],
        "pessoa_id": v.get("consignante_id"), "corretor_id": None, "evento_id": evento, "contrato_id": contrato_id, "vencimento": dia,
        "pagamento": None, "status": "pendente", "forma_pagamento": None, "vencido": False, "cancelado_em": None, "created_at": now_utc()}}, upsert=True)
    await db.contratos.update_many({"veiculo_id": v["id"], "tipo": "consignacao", "status": "ativo"},
                                   {"$set": {"status": "encerrado", "encerrado_por_venda": True, "updated_at": now_utc()}})


async def desfazer_venda(veiculo_id: str, contrato_id: str) -> bool:
    """Contrato cancelado antes de receber: o veículo volta ao estoque. Venda já recebida fica como está."""
    if await db.transacoes.find_one({"veiculo_id": veiculo_id, "contrato_id": contrato_id, "status": "pago"}, {"id": 1}):
        return False
    r = await db.veiculos.update_one({"id": veiculo_id, "status": "vendido", "contrato_id": contrato_id},
                                     {"$set": {"status": "disponivel", "vendido_em": None, "valor_vendido": None, "comprador_id": None,
                                               "vendedor_nome": None, "contrato_id": None, "updated_at": now_utc()}})
    if r.modified_count == 1:
        # Consignado volta a ficar à venda: o contrato de consignação reabre e o repasse pendente sai.
        await db.transacoes.update_many({"veiculo_id": veiculo_id, "tipo": "pagar", "status": "pendente", "evento_id": {"$regex": "^repasse:"}},
                                        {"$set": {"status": "cancelado", "cancelado_em": now_utc()}})
        await db.contratos.update_many({"veiculo_id": veiculo_id, "tipo": "consignacao", "status": "encerrado", "encerrado_por_venda": True},
                                       {"$set": {"status": "ativo", "encerrado_por_venda": False, "updated_at": now_utc()}})
        from routers.site_imobiliaria import limpar_cache

        limpar_cache()
    return r.modified_count == 1


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
