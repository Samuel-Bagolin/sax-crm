"""Negócios do CRM (coleção `leads`) — funil estilo Pipedrive.

O corretor só alcança os próprios negócios (predicado na query + L3 na escrita). O gestor vê
todos e pode filtrar por corretor.
"""

from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from lib import automacoes
from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.crm import carregar_crm_config, estagio_legado, registrar
from lib.dates import today_iso
from lib.db import db
from lib.integrity import audit, page, reference
from lib.validation import patch_data
from models.common import now_utc, utc_aware
from models.crm import EventoHistorico, MoverInput, NegocioResumo, NotaInput, PerderInput
from models.leads import ESTAGIOS_FECHADOS, Lead, LeadCreate, LeadMetricas, LeadUpdate, OrigemCount
from models.pessoas import Pessoa

router = APIRouter(prefix="/leads", tags=["crm"])


def to_lead(doc: dict) -> Lead:
    data = {k: v for k, v in doc.items() if k != "_id"}
    for campo in ("created_at", "updated_at", "closed_at", "etapa_desde"):
        data[campo] = utc_aware(data.get(campo))
    data.setdefault("status", data.get("estagio") if data.get("estagio") in ESTAGIOS_FECHADOS else "aberto")
    data["etiquetas"] = data.get("etiquetas") or []
    return Lead(**data)


async def _funil(funil_id: str | None) -> dict | None:
    if funil_id:
        return await db.funis.find_one({"id": funil_id})
    return await db.funis.find_one({"padrao": True}) or await db.funis.find_one({}, sort=[("ordem", 1)])


def _etapa(funil: dict, etapa_id: str | None) -> dict | None:
    for e in funil.get("etapas", []):
        if e["id"] == etapa_id:
            return e
    return None


async def resumir(docs: list[dict]) -> list[NegocioResumo]:
    """Resolve nomes em lote (sem N+1) e calcula a situação da próxima atividade."""
    if not docs:
        return []
    ids = [d["id"] for d in docs]
    pessoas_ids = {d.get(k) for d in docs for k in ("cliente_id", "corretor_id")} - {None}
    imoveis_ids = {d.get("imovel_id") for d in docs} - {None}
    pessoas = {p["id"]: p async for p in db.pessoas.find({"id": {"$in": list(pessoas_ids)}})}
    imoveis = {i["id"]: i async for i in db.imoveis.find({"id": {"$in": list(imoveis_ids)}}, {"id": 1, "titulo": 1, "codigo": 1})}
    veiculos_ids = {d.get("veiculo_id") for d in docs} - {None}
    if veiculos_ids:  # loja de veículos: o card mostra o veículo no lugar do imóvel
        from routers.veiculos import titulo as titulo_veiculo

        async for v in db.veiculos.find({"id": {"$in": list(veiculos_ids)}}):
            imoveis[v["id"]] = {"id": v["id"], "titulo": titulo_veiculo(v), "codigo": v.get("codigo")}
    usuarios = {u["pessoa_id"]: u async for u in db.usuarios.find(
        {"pessoa_id": {"$in": list(pessoas_ids)}}, {"id": 1, "pessoa_id": 1, "tem_foto": 1, "cor": 1})}
    proximas: dict[str, dict] = {}
    async for a in db.atividades.find({"negocio_id": {"$in": ids}, "concluida": False}).sort([("data", 1), ("hora", 1)]):
        proximas.setdefault(a["negocio_id"], a)
    contratos = {c["lead_id"]: c["id"] async for c in db.contratos.find(
        {"lead_id": {"$in": ids}, "status": {"$ne": "cancelado"}}, {"lead_id": 1, "id": 1})}
    funis = {f["id"]: f async for f in db.funis.find({})}
    hoje = today_iso()
    agora = now_utc()

    saida = []
    for d in docs:
        lead = to_lead(d)
        cliente = pessoas.get(lead.cliente_id or "")
        corretor = pessoas.get(lead.corretor_id or "")
        usuario = usuarios.get(lead.corretor_id or "")
        imovel = imoveis.get(lead.imovel_id or d.get("veiculo_id") or "")
        prox = proximas.get(lead.id)
        situacao = "nenhuma"
        if prox:
            situacao = "atrasada" if prox["data"] < hoje else "hoje" if prox["data"] == hoje else "futura"
        parado = False
        funil = funis.get(lead.funil_id or "")
        etapa = _etapa(funil, lead.etapa_id) if funil else None
        if lead.status == "aberto" and etapa and etapa.get("dias_parado") and lead.etapa_desde:
            parado = agora - lead.etapa_desde > timedelta(days=etapa["dias_parado"])
        saida.append(NegocioResumo(
            id=lead.id, nome=lead.nome, valor_estimado=lead.valor_estimado, funil_id=lead.funil_id,
            etapa_id=lead.etapa_id, status=lead.status, estagio=lead.estagio,
            cliente_id=lead.cliente_id, cliente_nome=cliente["nome"] if cliente else None,
            cliente_telefone=cliente.get("telefone") if cliente else None,
            imovel_id=lead.imovel_id, imovel_titulo=imovel["titulo"] if imovel else None,
            imovel_codigo=imovel.get("codigo") if imovel else None,
            corretor_id=lead.corretor_id, corretor_nome=corretor["nome"] if corretor else None,
            corretor_usuario_id=usuario["id"] if usuario else None,
            corretor_tem_foto=bool(usuario and usuario.get("tem_foto")),
            corretor_cor=usuario.get("cor") if usuario else None,
            origem=lead.origem, etiquetas=lead.etiquetas, previsao_fechamento=lead.previsao_fechamento,
            etapa_desde=lead.etapa_desde, created_at=lead.created_at, updated_at=lead.updated_at,
            closed_at=lead.closed_at, motivo_perda=lead.motivo_perda,
            proxima_atividade=prox["data"] if prox else None,
            proxima_atividade_assunto=prox["assunto"] if prox else None,
            proxima_atividade_tipo=prox["tipo"] if prox else None,
            situacao_atividade=situacao, parado=parado, contrato_id=contratos.get(lead.id),
        ))
    return saida


