from fastapi import Query, Response
from lib.integrity import page
"""Contratos — lead ganho → contrato com vigência e partes, gerando as parcelas financeiras.

RBAC: o corretor cria o contrato do próprio lead e enxerga só os seus; editar valores/vigência e
excluir é exclusivo do admin.
"""

from datetime import date, datetime
from uuid import uuid5, NAMESPACE_URL
from pymongo.errors import DuplicateKeyError
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.integrity import audit, reference, sequence, percentage, split_money, cents, operation_lock
from lib.validation import patch_data
from lib.dates import today_iso
from lib.db import db
from models.common import now_utc, utc_aware
from models.contratos import Contrato, ContratoCreate, ContratoDetalhe, ContratoUpdate
from models.financeiro import TransacaoFinanceira

router = APIRouter(prefix="/contratos", tags=["contratos"])

CODIGO_COMISSAO_VENDA = "1.1.1"
CODIGO_COMISSAO_LOCACAO = "1.1.2"
CODIGO_TAXA_ADMIN = "1.2.1"


def to_contrato(doc: dict) -> Contrato:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    return Contrato(**data)


def _soma_meses(iso: str, meses: int, dia: int) -> str:
    y, m, _ = (int(p) for p in iso[:10].split("-"))
    total = (m - 1) + meses
    y += total // 12
    m = total % 12 + 1
    ultimo = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
              31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return f"{y:04d}-{m:02d}-{min(max(dia, 1), ultimo):02d}"


def _meses_entre(inicio: str, fim: str) -> int:
    yi, mi, di = (int(p) for p in inicio[:10].split("-"))
    yf, mf, df = (int(p) for p in fim[:10].split("-"))
    meses = (yf - yi) * 12 + (mf - mi) + (1 if df > di else 0)
    return max(meses, 1)


async def _conta_id(codigo: str) -> str | None:
    doc = await db.plano_contas.find_one({"codigo": codigo})
    return doc["id"] if doc else None


async def _proximo_numero() -> str:
    return await sequence(db.contratos, "numero", f"CT-{today_iso()[:4]}-")


def _vencimento(contrato, parcela: int) -> str:
    first = _soma_meses(contrato.inicio, 0, contrato.dia_vencimento)
    shift = 1 if first < contrato.inicio else 0
    return _soma_meses(contrato.inicio, parcela + shift, contrato.dia_vencimento)


