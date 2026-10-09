"""Propostas e contrapropostas do negócio.

Uma negociação é uma cadeia: proposta do cliente → contraproposta do proprietário → ... até alguém
aceitar ou recusar. Cada elo guarda valor, forma de pagamento, sinal, condições e validade.
Aceitar atualiza o valor do negócio; o contrato continua sendo gerado pelo módulo de contratos.
"""

from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.crm import registrar
from lib.dates import today_iso
from lib.db import controle, db, empresa_atual_db
from lib.integrity import sequence
from lib.planos import exigir_recurso
from models.common import new_id, now_utc, utc_aware
from models.validated import ISODate

router = APIRouter(tags=["propostas"])

FormaPagamento = Literal["avista", "financiamento", "fgts", "permuta", "parcelado", "consorcio"]
FORMA_LABEL = {"avista": "À vista", "financiamento": "Financiamento bancário", "fgts": "FGTS", "permuta": "Permuta",
               "parcelado": "Parcelado direto com o proprietário", "consorcio": "Carta de consórcio"}
STATUS_LABEL = {"enviada": "Aguardando resposta", "aceita": "Aceita", "recusada": "Recusada", "contraproposta": "Respondida com contraproposta",
                "expirada": "Expirada", "cancelada": "Cancelada"}


class PropostaInput(BaseModel):
    valor: float = Field(gt=0)
    formas_pagamento: List[FormaPagamento] = Field(default_factory=lambda: ["avista"], min_length=1, max_length=4)
    sinal: float | None = Field(default=None, ge=0)
    valor_financiado: float | None = Field(default=None, ge=0)
    condicoes: str | None = Field(default=None, max_length=4000)
    validade: ISODate | None = None
    autor: Literal["cliente", "proprietario"] = "cliente"
    imovel_id: str | None = None


class RespostaInput(BaseModel):
    status: Literal["aceita", "recusada"]
    observacao: str | None = Field(default=None, max_length=1000)


class Proposta(BaseModel):
    id: str
    numero: str
    negocio_id: str
    imovel_id: str | None = None
    imovel_titulo: str | None = None
    tipo: Literal["proposta", "contraproposta"]
    autor: Literal["cliente", "proprietario"]
    valor: float
    formas_pagamento: List[str]
    sinal: float | None = None
    valor_financiado: float | None = None
    condicoes: str | None = None
    validade: str | None = None
    status: str
    parent_id: str | None = None
    observacao_resposta: str | None = None
    respondida_em: str | None = None
    criado_por_nome: str | None = None
    created_at: str
    valor_pedido: float | None = None  # preço anunciado do imóvel, para comparar
    desconto_pct: float | None = None


async def _negocio(negocio_id: str, principal: Principal, acao: str = "lead:read") -> dict:
    n = await db.leads.find_one({"id": negocio_id})
    if not n:
        raise HTTPException(404, "Negócio não encontrado")
    authorize(principal, acao, n)
    return n


def _status(d: dict) -> str:
    if d["status"] == "enviada" and d.get("validade") and d["validade"] < today_iso():
        return "expirada"
    return d["status"]


async def _saida(d: dict, imoveis: dict | None = None) -> Proposta:
    imoveis = imoveis if imoveis is not None else {}
    im = imoveis.get(d.get("imovel_id")) if d.get("imovel_id") else None
    if d.get("imovel_id") and im is None:
        im = await db.imoveis.find_one({"id": d["imovel_id"]}, {"titulo": 1, "codigo": 1, "valor_venda": 1, "valor_aluguel": 1, "finalidade": 1})
        imoveis[d["imovel_id"]] = im
    pedido = None
    if im:
        pedido = im.get("valor_venda") if im.get("finalidade") != "locacao" else im.get("valor_aluguel")
    resp = utc_aware(d.get("respondida_em"))
    return Proposta(
        **{k: d.get(k) for k in ("id", "numero", "negocio_id", "imovel_id", "tipo", "autor", "valor", "formas_pagamento", "sinal",
                                 "valor_financiado", "condicoes", "validade", "parent_id", "observacao_resposta", "criado_por_nome")},
        status=_status(d), imovel_titulo=f"{im.get('codigo', '')} · {im.get('titulo', '')}" if im else None,
        respondida_em=resp.isoformat() if resp else None, created_at=utc_aware(d["created_at"]).isoformat(),
        valor_pedido=pedido, desconto_pct=round((1 - d["valor"] / pedido) * 100, 1) if pedido else None,
    )


def _brl(v: float | None) -> str:
    if v is None:
        return "—"
    return "R$ " + f"{v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


async def _mover_para_proposta(n: dict, principal: Principal) -> None:
    """Se o funil tem uma etapa de proposta à frente da atual, o negócio avança sozinho."""
    funil = await db.funis.find_one({"id": n.get("funil_id")})
    if not funil or n.get("status") != "aberto":
        return
    ids = [e["id"] for e in funil["etapas"]]
    alvo = next((e for e in funil["etapas"] if "proposta" in e["nome"].lower()), None)
    if alvo and n.get("etapa_id") in ids and ids.index(alvo["id"]) > ids.index(n["etapa_id"]):
        from routers.leads import _aplicar
        await _aplicar(n, {"etapa_id": alvo["id"]}, principal)


