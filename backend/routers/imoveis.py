from fastapi import Query, Response
from lib.integrity import page
"""Router de imóveis — leitura liberada aos dois perfis; exclusão só do admin."""

from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from lib.auth import Principal, filtro_do_principal, require
from lib.db import db
from lib.integrity import reference, sequence
from lib.validation import patch_data
from models.common import now_utc, utc_aware
from models.financeiro import TransacaoFinanceira
from models.imoveis import ContratoVigente, Imovel, ImovelCreate, ImovelDetalhe, ImovelUpdate
from models.leads import Lead
from models.pessoas import Pessoa

router = APIRouter(prefix="/imoveis", tags=["imoveis"])


def to_imovel(doc: dict) -> Imovel:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    return Imovel(**data)


def to_transacao(doc: dict) -> TransacaoFinanceira:
    from lib.dates import today_iso

    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    t = TransacaoFinanceira(**data)
    if t.status == "pendente" and t.vencimento < today_iso():
        t.vencido = True
    return t


def to_lead(doc: dict) -> Lead:
    data = dict(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    data["closed_at"] = utc_aware(data.get("closed_at"))
    return Lead(**data)


PREFIXO_CODIGO = {"apartamento": "AP", "casa": "CA", "terreno": "TE", "comercial": "CM"}


async def _proximo_codigo(tipo: str) -> str:
    """Código exclusivo por tipo, derivado do MAIOR já emitido (contar documentos duplicaria
    após uma exclusão). O índice único em `imoveis.codigo` é a garantia final."""
    return await sequence(db.imoveis, "codigo", PREFIXO_CODIGO.get(tipo, "IM") + "-")


@router.get("", response_model=List[Imovel])
async def list_imoveis(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000), principal: Principal = Depends(require("imovel:read"))):
    docs = await page(db.imoveis.find().sort("created_at", -1), response, offset, limit)
    return [to_imovel(d) for d in docs]


