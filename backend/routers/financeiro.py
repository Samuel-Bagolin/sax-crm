from fastapi import Query, Response
from lib.integrity import page
"""Router financeiro — plano de contas, lançamentos e relatórios.

Visibilidade: o admin vê o financeiro da imobiliária inteiro. O corretor vê APENAS as
comissões dos próprios negócios (predicado `corretor_id` na query) e não acessa fluxo de
caixa, DRE por imóvel nem escrita de lançamentos.
"""

from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response

from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.integrity import audit, reference, money
from lib.validation import patch_data
from lib.dates import today_iso
from lib.db import db
from lib.pdf import gerar_recibo
from routers.config import carregar as carregar_config
from models.common import utc_aware, now_utc
from models.financeiro import (
    DreImovel,
    FluxoMes,
    PlanoConta,
    PlanoContaCreate,
    PlanoContaUpdate,
    ResumoFinanceiro,
    TransacaoCreate,
    TransacaoFinanceira,
    TransacaoUpdate,
)
from models.usuarios import MinhasComissoes

router = APIRouter(tags=["financeiro"])


def to_transacao(doc: dict) -> TransacaoFinanceira:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    t = TransacaoFinanceira(**data)
    if t.status == "pendente" and t.vencimento < today_iso():
        t.vencido = True
    return t


def to_conta(doc: dict) -> PlanoConta:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    return PlanoConta(**data)


# ---------- Plano de contas (leitura: ambos; escrita: admin) ----------


@router.get("/plano-contas", response_model=List[PlanoConta])
async def list_plano_contas(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000), principal: Principal = Depends(require("plano:read"))):
    docs = await page(db.plano_contas.find().sort("codigo", 1), response, offset, limit)
    return [to_conta(d) for d in docs]


@router.post("/plano-contas", response_model=PlanoConta, status_code=201)
async def create_plano_conta(input: PlanoContaCreate, principal: Principal = Depends(require("plano:write"))):
    if input.conta_pai_id:
        pai = await db.plano_contas.find_one({"id": input.conta_pai_id})
        if not pai:
            raise HTTPException(status_code=404, detail="Conta pai não encontrada")
    if await db.plano_contas.find_one({"codigo": input.codigo}):
        raise HTTPException(409, "Código de conta já cadastrado")
    if input.conta_pai_id and pai["tipo"] != input.tipo:
        raise HTTPException(422, "Conta e conta pai devem ter o mesmo tipo")
    conta = PlanoConta(**input.model_dump())
    await db.plano_contas.insert_one(conta.model_dump())
    return conta


