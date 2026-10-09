"""Proprietários — carteira de imóveis de cada dono e o que ela rendeu.

O proprietário é uma Pessoa com o papel "proprietario" (PF ou PJ). A ficha junta os imóveis dele,
o contrato vigente de cada um e, para o gestor, os números financeiros:

- aluguel recebido: meses de locação já quitados (taxa de administração paga) × aluguel do contrato;
- lucro da imobiliária: receitas pagas ligadas aos imóveis (comissões e taxas de administração);
- despesas: contas pagas ligadas aos imóveis (manutenção, IPTU, condomínio lançados no financeiro).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from lib.auth import Principal, require
from lib.dates import today_iso
from lib.db import db
from models.common import utc_aware
from models.pessoas import Pessoa, PessoaCreate
from routers.pessoas import normalizar

router = APIRouter(prefix="/proprietarios", tags=["proprietarios"])

CODIGO_TAXA_ADMIN = "1.2.1"  # mesmo código de routers/contratos.py


class ProprietarioResumo(Pessoa):
    qtd_imoveis: int = 0
    qtd_alugados: int = 0
    qtd_disponiveis: int = 0
    valor_carteira: float = 0


class SituacaoLocacao(BaseModel):
    contrato_id: str
    numero: str
    inquilino: Optional[str] = None
    aluguel: float
    inicio: str
    fim: Optional[str] = None
    meses_total: int
    meses_pagos: int
    meses_em_atraso: int
    proximo_vencimento: Optional[str] = None


class ImovelDoProprietario(BaseModel):
    id: str
    codigo: str
    titulo: str
    tipo: str
    finalidade: str
    status: str
    bairro: Optional[str] = None
    cidade: str
    foto_url: Optional[str] = None
    valor_venda: Optional[float] = None
    valor_aluguel: Optional[float] = None
    publicar_portais: bool = False
    locacao: Optional[SituacaoLocacao] = None
    contrato_venda: Optional[str] = None
    aluguel_recebido: Optional[float] = None
    lucro_imobiliaria: Optional[float] = None
    despesas: Optional[float] = None


class Totais(BaseModel):
    aluguel_recebido: float = 0
    lucro_imobiliaria: float = 0
    despesas: float = 0
    a_receber: float = 0


class FichaProprietario(BaseModel):
    proprietario: Pessoa
    imoveis: List[ImovelDoProprietario]
    totais: Optional[Totais] = None  # só para gestor/administrador
    valor_carteira: float = 0


def _pessoa(doc: dict) -> Pessoa:
    return Pessoa(**{**doc, "created_at": utc_aware(doc.get("created_at"))})


async def _doc(proprietario_id: str) -> dict:
    doc = await db.pessoas.find_one({"id": proprietario_id})
    if not doc:
        raise HTTPException(404, "Proprietário não encontrado")
    return doc


@router.get("", response_model=List[ProprietarioResumo])
async def listar(busca: str | None = Query(None, max_length=120), principal: Principal = Depends(require("pessoa:read"))):
    pessoas = await db.pessoas.find({"papeis": "proprietario"}).sort("nome", 1).to_list(None)
    imoveis = await db.imoveis.find({"proprietario_id": {"$in": [p["id"] for p in pessoas]}},
                                    {"proprietario_id": 1, "status": 1, "valor_venda": 1}).to_list(None) if pessoas else []
    termo = (busca or "").strip().lower()
    saida = []
    for p in pessoas:
        if termo and termo not in " ".join(str(p.get(k) or "") for k in ("nome", "cpf_cnpj", "email", "telefone", "nome_fantasia")).lower():
            continue
        meus = [i for i in imoveis if i.get("proprietario_id") == p["id"]]
        saida.append(ProprietarioResumo(
            **_pessoa(p).model_dump(),
            qtd_imoveis=len(meus),
            qtd_alugados=sum(1 for i in meus if i.get("status") == "alugado"),
            qtd_disponiveis=sum(1 for i in meus if i.get("status") in ("captado", "publicado")),
            valor_carteira=round(sum(i.get("valor_venda") or 0 for i in meus if i.get("status") in ("captado", "publicado")), 2),
        ))
    return saida


@router.post("", response_model=Pessoa, status_code=201)
async def criar(input: PessoaCreate, principal: Principal = Depends(require("pessoa:create"))):
    data = await normalizar(input.model_dump())
    data["papeis"] = sorted(set(data.get("papeis") or []) | {"proprietario"})
    pessoa = Pessoa(**data)
    await db.pessoas.insert_one({**pessoa.model_dump(), "documento_digitos": data.get("documento_digitos"), "created_by": principal.usuario_id})
    return pessoa


async def _conta_taxa_admin() -> str | None:
    conta = await db.plano_contas.find_one({"codigo": CODIGO_TAXA_ADMIN}, {"id": 1})
    return conta["id"] if conta else None


@router.get("/{proprietario_id}", response_model=FichaProprietario)
async def ficha(proprietario_id: str, principal: Principal = Depends(require("pessoa:read"))):
    doc = await _doc(proprietario_id)
    imoveis = await db.imoveis.find({"proprietario_id": proprietario_id}).sort("created_at", -1).to_list(None)
    ids = [i["id"] for i in imoveis]
    contratos = await db.contratos.find({"imovel_id": {"$in": ids}, "status": {"$ne": "cancelado"}}).to_list(None) if ids else []
    transacoes = await db.transacoes.find({"imovel_id": {"$in": ids}, "status": {"$ne": "cancelado"}}).to_list(None) if ids else []
    taxa_admin = await _conta_taxa_admin()
    nomes = {}
    pessoa_ids = list({c.get("cliente_id") for c in contratos if c.get("cliente_id")})
    if pessoa_ids:
        async for p in db.pessoas.find({"id": {"$in": pessoa_ids}}, {"id": 1, "nome": 1}):
            nomes[p["id"]] = p["nome"]
    hoje = today_iso()
    ver_financeiro = principal.is_admin

    lista, totais = [], Totais()
    for im in imoveis:
        trans = [t for t in transacoes if t.get("imovel_id") == im["id"]]
        meus_contratos = sorted([c for c in contratos if c["imovel_id"] == im["id"]], key=lambda c: str(c.get("created_at")), reverse=True)
        locacao, aluguel_recebido = None, 0.0
        for c in meus_contratos:
            if c["tipo"] != "locacao":
                continue
            parcelas = [t for t in trans if t.get("contrato_id") == c["id"] and t.get("plano_conta_id") == taxa_admin]
            pagas = sum(1 for t in parcelas if t.get("status") == "pago")
            aluguel_recebido += pagas * float(c["valor"])
            if c.get("status") == "ativo" and locacao is None:
                pendentes = sorted(t["vencimento"] for t in parcelas if t.get("status") == "pendente")
                locacao = SituacaoLocacao(
                    contrato_id=c["id"], numero=c["numero"], inquilino=nomes.get(c.get("cliente_id")),
                    aluguel=float(c["valor"]), inicio=c["inicio"], fim=c.get("fim"),
                    meses_total=int(c.get("parcelas") or len(parcelas)), meses_pagos=pagas,
                    meses_em_atraso=sum(1 for v in pendentes if v < hoje),
                    proximo_vencimento=next((v for v in pendentes if v >= hoje), pendentes[0] if pendentes else None),
                )
        venda = next((c["numero"] for c in meus_contratos if c["tipo"] == "venda"), None)
        lucro = sum(float(t["valor"]) for t in trans if t["tipo"] == "receber" and t.get("status") == "pago")
        a_receber = sum(float(t["valor"]) for t in trans if t["tipo"] == "receber" and t.get("status") == "pendente")
        despesas = sum(float(t["valor"]) for t in trans if t["tipo"] == "pagar" and t.get("status") == "pago")
        item = ImovelDoProprietario(
            id=im["id"], codigo=im.get("codigo") or "", titulo=im["titulo"], tipo=im["tipo"], finalidade=im["finalidade"],
            status=im["status"], bairro=im.get("bairro"), cidade=im["cidade"], foto_url=im.get("foto_url"),
            valor_venda=im.get("valor_venda"), valor_aluguel=im.get("valor_aluguel"), publicar_portais=bool(im.get("publicar_portais")),
            locacao=locacao, contrato_venda=venda,
        )
        if ver_financeiro:
            item.aluguel_recebido = round(aluguel_recebido, 2)
            item.lucro_imobiliaria = round(lucro, 2)
            item.despesas = round(despesas, 2)
            totais.aluguel_recebido += aluguel_recebido
            totais.lucro_imobiliaria += lucro
            totais.despesas += despesas
            totais.a_receber += a_receber
        lista.append(item)

    if ver_financeiro:
        for campo in ("aluguel_recebido", "lucro_imobiliaria", "despesas", "a_receber"):
            setattr(totais, campo, round(getattr(totais, campo), 2))
    carteira = round(sum(i.get("valor_venda") or 0 for i in imoveis if i.get("status") in ("captado", "publicado")), 2)
    return FichaProprietario(proprietario=_pessoa(doc), imoveis=lista, totais=totais if ver_financeiro else None, valor_carteira=carteira)


@router.put("/{proprietario_id}/imoveis/{imovel_id}", status_code=204)
async def vincular(proprietario_id: str, imovel_id: str, principal: Principal = Depends(require("imovel:update"))):
    await _doc(proprietario_id)
    if not await db.imoveis.find_one({"id": imovel_id}, {"id": 1}):
        raise HTTPException(404, "Imóvel não encontrado")
    await db.imoveis.update_one({"id": imovel_id}, {"$set": {"proprietario_id": proprietario_id}})
    await db.pessoas.update_one({"id": proprietario_id}, {"$addToSet": {"papeis": "proprietario"}})
    return None


@router.delete("/{proprietario_id}/imoveis/{imovel_id}", status_code=204)
async def desvincular(proprietario_id: str, imovel_id: str, principal: Principal = Depends(require("imovel:update"))):
    res = await db.imoveis.update_one({"id": imovel_id, "proprietario_id": proprietario_id}, {"$set": {"proprietario_id": None}})
    if not res.matched_count:
        raise HTTPException(404, "Este imóvel não está vinculado a este proprietário")
    return None