def _filtro_lista(principal: Principal, funil_id: str | None, status: str | None, corretor_id: str | None) -> dict:
    filtro = dict(filtro_do_principal(principal, "leads"))
    if funil_id:
        filtro["funil_id"] = funil_id
    if status and status != "todos":
        filtro["status"] = status
    if corretor_id and principal.is_admin:
        filtro["corretor_id"] = corretor_id
    return filtro


@router.get("", response_model=List[Lead])
async def list_leads(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000),
                     principal: Principal = Depends(require("lead:read"))):
    filtro = filtro_do_principal(principal, "leads")
    docs = await page(db.leads.find(filtro).sort("created_at", -1), response, offset, limit)
    return [to_lead(d) for d in docs]


@router.get("/kanban", response_model=List[NegocioResumo])
async def kanban(
    funil_id: str | None = None,
    status: str | None = Query("aberto"),
    corretor_id: str | None = None,
    principal: Principal = Depends(require("lead:read")),
):
    filtro = _filtro_lista(principal, funil_id, status, corretor_id)
    if status in ("ganho", "perdido", "todos"):
        docs = await db.leads.find(filtro).sort("updated_at", -1).limit(2000).to_list(None)
    else:
        docs = await db.leads.find(filtro).sort("created_at", -1).to_list(None)
    return await resumir(docs)


@router.get("/metricas", response_model=LeadMetricas)
async def metricas(funil_id: str | None = None, corretor_id: str | None = None,
                   principal: Principal = Depends(require("lead:read"))):
    filtro = _filtro_lista(principal, funil_id, None, corretor_id)
    docs = await db.leads.find(filtro).to_list(None)
    funis = {f["id"]: f async for f in db.funis.find({})}
    fechados = [d for d in docs if d.get("status", d.get("estagio")) == "ganho" and d.get("closed_at") and d.get("created_at")]
    tempos = [(utc_aware(c["closed_at"]) - utc_aware(c["created_at"])).days for c in fechados]

    def st(d):
        return d.get("status") or (d.get("estagio") if d.get("estagio") in ESTAGIOS_FECHADOS else "aberto")

    ganhos = [d for d in docs if st(d) == "ganho"]
    perdidos = [d for d in docs if st(d) == "perdido"]
    abertos = [d for d in docs if st(d) == "aberto"]
    decididos = len(ganhos) + len(perdidos)
    inicio_mes = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    por_estagio = {e: sum(1 for d in docs if d.get("estagio") == e) for e in
                   ["novo", "atendimento", "visita", "proposta", "ganho", "perdido"]}
    contagem: dict[str, int] = {}
    for d in docs:
        origem = d.get("origem") or "Não informado"
        contagem[origem] = contagem.get(origem, 0) + 1
    motivos: dict[str, int] = {}
    for d in perdidos:
        m = d.get("motivo_perda") or "Sem motivo"
        motivos[m] = motivos.get(m, 0) + 1

    ponderado = 0.0
    for d in abertos:
        funil = funis.get(d.get("funil_id") or "")
        etapa = _etapa(funil, d.get("etapa_id")) if funil else None
        ponderado += (d.get("valor_estimado") or 0) * ((etapa or {}).get("probabilidade", 0) / 100)

    return LeadMetricas(
        total_leads=len(docs),
        leads_abertos=len(abertos),
        tempo_medio_fechamento_dias=round(sum(tempos) / len(tempos), 1) if tempos else None,
        taxa_conversao=round(len(ganhos) / decididos * 100, 1) if decididos else None,
        por_estagio=por_estagio,
        origens=sorted((OrigemCount(origem=o, total=t) for o, t in contagem.items()), key=lambda x: -x.total),
        valor_aberto=round(sum(d.get("valor_estimado") or 0 for d in abertos), 2),
        valor_ponderado=round(ponderado, 2),
        ganhos_valor=round(sum(d.get("valor_estimado") or 0 for d in ganhos), 2),
        ganhos_mes=sum(1 for d in ganhos if d.get("closed_at") and utc_aware(d["closed_at"]) >= inicio_mes),
        perdidos_mes=sum(1 for d in perdidos if d.get("closed_at") and utc_aware(d["closed_at"]) >= inicio_mes),
        motivos_perda=sorted((OrigemCount(origem=o, total=t) for o, t in motivos.items()), key=lambda x: -x.total),
    )