async def _gerar_parcelas(contrato: Contrato) -> int:
    """Gera as contas a receber do contrato. Venda: comissão parcelada. Locação: taxa de
    administração por mês de vigência + comissão de locação na primeira parcela."""
    for code in ([CODIGO_COMISSAO_VENDA] if contrato.tipo == "venda" else [CODIGO_TAXA_ADMIN, CODIGO_COMISSAO_LOCACAO]):
        if not await _conta_id(code): raise HTTPException(409, "Plano de contas obrigatório ausente")
    lancamentos: list[TransacaoFinanceira] = []

    if contrato.tipo == "venda":
        conta = await _conta_id(CODIGO_COMISSAO_VENDA)
        if conta:
            total = percentage(contrato.valor, contrato.comissao_pct)
            valores = split_money(total, contrato.parcelas)
            for i in range(contrato.parcelas) if total > 0 else []:
                lancamentos.append(
                    TransacaoFinanceira(
                        descricao=f"{contrato.numero} · Comissão de venda {i + 1}/{contrato.parcelas}",
                        tipo="receber",
                        valor=valores[i],
                        plano_conta_id=conta,
                        imovel_id=contrato.imovel_id,
                        pessoa_id=contrato.cliente_id,
                        corretor_id=contrato.corretor_id,
                        contrato_id=contrato.id,
                        vencimento=_vencimento(contrato, i),
                    )
                )
    else:
        conta_admin = await _conta_id(CODIGO_TAXA_ADMIN)
        if conta_admin:
            taxa = percentage(contrato.valor, contrato.taxa_admin_pct)
            if taxa > 0:
                for i in range(contrato.parcelas):
                    lancamentos.append(
                        TransacaoFinanceira(
                            descricao=f"{contrato.numero} · Taxa de administração {i + 1}/{contrato.parcelas}",
                            tipo="receber",
                            valor=taxa,
                            plano_conta_id=conta_admin,
                            imovel_id=contrato.imovel_id,
                            pessoa_id=contrato.cliente_id,
                            corretor_id=contrato.corretor_id,
                            contrato_id=contrato.id,
                            vencimento=_vencimento(contrato, i),
                        )
                    )
        conta_com = await _conta_id(CODIGO_COMISSAO_LOCACAO)
        comissao = percentage(contrato.valor, contrato.comissao_pct)
        if conta_com and comissao > 0:
            lancamentos.append(
                TransacaoFinanceira(
                    descricao=f"{contrato.numero} · Comissão de locação (intermediação)",
                    tipo="receber",
                    valor=comissao,
                    plano_conta_id=conta_com,
                    imovel_id=contrato.imovel_id,
                    pessoa_id=contrato.cliente_id,
                    corretor_id=contrato.corretor_id,
                    contrato_id=contrato.id,
                    vencimento=_vencimento(contrato, 0),
                )
            )

    for i, transacao in enumerate(lancamentos):
        event = f"contrato:{contrato.id}:parcela:{i}"
        data = transacao.model_dump()
        data.update(id=str(uuid5(NAMESPACE_URL, event)), evento_id=event)
        await db.transacoes.update_one({"_id": event}, {"$setOnInsert": data}, upsert=True)
    return len(lancamentos)


@router.get("", response_model=List[Contrato])
async def list_contratos(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000), principal: Principal = Depends(require("contrato:read"))):
    filtro = filtro_do_principal(principal, "contratos")
    docs = await page(db.contratos.find(filtro).sort("created_at", -1), response, offset, limit)
    return [to_contrato(d) for d in docs]