@router.get("/leads/{negocio_id}/propostas", response_model=List[Proposta])
async def listar(negocio_id: str, principal: Principal = Depends(require("lead:read"))):
    await _negocio(negocio_id, principal)
    cache: dict = {}
    return [await _saida(d, cache) async for d in db.propostas.find({"negocio_id": negocio_id}).sort("created_at", -1)]


@router.post("/leads/{negocio_id}/propostas", response_model=Proposta, status_code=201)
async def criar(negocio_id: str, input: PropostaInput, principal: Principal = Depends(require("lead:update"))):
    await exigir_recurso("propostas")
    n = await _negocio(negocio_id, principal, "lead:update")
    if n.get("status") != "aberto":
        raise HTTPException(409, "Reabra o negócio para registrar uma proposta")
    doc = await _novo(n, input, principal, "proposta", None)
    await registrar(n["id"], "proposta", f"Proposta {doc['numero']} registrada: {_brl(input.valor)}", principal)
    await _mover_para_proposta(n, principal)
    return await _saida(doc)


async def _novo(n: dict, input: PropostaInput, principal: Principal, tipo: str, parent: dict | None) -> dict:
    imovel_id = input.imovel_id or (parent or {}).get("imovel_id") or n.get("imovel_id")
    if imovel_id and not await db.imoveis.find_one({"id": imovel_id}, {"id": 1}):
        raise HTTPException(422, "Imóvel não encontrado")
    if input.sinal and input.sinal > input.valor:
        raise HTTPException(422, "O sinal não pode ser maior que o valor da proposta")
    doc = {
        "id": new_id(), "numero": await sequence(db.propostas, "numero", "PR-"), "negocio_id": n["id"], "imovel_id": imovel_id,
        "cliente_id": n.get("cliente_id"), "corretor_id": n.get("corretor_id"), "tipo": tipo, "autor": input.autor,
        "valor": round(input.valor, 2), "formas_pagamento": list(dict.fromkeys(input.formas_pagamento)), "sinal": input.sinal,
        "valor_financiado": input.valor_financiado, "condicoes": (input.condicoes or "").strip() or None, "validade": input.validade,
        "status": "enviada", "parent_id": (parent or {}).get("id"), "criado_por": principal.usuario_id,
        "criado_por_nome": principal.nome, "created_at": now_utc(),
    }
    await db.propostas.insert_one(doc)
    return doc


async def _proposta(proposta_id: str, principal: Principal, acao: str = "lead:read") -> tuple[dict, dict]:
    d = await db.propostas.find_one({"id": proposta_id})
    if not d:
        raise HTTPException(404, "Proposta não encontrada")
    n = await _negocio(d["negocio_id"], principal, acao)
    return d, n


@router.post("/propostas/{proposta_id}/responder", response_model=Proposta)
async def responder(proposta_id: str, input: RespostaInput, principal: Principal = Depends(require("lead:update"))):
    d, n = await _proposta(proposta_id, principal, "lead:update")
    if _status(d) != "enviada":
        raise HTTPException(409, "Só é possível responder propostas aguardando resposta")
    obs = (input.observacao or "").strip() or None
    await db.propostas.update_one({"id": d["id"]}, {"$set": {"status": input.status, "observacao_resposta": obs, "respondida_em": now_utc()}})
    if input.status == "aceita":
        await registrar(n["id"], "proposta", f"Proposta {d['numero']} ACEITA: {_brl(d['valor'])}" + (f" — {obs}" if obs else ""), principal)
        from routers.leads import _aplicar
        await _aplicar(n, {"valor_estimado": d["valor"], **({"imovel_id": d["imovel_id"]} if d.get("imovel_id") else {})}, principal)
    else:
        await registrar(n["id"], "proposta", f"Proposta {d['numero']} recusada" + (f" — {obs}" if obs else ""), principal)
    return await _saida(await db.propostas.find_one({"id": d["id"]}))


@router.post("/propostas/{proposta_id}/contraproposta", response_model=Proposta, status_code=201)
async def contraproposta(proposta_id: str, input: PropostaInput, principal: Principal = Depends(require("lead:update"))):
    d, n = await _proposta(proposta_id, principal, "lead:update")
    if _status(d) not in ("enviada", "expirada"):
        raise HTTPException(409, "Esta proposta já foi respondida")
    autor = "proprietario" if d["autor"] == "cliente" else "cliente"
    novo = await _novo(n, input.model_copy(update={"autor": autor}), principal, "contraproposta", d)
    await db.propostas.update_one({"id": d["id"]}, {"$set": {"status": "contraproposta", "respondida_em": now_utc()}})
    quem = "do proprietário" if autor == "proprietario" else "do cliente"
    await registrar(n["id"], "proposta", f"Contraproposta {quem} ({novo['numero']}): {_brl(input.valor)}", principal)
    return await _saida(novo)