class NegocioDetalhe(BaseModel):
    negocio: Lead
    resumo: NegocioResumo
    cliente: Pessoa | None = None
    funil_nome: str | None = None
    etapas: list[dict] = []


@router.get("/{lead_id}", response_model=NegocioDetalhe)
async def get_lead(lead_id: str, principal: Principal = Depends(require("lead:read"))):
    doc = await db.leads.find_one({"id": lead_id})
    if not doc:
        raise HTTPException(404, "Negócio não encontrado")
    authorize(principal, "lead:read", doc)
    resumo = (await resumir([doc]))[0]
    cliente = await db.pessoas.find_one({"id": doc.get("cliente_id")}) if doc.get("cliente_id") else None
    funil = await _funil(doc.get("funil_id"))
    return NegocioDetalhe(
        negocio=to_lead(doc), resumo=resumo,
        cliente=Pessoa(**{k: v for k, v in cliente.items() if k in Pessoa.model_fields}) if cliente else None,
        funil_nome=funil["nome"] if funil else None,
        etapas=[{k: e.get(k) for k in ("id", "nome", "probabilidade", "dias_parado")} for e in (funil or {}).get("etapas", [])],
    )


@router.post("", response_model=Lead, status_code=201)
async def create_lead(input: LeadCreate, principal: Principal = Depends(require("lead:create"))):
    data = input.model_dump()
    if not principal.is_admin:
        data["corretor_id"] = principal.pessoa_id
    await reference("imoveis", data.get("imovel_id"))
    await reference("veiculos", data.get("veiculo_id"))
    await reference("pessoas", data.get("cliente_id"), principal)
    await reference("pessoas", data.get("corretor_id"), principal)

    funil = await _funil(data.get("funil_id"))
    if not funil:
        raise HTTPException(409, "Nenhum funil configurado")
    estagio_pedido = data.pop("estagio", None)
    status = estagio_pedido if estagio_pedido in ESTAGIOS_FECHADOS else "aberto"
    etapa = _etapa(funil, data.get("etapa_id")) or funil["etapas"][0]
    data.update(funil_id=funil["id"], etapa_id=etapa["id"], status=status, etapa_desde=now_utc(), etapas_alcancadas=[etapa["id"]])
    data["estagio"] = estagio_legado(funil, etapa["id"], status)
    if status in ESTAGIOS_FECHADOS:
        data["closed_at"] = now_utc()
    lead = Lead(**data)
    await db.leads.insert_one(lead.model_dump())
    await registrar(lead.id, "criado", f"Negócio criado em {funil['nome']} · {etapa['nome']}", principal)
    await automacoes.negocio_alterado(None, lead.model_dump())
    return lead