@router.put("/plano-contas/{conta_id}", response_model=PlanoConta)
async def update_plano_conta(
    conta_id: str, input: PlanoContaUpdate, principal: Principal = Depends(require("plano:write"))
):
    doc = await db.plano_contas.find_one({"id": conta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    data = patch_data(input, ("codigo", "nome", "tipo"))
    parent_id = data.get("conta_pai_id")
    visited = {conta_id}
    while parent_id:
        if parent_id in visited: raise HTTPException(409, "Hierarquia de contas não pode conter ciclos")
        visited.add(parent_id)
        parent = await reference("plano_contas", parent_id)
        if parent["tipo"] != data.get("tipo", doc["tipo"]): raise HTTPException(422, "Tipos de conta incompatíveis")
        parent_id = parent.get("conta_pai_id")
    if data.get("codigo") and data["codigo"] != doc["codigo"] and await db.plano_contas.find_one({"codigo": data["codigo"]}):
        raise HTTPException(409, "Código de conta já cadastrado")
    if data.get("tipo") and data["tipo"] != doc["tipo"] and (await db.transacoes.find_one({"plano_conta_id": conta_id}) or await db.plano_contas.find_one({"conta_pai_id": conta_id})):
        raise HTTPException(409, "Conta em uso não pode mudar de tipo")
    if data.get("conta_pai_id") == conta_id:
        raise HTTPException(status_code=409, detail="Uma conta não pode ser pai de si mesma")
    if data:
        await db.plano_contas.update_one({"id": conta_id}, {"$set": data})
        doc.update(data)
    return to_conta(doc)


@router.delete("/plano-contas/{conta_id}", status_code=204)
async def delete_plano_conta(conta_id: str, principal: Principal = Depends(require("plano:write"))):
    if await db.plano_contas.find_one({"conta_pai_id": conta_id}):
        raise HTTPException(status_code=409, detail="Esta conta possui subcontas — remova-as primeiro")
    if await db.transacoes.find_one({"plano_conta_id": conta_id}):
        raise HTTPException(status_code=409, detail="Esta conta possui lançamentos vinculados")
    await db.plano_contas.delete_one({"id": conta_id})
    return None


# ---------- Lançamentos (leitura escopada; escrita só do admin) ----------


@router.get("/transacoes", response_model=List[TransacaoFinanceira])
async def list_transacoes(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000), principal: Principal = Depends(require("transacao:read"))):
    filtro = filtro_do_principal(principal, "transacoes")
    if not principal.is_admin:
        accounts = await db.plano_contas.find({"codigo": {"$in": ["1.1.1", "1.1.2"]}}).to_list(None)
        filtro["plano_conta_id"] = {"$in": [a["id"] for a in accounts]}
    docs = await page(db.transacoes.find(filtro).sort("vencimento", -1), response, offset, limit)
    return [to_transacao(d) for d in docs]


@router.post("/transacoes", response_model=TransacaoFinanceira, status_code=201)
async def create_transacao(input: TransacaoCreate, principal: Principal = Depends(require("transacao:write"))):
    data = input.model_dump()
    await _validar_transacao(data)
    t = TransacaoFinanceira(**data)
    await db.transacoes.insert_one(t.model_dump())
    await audit(principal, "transacao.create", t.id, after={"valor": t.valor, "status": t.status})
    return t


@router.patch("/transacoes/{transacao_id}", response_model=TransacaoFinanceira)
async def update_transacao(
    transacao_id: str, input: TransacaoUpdate, principal: Principal = Depends(require("transacao:write"))
):
    doc = await db.transacoes.find_one({"id": transacao_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    authorize(principal, "transacao:write", doc)
    data = patch_data(input, ("descricao", "tipo", "valor", "plano_conta_id", "vencimento", "status"))
    if doc.get("status") == "cancelado": raise HTTPException(409, "Lançamento cancelado não pode ser alterado")
    if doc.get("status") == "pago" and any(k in data and data[k] != doc.get(k) for k in ("valor", "tipo", "plano_conta_id", "status", "pagamento")):
        raise HTTPException(409, "Lançamento liquidado exige estorno auditado; não altere sua baixa")
    if doc.get("contrato_id") and any(k in data and data[k] != doc.get(k) for k in ("valor", "tipo", "plano_conta_id", "vencimento")):
        raise HTTPException(409, "Parcela de contrato não pode ser alterada isoladamente")
    candidate = {**doc, **data}
    if candidate.get("status") == "pago" and not candidate.get("pagamento"):
        candidate["pagamento"] = today_iso()
    await _validar_transacao(candidate)
    data.update(pagamento=candidate.get("pagamento"), valor=candidate["valor"])
    if data:
        result = await db.transacoes.update_one({"id": transacao_id, "status": doc["status"], "valor": doc["valor"]}, {"$set": data})
        if not result.matched_count: raise HTTPException(409, "Título alterado por outra operação; atualize a tela")
        await audit(principal, "transacao.update", transacao_id, {k:doc.get(k) for k in data}, data)
        doc.update(data)
    return to_transacao(doc)


@router.get("/transacoes/{transacao_id}/recibo")
async def recibo_pdf(transacao_id: str, principal: Principal = Depends(require("transacao:read"))):
    """Recibo em PDF gerado no servidor — apenas de parcela/lançamento já PAGO."""
    doc = await db.transacoes.find_one({"id": transacao_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    authorize(principal, "transacao:read", doc)  # parcela de outro corretor responde 404
    if doc.get("status") != "pago":
        raise HTTPException(status_code=409, detail="O recibo só é emitido após o pagamento")

    config = await carregar_config()
    pagador = "Cliente"
    if doc.get("pessoa_id"):
        pessoa = await db.pessoas.find_one({"id": doc["pessoa_id"]})
        if pessoa:
            pagador = pessoa["nome"]
    imovel_txt = None
    if doc.get("imovel_id"):
        imovel = await db.imoveis.find_one({"id": doc["imovel_id"]})
        if imovel:
            imovel_txt = f"{imovel.get('codigo', '')} {imovel['titulo']}".strip()
    contrato_txt = None
    if doc.get("contrato_id"):
        contrato = await db.contratos.find_one({"id": doc["contrato_id"]})
        if contrato:
            contrato_txt = contrato["numero"]

    pdf = gerar_recibo(
        numero=doc["id"][:8].upper(),
        emitente=config.nome_software,
        pagador=pagador,
        descricao=doc["descricao"],
        valor=doc["valor"],
        pagamento=doc.get("pagamento"),
        vencimento=doc["vencimento"],
        imovel=imovel_txt,
        contrato=contrato_txt,
        cor_primaria=config.cor_primaria,
        logo_base64=config.logo_base64,
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="recibo-{doc["id"][:8]}.pdf"'},
    )


@router.delete("/transacoes/{transacao_id}", status_code=204)
async def delete_transacao(transacao_id: str, principal: Principal = Depends(require("transacao:write"))):
    doc = await db.transacoes.find_one({"id": transacao_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    authorize(principal, "transacao:write", doc)
    if doc.get("status") == "pago": raise HTTPException(409, "Lançamento liquidado não pode ser excluído; use estorno")
    result = await db.transacoes.update_one({"id": transacao_id, "status": {"$ne": "pago"}}, {"$set": {"status": "cancelado", "cancelado_em": now_utc()}})
    if not result.matched_count: raise HTTPException(409, "Título liquidado em outra operação; atualize a tela")
    await audit(principal, "transacao.cancel", transacao_id)
    return None


# ---------- Relatórios ----------


@router.get("/minhas-comissoes", response_model=MinhasComissoes)
async def minhas_comissoes(principal: Principal = Depends(require("transacao:read"))):
    """Painel financeiro do corretor: só as comissões dele (admin vê o total da casa)."""
    filtro = filtro_do_principal(principal, "transacoes")
    contas_comissao = await db.plano_contas.find({"codigo": {"$in": ["1.1.1", "1.1.2"]}}).to_list(None)
    docs = await db.transacoes.find({**filtro, "tipo": "receber", "plano_conta_id": {"$in": [c["id"] for c in contas_comissao]}, "status": {"$ne": "cancelado"}}).to_list(None)
    recebidas = sum(float(d["valor"]) for d in docs if d.get("status") == "pago" and d.get("pagamento"))
    a_receber = sum(float(d["valor"]) for d in docs if d.get("status") == "pendente")

    leads = await db.leads.find(filtro_do_principal(principal, "leads")).to_list(None)
    return MinhasComissoes(
        comissoes_recebidas=round(recebidas, 2),
        comissoes_a_receber=round(a_receber, 2),
        total_leads=len(leads),
        leads_ganhos=sum(1 for l in leads if l["estagio"] == "ganho"),
    )


@router.get("/resumo", response_model=ResumoFinanceiro)
async def resumo(principal: Principal = Depends(require("financeiro:empresa"))):
    hoje = date.fromisoformat(today_iso())
    mes_atual = hoje.strftime("%Y-%m")

    def ultimos_meses(n: int) -> list[str]:
        y, m = hoje.year, hoje.month
        meses = []
        for _ in range(n):
            meses.append(f"{y:04d}-{m:02d}")
            m -= 1
            if m == 0:
                m, y = 12, y - 1
        return list(reversed(meses))

    meses = ultimos_meses(6)
    docs = await db.transacoes.find().to_list(None)

    fluxo = {m: {"receitas": 0.0, "despesas": 0.0} for m in meses}
    a_receber_pendente = a_pagar_pendente = recebido_mes = pago_mes = 0.0
    for d in docs:
        tipo = d.get("tipo")
        valor = float(d.get("valor") or 0)
        pago = d.get("pagamento") if d.get("status") == "pago" else None
        if d.get("status") == "pendente":
            if tipo == "receber":
                a_receber_pendente += valor
            else:
                a_pagar_pendente += valor
        if pago:
            mes = pago[:7]
            if mes == mes_atual:
                if tipo == "receber":
                    recebido_mes += valor
                else:
                    pago_mes += valor
            if mes in fluxo:
                if tipo == "receber":
                    fluxo[mes]["receitas"] += valor
                else:
                    fluxo[mes]["despesas"] += valor

    fluxo_mensal = [
        FluxoMes(
            mes=m,
            receitas=round(fluxo[m]["receitas"], 2),
            despesas=round(fluxo[m]["despesas"], 2),
            saldo=round(fluxo[m]["receitas"] - fluxo[m]["despesas"], 2),
        )
        for m in meses
    ]

    imoveis = await db.imoveis.find().to_list(None)
    dre: list[DreImovel] = []
    for im in imoveis:
        iid = im["id"]
        receitas = sum(float(d["valor"]) for d in docs
                       if d.get("imovel_id") == iid and d.get("tipo") == "receber" and d.get("status") == "pago" and d.get("pagamento"))
        despesas = sum(float(d["valor"]) for d in docs
                       if d.get("imovel_id") == iid and d.get("tipo") == "pagar" and d.get("status") == "pago" and d.get("pagamento"))
        a_rec = sum(float(d["valor"]) for d in docs
                    if d.get("imovel_id") == iid and d.get("tipo") == "receber" and d.get("status") == "pendente")
        a_pag = sum(float(d["valor"]) for d in docs
                    if d.get("imovel_id") == iid and d.get("tipo") == "pagar" and d.get("status") == "pendente")
        dre.append(DreImovel(
            imovel_id=iid,
            titulo=im["titulo"],
            receitas=round(receitas, 2),
            despesas=round(despesas, 2),
            resultado=round(receitas - despesas, 2),
            a_receber=round(a_rec, 2),
            a_pagar=round(a_pag, 2),
        ))
    dre.sort(key=lambda d: d.resultado, reverse=True)

    return ResumoFinanceiro(
        a_receber_pendente=round(a_receber_pendente, 2),
        a_pagar_pendente=round(a_pagar_pendente, 2),
        recebido_mes=round(recebido_mes, 2),
        pago_mes=round(pago_mes, 2),
        fluxo_mensal=fluxo_mensal,
        dre_imoveis=dre,
    )


async def _validar_transacao(data: dict):
    conta = await reference("plano_contas", data.get("plano_conta_id"))
    if not conta: raise HTTPException(422, "Conta obrigatória")
    if await db.plano_contas.find_one({"conta_pai_id": conta["id"]}):
        raise HTTPException(422, "Utilize uma conta analítica")
    if conta["tipo"] != ("receita" if data["tipo"] == "receber" else "despesa"):
        raise HTTPException(422, "Tipo do lançamento incompatível com a conta")
    for field, collection in (("imovel_id", "imoveis"), ("pessoa_id", "pessoas"), ("corretor_id", "pessoas")):
        await reference(collection, data.get(field))
    if data.get("status") != "pago" and data.get("pagamento"):
        raise HTTPException(422, "Data de pagamento exige status pago")
    if data.get("status") == "pago" and not data.get("pagamento"): data["pagamento"] = today_iso()
    data["valor"] = money(data["valor"])
    if data["valor"] <= 0: raise HTTPException(422, "Valor deve ser ao menos um centavo")