@router.get("/{imovel_id}", response_model=ImovelDetalhe)
async def get_imovel(imovel_id: str, principal: Principal = Depends(require("imovel:read"))):
    doc = await db.imoveis.find_one({"id": imovel_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Imóvel não encontrado")
    imovel = to_imovel(doc)

    proprietario = None
    if imovel.proprietario_id:
        pdoc = await db.pessoas.find_one({"id": imovel.proprietario_id})
        if pdoc:
            from routers.pessoas import person_scope
            if not principal.is_admin and not await db.pessoas.find_one({"$and": [{"id": pdoc["id"]}, await person_scope(principal)]}):
                pdoc = {k: v for k, v in pdoc.items() if k in {"id", "nome", "papeis", "created_at"}}
            proprietario = Pessoa(**{**pdoc, "created_at": utc_aware(pdoc.get("created_at"))})

    # A ficha respeita a visibilidade: o corretor vê só os leads e lançamentos dele.
    escopo_leads = {"imovel_id": imovel_id, **filtro_do_principal(principal, "leads")}
    escopo_trans = {"imovel_id": imovel_id, **filtro_do_principal(principal, "transacoes")}
    trans_docs = await db.transacoes.find(escopo_trans).sort("vencimento", -1).to_list(None)
    lead_docs = await db.leads.find(escopo_leads).sort("created_at", -1).to_list(None)
    transacoes = [to_transacao(d) for d in trans_docs]

    # Quanto o imóvel já rendeu (dentro da visibilidade do principal)
    recebido = round(sum(t.valor for t in transacoes if t.tipo == "receber" and t.status == "pago"), 2)
    a_receber = round(
        sum(t.valor for t in transacoes if t.tipo == "receber" and t.status == "pendente"), 2
    )
    despesas = round(sum(t.valor for t in transacoes if t.tipo == "pagar" and t.status == "pago"), 2)

    # Contrato vigente do imóvel (respeitando ownership do corretor)
    escopo_contrato = {
        "imovel_id": imovel_id,
        "status": "ativo",
        **filtro_do_principal(principal, "contratos"),
    }
    cdoc = await db.contratos.find(escopo_contrato).sort("created_at", -1).to_list(1)
    contrato = None
    if cdoc:
        c = cdoc[0]
        parcelas_doc = await db.transacoes.find({"contrato_id": c["id"]}).to_list(None)

        async def _nome(pid: str | None) -> str | None:
            if not pid:
                return None
            p = await db.pessoas.find_one({"id": pid})
            return p["nome"] if p else None

        contrato = ContratoVigente(
            id=c["id"],
            numero=c["numero"],
            tipo=c["tipo"],
            valor=c["valor"],
            inicio=c["inicio"],
            fim=c.get("fim"),
            parcelas=c.get("parcelas", 1),
            cliente_nome=await _nome(c.get("cliente_id")),
            corretor_nome=await _nome(c.get("corretor_id")),
            total_gerado=round(sum(p["valor"] for p in parcelas_doc), 2),
            total_recebido=round(sum(p["valor"] for p in parcelas_doc if p.get("status") == "pago"), 2),
            parcelas_pagas=sum(1 for p in parcelas_doc if p.get("status") == "pago"),
        )

    return ImovelDetalhe(
        **imovel.model_dump(),
        proprietario=proprietario,
        transacoes=transacoes,
        leads=[to_lead(d) for d in lead_docs],
        contrato_vigente=contrato,
        rendimento_recebido=recebido,
        rendimento_a_receber=a_receber,
        despesas_pagas=despesas,
    )


def _depois_de_salvar(background: BackgroundTasks, imovel_id: str) -> None:
    """Avisa, em segundo plano, os negócios cujo perfil combina com o imóvel."""
    from lib.db import definir_empresa, empresa_atual_db
    from routers.match import avisar_novos_compativeis

    banco = empresa_atual_db()

    async def tarefa():
        definir_empresa(banco)
        try:
            await avisar_novos_compativeis(imovel_id)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("aviso de compatíveis falhou")
        finally:
            definir_empresa(None)

    background.add_task(tarefa)


@router.post("", response_model=Imovel, status_code=201)
async def create_imovel(input: ImovelCreate, background: BackgroundTasks, principal: Principal = Depends(require("imovel:create"))):
    from lib.planos import exigir_limite

    if input.status not in ("vendido", "alugado"):
        await exigir_limite("imoveis")
    await reference("pessoas", input.proprietario_id, principal)
    imovel = Imovel(**input.model_dump(), codigo=await _proximo_codigo(input.tipo))
    await db.imoveis.insert_one(imovel.model_dump())
    _depois_de_salvar(background, imovel.id)
    return imovel


@router.put("/{imovel_id}", response_model=Imovel)
async def update_imovel(
    imovel_id: str, input: ImovelUpdate, background: BackgroundTasks, principal: Principal = Depends(require("imovel:update"))
):
    doc = await db.imoveis.find_one({"id": imovel_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Imóvel não encontrado")
    data = patch_data(input, ("titulo", "tipo", "finalidade", "status", "endereco", "cidade", "quartos", "suites", "vagas",
                              "banheiros", "publicar_portais", "destaque_portal"))
    if doc.get("status") in ("vendido", "alugado") and data.get("status") in ("captado", "publicado"):
        from lib.planos import exigir_limite
        await exigir_limite("imoveis")
    await reference("pessoas", data.get("proprietario_id"), principal)
    data["updated_at"] = now_utc()
    await db.imoveis.update_one({"id": imovel_id}, {"$set": data})
    atualizado = await db.imoveis.find_one({"id": imovel_id})
    campos_match = {"tipo", "finalidade", "status", "bairro", "cidade", "quartos", "vagas", "area_util", "valor_venda", "valor_aluguel"}
    if any(k in data and data[k] != doc.get(k) for k in campos_match):
        _depois_de_salvar(background, imovel_id)
    return to_imovel(atualizado)


@router.delete("/{imovel_id}", status_code=204)
async def delete_imovel(imovel_id: str, principal: Principal = Depends(require("imovel:delete"))):
    vinculado = await db.leads.find_one({"imovel_id": imovel_id}) or await db.transacoes.find_one(
        {"imovel_id": imovel_id}
    )
    vinculado = vinculado or await db.contratos.find_one({"imovel_id": imovel_id}) or await db.visitas.find_one({"imovel_id": imovel_id})
    if vinculado:
        raise HTTPException(
            status_code=409,
            detail="Imóvel possui leads ou lançamentos vinculados — remova-os primeiro",
        )
    await db.imoveis.delete_one({"id": imovel_id})
    from routers.fotos_imovel import remover_todas
    await remover_todas(imovel_id)
    return None