async def _aplicar(doc: dict, data: dict, principal: Principal) -> dict:
    """Aplica uma alteração ao negócio mantendo etapa/status/legado coerentes + histórico."""
    funil = await _funil(data.get("funil_id") or doc.get("funil_id"))
    eventos: list[tuple[str, str]] = []

    # Compatibilidade: telas antigas ainda mandam `estagio`.
    estagio = data.pop("estagio", None)
    if estagio and funil:
        if estagio in ESTAGIOS_FECHADOS:
            data["status"] = estagio
        else:
            pos = ["novo", "atendimento", "visita", "proposta"].index(estagio)
            data["status"] = "aberto"
            data["etapa_id"] = funil["etapas"][min(pos, len(funil["etapas"]) - 1)]["id"]

    if "funil_id" in data and data["funil_id"] != doc.get("funil_id") and funil:
        if not _etapa(funil, data.get("etapa_id")):
            data["etapa_id"] = funil["etapas"][0]["id"]
        eventos.append(("etapa", f"Movido para o funil {funil['nome']}"))
    if data.get("etapa_id") and data["etapa_id"] != doc.get("etapa_id"):
        etapa = _etapa(funil, data["etapa_id"]) if funil else None
        if not etapa:
            raise HTTPException(422, "Etapa não pertence ao funil")
        anterior = _etapa(funil, doc.get("etapa_id")) if funil else None
        data["etapa_desde"] = now_utc()
        eventos.append(("etapa", f"Etapa: {anterior['nome'] if anterior else '—'} → {etapa['nome']}"))

    novo_status = data.get("status")
    if novo_status and novo_status != doc.get("status", "aberto"):
        data["closed_at"] = now_utc() if novo_status in ESTAGIOS_FECHADOS else None
        if novo_status == "aberto":
            data["motivo_perda"] = None
        rotulo = {"ganho": "Negócio GANHO 🎉", "perdido": "Negócio perdido", "aberto": "Negócio reaberto"}[novo_status]
        if novo_status == "perdido" and data.get("motivo_perda"):
            rotulo += f" — {data['motivo_perda']}"
        eventos.append(("status", rotulo))

    for campo, rotulo in (("valor_estimado", "Valor"), ("corretor_id", "Responsável"), ("imovel_id", "Imóvel")):
        if campo in data and data[campo] != doc.get(campo):
            eventos.append(("campo", f"{rotulo} alterado"))

    final = {**doc, **data}
    data["estagio"] = estagio_legado(funil, final.get("etapa_id"), final.get("status", "aberto"))
    data["updated_at"] = now_utc()
    update: dict = {"$set": data}
    if data.get("etapa_id"):
        update["$addToSet"] = {"etapas_alcancadas": data["etapa_id"]}
    await db.leads.update_one({"id": doc["id"]}, update)
    for tipo, texto in eventos:
        await registrar(doc["id"], tipo, texto, principal)
    depois = await db.leads.find_one({"id": doc["id"]})
    await automacoes.negocio_alterado(doc, depois)
    return depois


async def _carregar(lead_id: str, principal: Principal, acao: str = "lead:update") -> dict:
    doc = await db.leads.find_one({"id": lead_id})
    if not doc:
        raise HTTPException(404, "Negócio não encontrado")
    authorize(principal, acao, doc)
    return doc


@router.patch("/{lead_id}", response_model=Lead)
async def update_lead(lead_id: str, input: LeadUpdate, principal: Principal = Depends(require("lead:update"))):
    doc = await _carregar(lead_id, principal)
    data = patch_data(input, ("nome", "origem", "estagio", "funil_id", "etapa_id"))
    if not principal.is_admin:
        data.pop("corretor_id", None)
    await reference("imoveis", data.get("imovel_id"))
    await reference("veiculos", data.get("veiculo_id"))
    await reference("pessoas", data.get("cliente_id"), principal)
    await reference("pessoas", data.get("corretor_id"), principal)
    atual = await _aplicar(doc, data, principal)
    await audit(principal, "lead.update", lead_id, {"estagio": doc.get("estagio")}, {k: v for k, v in data.items() if k != "etapa_desde"})
    return to_lead(atual)


@router.post("/{lead_id}/mover", response_model=Lead)
async def mover(lead_id: str, input: MoverInput, principal: Principal = Depends(require("lead:update"))):
    doc = await _carregar(lead_id, principal)
    data = {"etapa_id": input.etapa_id, "status": "aberto"}
    if input.funil_id:
        data["funil_id"] = input.funil_id
    return to_lead(await _aplicar(doc, data, principal))


@router.post("/{lead_id}/ganhar", response_model=Lead)
async def ganhar(lead_id: str, principal: Principal = Depends(require("lead:update"))):
    doc = await _carregar(lead_id, principal)
    return to_lead(await _aplicar(doc, {"status": "ganho"}, principal))