@router.get("/{contrato_id}", response_model=ContratoDetalhe)
async def get_contrato(contrato_id: str, principal: Principal = Depends(require("contrato:read"))):
    doc = await db.contratos.find_one({"id": contrato_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Contrato não encontrado")
    authorize(principal, "contrato:read", doc)

    transacoes = await db.transacoes.find({"contrato_id": contrato_id}).sort("vencimento", 1).to_list(None)
    hoje = today_iso()
    modelos = []
    for t in transacoes:
        m = TransacaoFinanceira(**t)
        m.vencido = m.status == "pendente" and m.vencimento < hoje
        modelos.append(m)

    async def nome(pid: str | None) -> str | None:
        if not pid:
            return None
        p = await db.pessoas.find_one({"id": pid})
        return p["nome"] if p else None

    imovel = await db.imoveis.find_one({"id": doc["imovel_id"]})
    return ContratoDetalhe(
        **to_contrato(doc).model_dump(),
        imovel_titulo=imovel["titulo"] if imovel else None,
        cliente_nome=await nome(doc.get("cliente_id")),
        proprietario_nome=await nome(doc.get("proprietario_id")),
        corretor_nome=await nome(doc.get("corretor_id")),
        total_gerado=round(sum(m.valor for m in modelos), 2),
        total_recebido=round(sum(m.valor for m in modelos if m.status == "pago"), 2),
        transacoes=modelos,
    )


@router.post("", response_model=ContratoDetalhe, status_code=201)
async def create_contrato(input: ContratoCreate, principal: Principal = Depends(require("contrato:create"))):
    from pymongo.errors import PyMongoError
    try:
        await db.contratos.create_index([("lead_id", 1)], name="active_lead_unique", unique=True,
            partialFilterExpression={"lead_id": {"$type": "string"}, "status": "ativo"})
    except PyMongoError:
        raise HTTPException(409, "Não foi possível garantir unicidade dos contratos; concilie os registros antigos antes de criar outro")
    imovel = await db.imoveis.find_one({"id": input.imovel_id})
    if not imovel:
        raise HTTPException(status_code=404, detail="Imóvel não encontrado")

    data = input.model_dump(exclude={"request_id"})
    for field in ("cliente_id", "proprietario_id", "corretor_id"):
        await reference("pessoas", data.get(field), principal)
    codes = [CODIGO_COMISSAO_VENDA] if input.tipo == "venda" else [CODIGO_TAXA_ADMIN, CODIGO_COMISSAO_LOCACAO]
    for code in codes:
        if not await _conta_id(code): raise HTTPException(409, "Plano de contas obrigatório ausente")
    lead = None
    if input.lead_id:
        lead = await db.leads.find_one({"id": input.lead_id})
        if not lead:
            raise HTTPException(status_code=404, detail="Lead não encontrado")
        authorize(principal, "contrato:create", lead)  # lead de outro corretor → 404
        if lead.get("estagio") != "ganho" and lead.get("status") != "ganho":
            raise HTTPException(status_code=409, detail="Só é possível contratar um lead no estágio Ganho")
        existing = await db.contratos.find_one({"lead_id": input.lead_id, "status": {"$ne": "cancelado"}})
        if existing:
            if input.request_id and existing.get("request_id") == input.request_id:
                if existing.get("request_payload") != input.model_dump():
                    raise HTTPException(409, "Chave reutilizada com dados diferentes")
                return await _concluir(existing, principal)
            raise HTTPException(409, "Este lead já possui um contrato; utilize o registro existente")
        if lead.get("imovel_id") and lead["imovel_id"] != input.imovel_id:
            raise HTTPException(422, "O imóvel do contrato deve corresponder ao lead")
        data["cliente_id"] = data.get("cliente_id") or lead.get("cliente_id")
        data["corretor_id"] = data.get("corretor_id") or lead.get("corretor_id")

    # Dono vem do principal quando é corretor — nunca do corpo.
    if not principal.is_admin:
        data["corretor_id"] = principal.pessoa_id
    data["proprietario_id"] = data.get("proprietario_id") or imovel.get("proprietario_id")

    if data["tipo"] == "locacao" and not data.get("fim"):
        raise HTTPException(status_code=422, detail="Informe o fim da vigência para contratos de locação")
    if data.get("fim") and data["fim"] < data["inicio"]:
        raise HTTPException(status_code=422, detail="O fim da vigência não pode ser antes do início")

    parcelas = data.pop("parcelas", None)
    if not parcelas:
        parcelas = 1 if data["tipo"] == "venda" else _meses_entre(data["inicio"], data["fim"])
    dia = data.pop("dia_vencimento", None) or int(data["inicio"][8:10])

    if data["tipo"] == "venda" and 0 < cents(percentage(data["valor"], data["comissao_pct"])) < parcelas:
        raise HTTPException(422, "Número de parcelas supera o valor da comissão em centavos")

    contrato = Contrato(
        **data, numero=await _proximo_numero(), parcelas=max(1, int(parcelas)), dia_vencimento=dia, financeiro_status="pendente"
    )
    request_id = input.request_id
    document = contrato.model_dump()
    if request_id:
        document["_id"] = f"request:{request_id}"
        document["request_id"] = request_id
        document["request_payload"] = input.model_dump()
    try:
        await db.contratos.insert_one(document)
    except DuplicateKeyError:
        existing = await db.contratos.find_one({"request_id": request_id}) if request_id else None
        if not existing: raise HTTPException(409, "Contrato já criado; atualize a lista")
        authorize(principal, "contrato:read", existing)
        if existing.get("request_payload") != input.model_dump(): raise HTTPException(409, "Chave reutilizada com dados diferentes")
        for key in ("imovel_id", "lead_id", "tipo", "valor", "comissao_pct", "taxa_admin_pct", "inicio", "fim"):
            if existing.get(key) != document.get(key): raise HTTPException(409, "Chave de operação reutilizada com dados diferentes")
        document = existing
    else:
        if document.get("lead_id"):
            from lib.crm import registrar
            await registrar(document["lead_id"], "contrato", f"Contrato {document['numero']} criado", principal)
    return await _concluir(document, principal)


@operation_lock("contratos")
async def _concluir(doc: dict, principal: Principal):
    authorize(principal, "contrato:read", doc)
    if doc.get("status") != "ativo": raise HTTPException(409, "Contrato não está ativo")
    if "financeiro_status" not in doc:
        raise HTTPException(409, "Contrato anterior à migração: concilie os títulos existentes antes de reprocessar")
    if doc.get("financeiro_status") != "concluido":
        try:
            await _gerar_parcelas(to_contrato(doc))
            await db.imoveis.update_one({"id": doc["imovel_id"]}, {"$set": {"status": "vendido" if doc["tipo"] == "venda" else "alugado", "updated_at": now_utc()}})
            await db.contratos.update_one({"id": doc["id"]}, {"$set": {"financeiro_status": "concluido"}})
            await audit(principal, "contrato.financeiro", doc["id"])
        except Exception:
            await db.contratos.update_one({"id": doc["id"]}, {"$set": {"financeiro_status": "erro"}})
            raise HTTPException(503, "Contrato preservado; financeiro pendente. Reprocesse o contrato.")
    return await get_contrato(doc["id"], principal)


@router.post("/{contrato_id}/reprocessar", response_model=ContratoDetalhe)
async def reprocessar(contrato_id: str, principal: Principal = Depends(require("contrato:create"))):
    doc = await db.contratos.find_one({"id": contrato_id})
    if not doc: raise HTTPException(404, "Contrato não encontrado")
    if doc.get("status") != "ativo": raise HTTPException(409, "Somente contratos ativos podem ser reprocessados")
    return await _concluir(doc, principal)


@router.patch("/{contrato_id}", response_model=Contrato)
@operation_lock("contratos")
async def update_contrato(contrato_id: str, input: ContratoUpdate, principal: Principal = Depends(require("contrato:update"))):
    doc = await db.contratos.find_one({"id": contrato_id})
    if not doc: raise HTTPException(404, "Contrato não encontrado")
    data = patch_data(input, ("valor", "comissao_pct", "taxa_admin_pct", "inicio", "status"))
    candidate = {**doc, **data}
    if candidate.get("fim") and candidate["fim"] < candidate["inicio"]:
        raise HTTPException(422, "Vigência inválida")
    if candidate["tipo"] == "locacao" and not candidate.get("fim"):
        raise HTTPException(422, "Locação exige fim da vigência")
    changed = any(k in data and data[k] != doc.get(k) for k in ("valor", "comissao_pct", "taxa_admin_pct", "inicio", "fim"))
    if changed:
        raise HTTPException(409, "Contrato possui títulos: preserve o histórico e registre um novo contrato/aditivo")
    if doc["status"] != "ativo" and data.get("status") == "ativo":
        raise HTTPException(409, "Contrato encerrado/cancelado não pode ser reaberto; crie novo contrato")
    data["updated_at"] = now_utc()
    await db.contratos.update_one({"id": contrato_id}, {"$set": data})
    if data.get("status") in {"encerrado", "cancelado"}:
        filter_ = {"contrato_id": contrato_id, "status": "pendente"}
        if data["status"] == "encerrado": filter_["vencimento"] = {"$gt": today_iso()}
        await db.transacoes.update_many(filter_, {"$set": {"status": "cancelado", "cancelado_em": now_utc()}})
    await audit(principal, "contrato.update", contrato_id, {k: doc.get(k) for k in data}, data)
    return to_contrato(await db.contratos.find_one({"id": contrato_id}))


@router.delete("/{contrato_id}", status_code=204)
async def delete_contrato(contrato_id: str, principal: Principal = Depends(require("contrato:delete"))):
    await update_contrato(contrato_id, ContratoUpdate(status="cancelado"), principal)
    return None