@router.post("/propostas/{proposta_id}/cancelar", response_model=Proposta)
async def cancelar(proposta_id: str, principal: Principal = Depends(require("lead:update"))):
    d, n = await _proposta(proposta_id, principal, "lead:update")
    if d["status"] not in ("enviada",):
        raise HTTPException(409, "Só propostas aguardando resposta podem ser canceladas")
    await db.propostas.update_one({"id": d["id"]}, {"$set": {"status": "cancelada", "respondida_em": now_utc()}})
    await registrar(n["id"], "proposta", f"Proposta {d['numero']} cancelada", principal)
    return await _saida(await db.propostas.find_one({"id": d["id"]}))


@router.get("/propostas/{proposta_id}/pdf")
async def pdf(proposta_id: str, principal: Principal = Depends(require("lead:read"))):
    from lib.pdf import gerar_proposta_pdf
    from routers.assinaturas import _cor

    d, n = await _proposta(proposta_id, principal)
    cliente = await db.pessoas.find_one({"id": n.get("cliente_id")}) if n.get("cliente_id") else None
    corretor = await db.pessoas.find_one({"id": n.get("corretor_id")}, {"nome": 1}) if n.get("corretor_id") else None
    im = await db.imoveis.find_one({"id": d.get("imovel_id")}) if d.get("imovel_id") else None
    config = await db.configuracoes.find_one({"id": "singleton"}, {"cor_primaria": 1, "logo_base64": 1, "nome_software": 1}) or {}
    empresa = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1}) if empresa_atual_db() else None
    nome_empresa = (empresa or {}).get("nome") or config.get("nome_software") or "Imobiliária"
    finalidade = "locação" if im and im.get("finalidade") == "locacao" else "compra"
    linhas = [
        ("Proponente", f"{(cliente or {}).get('nome') or n['nome']}" + (f" · CPF {cliente['cpf_cnpj']}" if cliente and cliente.get("cpf_cnpj") else "")),
        ("Imóvel", f"{im.get('codigo', '')} · {im['titulo']} — {im.get('endereco', '')}, {im.get('bairro') or ''} {im.get('cidade', '')}" if im else "—"),
        ("Valor proposto", _brl(d["valor"])),
    ]
    pedido = (im or {}).get("valor_aluguel" if finalidade == "locação" else "valor_venda")
    if pedido:
        linhas.append(("Valor anunciado", _brl(pedido)))
    linhas.append(("Forma de pagamento", ", ".join(FORMA_LABEL.get(f, f) for f in d.get("formas_pagamento", []))))
    if d.get("sinal"):
        linhas.append(("Sinal / entrada", _brl(d["sinal"])))
    if d.get("valor_financiado"):
        linhas.append(("Valor financiado", _brl(d["valor_financiado"])))
    linhas.append(("Validade", f"{d['validade'][8:10]}/{d['validade'][5:7]}/{d['validade'][:4]}" if d.get("validade") else "Não informada"))
    linhas.append(("Situação", STATUS_LABEL.get(_status(d), d["status"])))
    cadeia = []
    atual = d
    while atual.get("parent_id"):
        atual = await db.propostas.find_one({"id": atual["parent_id"]}) or {}
        if not atual:
            break
        cadeia.append(f"{atual['numero']} · {'Cliente' if atual['autor'] == 'cliente' else 'Proprietário'}: {_brl(atual['valor'])} "
                      f"em {utc_aware(atual['created_at']).strftime('%d/%m/%Y')}")
    tipo = "Contraproposta" if d["tipo"] == "contraproposta" else "Proposta"
    titulo = f"{tipo} de {finalidade}" + (" (do proprietário)" if d["autor"] == "proprietario" else "")
    conteudo = gerar_proposta_pdf(
        empresa=nome_empresa, numero=d["numero"], titulo=titulo, linhas=linhas, condicoes=d.get("condicoes"),
        proponente=(cliente or {}).get("nome") or n["nome"] if d["autor"] == "cliente" else "Proprietário",
        corretor=(corretor or {}).get("nome"), historico=list(reversed(cadeia)), cor_primaria=_cor(config),
        logo_base64=config.get("logo_base64"),
    )
    return Response(conteudo, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename={d['numero']}.pdf"})


@router.get("/imoveis/{imovel_id}/propostas", response_model=List[Proposta])
async def do_imovel(imovel_id: str, principal: Principal = Depends(require("imovel:read"))):
    escopo = filtro_do_principal(principal, "leads")
    filtro = {"imovel_id": imovel_id, **escopo}
    cache: dict = {}
    return [await _saida(d, cache) async for d in db.propostas.find(filtro).sort("created_at", -1).limit(100)]