@router.post("/{lead_id}/perder", response_model=Lead)
async def perder(lead_id: str, input: PerderInput, principal: Principal = Depends(require("lead:update"))):
    doc = await _carregar(lead_id, principal)
    cfg = await carregar_crm_config()
    if cfg.exige_motivo_perda and not (input.motivo or "").strip():
        raise HTTPException(422, "Informe o motivo da perda")
    return to_lead(await _aplicar(doc, {"status": "perdido", "motivo_perda": (input.motivo or "").strip() or None}, principal))


@router.post("/{lead_id}/reabrir", response_model=Lead)
async def reabrir(lead_id: str, principal: Principal = Depends(require("lead:update"))):
    doc = await _carregar(lead_id, principal)
    if await db.contratos.find_one({"lead_id": lead_id, "status": "ativo"}):
        raise HTTPException(409, "Negócio com contrato ativo não pode ser reaberto")
    return to_lead(await _aplicar(doc, {"status": "aberto"}, principal))


# ------------------------------------------------------------------ histórico e notas


def _evento(doc: dict) -> EventoHistorico:
    data = {k: v for k, v in doc.items() if k != "_id"}
    data["em"] = utc_aware(data.get("em"))
    return EventoHistorico(**{k: v for k, v in data.items() if k in EventoHistorico.model_fields})


@router.get("/{lead_id}/historico", response_model=List[EventoHistorico])
async def historico(lead_id: str, principal: Principal = Depends(require("lead:read"))):
    await _carregar(lead_id, principal, "lead:read")
    docs = await db.historico.find({"negocio_id": lead_id}).sort("em", -1).to_list(500)
    return [_evento(d) for d in docs]


@router.post("/{lead_id}/notas", response_model=EventoHistorico, status_code=201)
async def criar_nota(lead_id: str, input: NotaInput, principal: Principal = Depends(require("lead:update"))):
    await _carregar(lead_id, principal)
    evento = EventoHistorico(negocio_id=lead_id, tipo="nota", texto=input.texto.strip(),
                             autor=principal.nome, autor_id=principal.usuario_id, fixado=input.fixado)
    await db.historico.insert_one(evento.model_dump())
    await db.leads.update_one({"id": lead_id}, {"$set": {"updated_at": now_utc()}})
    return evento


@router.patch("/{lead_id}/notas/{nota_id}", response_model=EventoHistorico)
async def editar_nota(lead_id: str, nota_id: str, input: NotaInput, principal: Principal = Depends(require("lead:update"))):
    await _carregar(lead_id, principal)
    nota = await db.historico.find_one({"id": nota_id, "negocio_id": lead_id, "tipo": "nota"})
    if not nota:
        raise HTTPException(404, "Nota não encontrada")
    if nota.get("autor_id") != principal.usuario_id and not principal.is_admin:
        raise HTTPException(403, "Somente o autor ou o gestor altera esta nota")
    await db.historico.update_one({"id": nota_id}, {"$set": {"texto": input.texto.strip(), "fixado": input.fixado}})
    return _evento(await db.historico.find_one({"id": nota_id}))


@router.delete("/{lead_id}/notas/{nota_id}", status_code=204)
async def excluir_nota(lead_id: str, nota_id: str, principal: Principal = Depends(require("lead:update"))):
    await _carregar(lead_id, principal)
    nota = await db.historico.find_one({"id": nota_id, "negocio_id": lead_id, "tipo": "nota"})
    if not nota:
        raise HTTPException(404, "Nota não encontrada")
    if nota.get("autor_id") != principal.usuario_id and not principal.is_admin:
        raise HTTPException(403, "Somente o autor ou o gestor exclui esta nota")
    await db.historico.delete_one({"id": nota_id})
    return None


@router.delete("/{lead_id}", status_code=204)
async def delete_lead(lead_id: str, principal: Principal = Depends(require("lead:delete"))):
    doc = await _carregar(lead_id, principal, "lead:delete")
    if await db.contratos.find_one({"lead_id": lead_id}) or await db.visitas.find_one({"lead_id": lead_id}):
        raise HTTPException(409, "Negócio vinculado a contrato ou visita não pode ser excluído")
    await audit(principal, "lead.delete", lead_id)
    await db.leads.delete_one({"id": doc["id"]})
    await db.atividades.delete_many({"negocio_id": lead_id, "concluida": False})
    return None


async def _efeitos_ganho(lead: dict) -> None:
    """Regra mantida: ganhar o negócio NÃO lança financeiro; o contrato aprovado é que gera os títulos."""
    return None
