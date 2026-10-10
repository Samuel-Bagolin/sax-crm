"""CRM estilo Pipedrive — funis/etapas, configuração, caixa de entrada, atividades, equipe e busca."""

import re
from datetime import datetime, timedelta
from typing import List
from zoneinfo import ZoneInfo
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from lib import automacoes
from lib.auth import Principal, authorize, filtro_do_principal, require
from lib.crm import carregar_crm_config, estagio_legado, garantir_crm, registrar
from lib.dates import today_iso
from lib.db import db
from lib.integrity import audit, reference
from lib.validation import patch_data
from models.common import new_id, now_utc, utc_aware
from models.crm import (
    Atividade, AtividadeCreate, AtividadeUpdate, ConverterEntrada, CrmConfig, CrmConfigUpdate,
    Entrada, EntradaCreate, EntradaUpdate, Etapa, Funil, FunilInput, MembroEquipe, ResultadoBusca,
)
from models.leads import Lead
from models.pessoas import Pessoa

import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["crm"])

TIPO_LABEL = {
    "ligacao": "Ligação", "whatsapp": "WhatsApp", "email": "E-mail", "reuniao": "Reunião",
    "visita": "Visita", "tarefa": "Tarefa", "prazo": "Prazo", "almoco": "Almoço",
}


def _limpo(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "_id"}


# ================================================================== funis


def to_funil(doc: dict) -> Funil:
    data = _limpo(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    return Funil(**data)


@router.get("/funis", response_model=List[Funil])
async def list_funis(principal: Principal = Depends(require("funil:read"))):
    if await db.funis.count_documents({}) == 0:
        await garantir_crm()
    docs = await db.funis.find({}).sort("ordem", 1).to_list(None)
    return [to_funil(d) for d in docs]


async def _salvar_funil(input: FunilInput, existente: dict | None) -> Funil:
    etapas = [Etapa(**{**e.model_dump(), "id": e.id or new_id()}) for e in input.etapas]
    if existente:
        antigos = {e["id"] for e in existente.get("etapas", [])}
        removidos = antigos - {e.id for e in etapas}
        if removidos and await db.leads.find_one({"funil_id": existente["id"], "etapa_id": {"$in": list(removidos)}, "status": "aberto"}):
            raise HTTPException(409, "Há negócios abertos em uma etapa removida. Mova-os antes de excluir a etapa.")
    if input.padrao:
        await db.funis.update_many({}, {"$set": {"padrao": False}})
    if existente:
        await db.funis.update_one({"id": existente["id"]}, {"$set": {
            "nome": input.nome.strip(), "etapas": [e.model_dump() for e in etapas],
            "padrao": input.padrao or existente.get("padrao", False)}})
        doc = await db.funis.find_one({"id": existente["id"]})
        # etapas reordenadas mudam o estágio legado: ressincroniza
        async for lead in db.leads.find({"funil_id": doc["id"]}, {"id": 1, "etapa_id": 1, "status": 1}):
            await db.leads.update_one({"id": lead["id"]}, {"$set": {"estagio": estagio_legado(doc, lead.get("etapa_id"), lead.get("status", "aberto"))}})
        return to_funil(doc)
    ordem = await db.funis.count_documents({})
    funil = Funil(nome=input.nome.strip(), ordem=ordem, padrao=input.padrao or ordem == 0, etapas=etapas)
    await db.funis.insert_one(funil.model_dump())
    return funil


@router.post("/funis", response_model=Funil, status_code=201)
async def criar_funil(input: FunilInput, principal: Principal = Depends(require("funil:write"))):
    funil = await _salvar_funil(input, None)
    await audit(principal, "funil.create", funil.id)
    return funil


@router.put("/funis/{funil_id}", response_model=Funil)
async def editar_funil(funil_id: str, input: FunilInput, principal: Principal = Depends(require("funil:write"))):
    doc = await db.funis.find_one({"id": funil_id})
    if not doc:
        raise HTTPException(404, "Funil não encontrado")
    funil = await _salvar_funil(input, doc)
    await audit(principal, "funil.update", funil_id)
    return funil


@router.delete("/funis/{funil_id}", status_code=204)
async def excluir_funil(funil_id: str, principal: Principal = Depends(require("funil:write"))):
    if await db.funis.count_documents({}) <= 1:
        raise HTTPException(409, "Mantenha ao menos um funil")
    if await db.leads.find_one({"funil_id": funil_id}):
        raise HTTPException(409, "Funil com negócios não pode ser excluído. Mova os negócios para outro funil.")
    doc = await db.funis.find_one({"id": funil_id})
    await db.funis.delete_one({"id": funil_id})
    if doc and doc.get("padrao"):
        outro = await db.funis.find_one({}, sort=[("ordem", 1)])
        if outro:
            await db.funis.update_one({"id": outro["id"]}, {"$set": {"padrao": True}})
    return None


# ================================================================== configuração do CRM


@router.get("/crm/config", response_model=CrmConfig)
async def get_crm_config(principal: Principal = Depends(require("funil:read"))):
    return await carregar_crm_config()


@router.put("/crm/config", response_model=CrmConfig)
async def put_crm_config(input: CrmConfigUpdate, principal: Principal = Depends(require("funil:write"))):
    atual = (await carregar_crm_config()).model_dump()
    entrada = input.model_dump(exclude_unset=True)
    if entrada.pop("sem_sla", None):
        atual["sla_primeiro_contato_min"] = None
    if entrada.pop("sem_repescagem", None):
        atual["repescagem_horas"] = None
    if entrada.get("automacoes") is not None:
        funis = {f["id"]: {e["id"] for e in f.get("etapas", [])} async for f in db.funis.find({}, {"id": 1, "etapas.id": 1})}
        for a in entrada["automacoes"]:
            if a.get("funil_id") and a["funil_id"] not in funis:
                raise HTTPException(422, f"Automação \"{a['nome']}\": funil não existe")
            if a["gatilho"] == "entrou_etapa":
                if not a.get("etapa_id") or not any(a["etapa_id"] in etapas for etapas in funis.values()):
                    raise HTTPException(422, f"Automação \"{a['nome']}\": escolha a etapa")
        atual["automacoes"] = entrada.pop("automacoes")
    for k, v in entrada.items():
        if v is None:
            continue
        if isinstance(v, list):
            vistos, limpos = set(), []
            for item in v:
                item = str(item).strip()[:80]
                if item and item.lower() not in vistos:
                    vistos.add(item.lower())
                    limpos.append(item)
            v = limpos
        atual[k] = v
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"crm": atual}}, upsert=True)
    await audit(principal, "crm.config", "singleton")
    return CrmConfig(**atual)


# ================================================================== caixa de entrada (leads)


def to_entrada(doc: dict) -> Entrada:
    data = _limpo(doc)
    data["created_at"] = utc_aware(data.get("created_at"))
    data["updated_at"] = utc_aware(data.get("updated_at"))
    data["primeiro_contato_em"] = utc_aware(data.get("primeiro_contato_em"))
    data["atribuido_em"] = utc_aware(data.get("atribuido_em"))
    data["fila_desde"] = utc_aware(data.get("fila_desde"))
    data["na_fila"] = bool(data.get("na_fila"))
    return Entrada(**{k: v for k, v in data.items() if k in Entrada.model_fields})


def _filtro_entradas(principal: Principal) -> dict:
    """Gestor vê tudo. Vendedor vê os leads dele e os da fila livre (que qualquer um pode pegar)."""
    if principal.is_admin:
        return {}
    return {"$or": [{"corretor_id": principal.pessoa_id or "__sem_vinculo__"}, {"na_fila": True}]}


async def _proximo_rodizio() -> str | None:
    """Distribuição em rodízio: o vendedor ativo que recebeu menos leads nos últimos 30 dias recebe o próximo."""
    from datetime import timedelta

    corretores = [u["pessoa_id"] async for u in db.usuarios.find({"papel": "corretor", "ativo": True, "pessoa_id": {"$ne": None}}, {"pessoa_id": 1})]
    if not corretores:
        return None
    desde = now_utc() - timedelta(days=30)
    contagem = {c: await db.entradas.count_documents({"corretor_id": c, "created_at": {"$gte": desde}}) for c in corretores}
    return min(corretores, key=lambda c: (contagem[c], c))


_ULTIMA_REPESCAGEM = {"t": 0.0}


async def repescar_leads(forcar: bool = False) -> int:
    """Leads novos que o vendedor não atendeu no prazo vão para a fila livre. Roda no máximo a cada
    5 minutos por instância (e no cron diário), para não gastar leituras do banco a toda hora."""
    import time
    from datetime import timedelta

    if not forcar and time.monotonic() - _ULTIMA_REPESCAGEM["t"] < 300:
        return 0
    _ULTIMA_REPESCAGEM["t"] = time.monotonic()
    horas = (await carregar_crm_config()).repescagem_horas
    if not horas:
        return 0
    limite = now_utc() - timedelta(hours=horas)
    movidos = 0
    async for e in db.entradas.find({"status": "novo", "corretor_id": {"$ne": None}}):
        if e.get("na_fila") or e.get("primeiro_contato_em"):
            continue
        desde = utc_aware(e.get("atribuido_em") or e.get("created_at"))
        if not desde or desde > limite:
            continue
        r = await db.entradas.update_one({"id": e["id"], "corretor_id": e["corretor_id"], "status": "novo"}, {"$set": {
            "corretor_id": None, "na_fila": True, "fila_desde": now_utc(), "devolvido_de": e["corretor_id"], "updated_at": now_utc()}})
        movidos += r.modified_count
    if movidos:
        logger.info("repescagem: %s lead(s) foram para a fila livre", movidos)
    return movidos


@router.get("/entradas/contagem")
async def contar_entradas(principal: Principal = Depends(require("entrada:read"))):
    """Só o número de leads novos, para o contador do menu. Contagem no banco custa uma leitura,
    em vez de uma por lead como a lista inteira."""
    if principal.is_admin:
        novos = await db.entradas.count_documents({"status": "novo"})
    else:
        novos = await db.entradas.count_documents({"corretor_id": principal.pessoa_id or "__sem_vinculo__", "status": "novo"})
    return {"novos": novos, "fila": await db.entradas.count_documents({"na_fila": True, "status": "novo"})}


@router.get("/entradas", response_model=List[Entrada])
async def list_entradas(status: str | None = Query(None), principal: Principal = Depends(require("entrada:read"))):
    await repescar_leads()
    filtro = _filtro_entradas(principal)
    if status == "fila":
        filtro = {"na_fila": True, "status": "novo"}
    elif status == "ativos" or status is None:
        filtro["status"] = {"$in": ["novo", "em_contato"]}
    elif status != "todos":
        filtro["status"] = status
    docs = await db.entradas.find(filtro).sort("created_at", -1).to_list(2000)
    return [to_entrada(d) for d in docs]


@router.post("/entradas", response_model=Entrada, status_code=201)
async def criar_entrada(input: EntradaCreate, principal: Principal = Depends(require("entrada:write"))):
    data = input.model_dump()
    if not principal.is_admin:
        data["corretor_id"] = principal.pessoa_id
    elif not data.get("corretor_id") and (await carregar_crm_config()).distribuicao == "rodizio":
        data["corretor_id"] = await _proximo_rodizio()
    await reference("imoveis", data.get("imovel_id"))
    await reference("veiculos", data.get("veiculo_id"))
    await reference("pessoas", data.get("corretor_id"), principal)
    if data.get("corretor_id"):
        data["atribuido_em"] = now_utc()
    entrada = Entrada(**data)
    await db.entradas.insert_one(entrada.model_dump())
    await automacoes.lead_novo(entrada.model_dump())
    return entrada


async def _carregar_entrada(entrada_id: str, principal: Principal, acao: str) -> dict:
    doc = await db.entradas.find_one({"id": entrada_id})
    if not doc:
        raise HTTPException(404, "Lead não encontrado")
    if not principal.is_admin and doc.get("corretor_id") != principal.pessoa_id:
        raise HTTPException(404, "Lead não encontrado")
    authorize(principal, acao)
    return doc


@router.patch("/entradas/{entrada_id}", response_model=Entrada)
async def editar_entrada(entrada_id: str, input: EntradaUpdate, principal: Principal = Depends(require("entrada:write"))):
    doc = await _carregar_entrada(entrada_id, principal, "entrada:write")
    if doc.get("status") == "convertido":
        raise HTTPException(409, "Lead já convertido em negócio")
    data = patch_data(input, ("nome",))
    if not principal.is_admin:
        data.pop("corretor_id", None)
    await reference("imoveis", data.get("imovel_id"))
    await reference("veiculos", data.get("veiculo_id"))
    await reference("pessoas", data.get("corretor_id"), principal)
    if "corretor_id" in data and data["corretor_id"] != doc.get("corretor_id"):
        data.update(atribuido_em=now_utc() if data["corretor_id"] else None, na_fila=False)
    data["updated_at"] = now_utc()
    if data.get("status") in ("em_contato", "descartado") and not doc.get("primeiro_contato_em"):
        data["primeiro_contato_em"] = now_utc()
    await db.entradas.update_one({"id": entrada_id}, {"$set": data})
    return to_entrada(await db.entradas.find_one({"id": entrada_id}))


@router.post("/entradas/{entrada_id}/pegar", response_model=Entrada)
async def pegar_entrada(entrada_id: str, principal: Principal = Depends(require("entrada:write"))):
    """Vendedor pega um lead da fila livre. Só o primeiro que clicar fica com ele."""
    if not principal.pessoa_id:
        raise HTTPException(409, "Seu usuário não está vinculado a um cadastro de vendedor. Fale com o gestor.")
    r = await db.entradas.update_one({"id": entrada_id, "na_fila": True, "status": "novo"}, {"$set": {
        "corretor_id": principal.pessoa_id, "na_fila": False, "atribuido_em": now_utc(), "updated_at": now_utc()}})
    if r.modified_count != 1:
        raise HTTPException(409, "Outro vendedor já pegou este lead.")
    await audit(principal, "entrada.pegar", entrada_id)
    return to_entrada(await db.entradas.find_one({"id": entrada_id}))


@router.delete("/entradas/{entrada_id}", status_code=204)
async def excluir_entrada(entrada_id: str, principal: Principal = Depends(require("entrada:delete"))):
    doc = await _carregar_entrada(entrada_id, principal, "entrada:delete")
    if doc.get("status") == "convertido":
        raise HTTPException(409, "Lead convertido não pode ser excluído")
    await db.entradas.delete_one({"id": entrada_id})
    return None


@router.post("/entradas/{entrada_id}/converter", response_model=Lead)
async def converter_entrada(entrada_id: str, input: ConverterEntrada, principal: Principal = Depends(require("entrada:write"))):
    authorize(principal, "lead:create")
    doc = await _carregar_entrada(entrada_id, principal, "entrada:write")
    if doc.get("status") == "convertido":
        raise HTTPException(409, "Lead já convertido em negócio")

    # Pessoa: reaproveita pelo e-mail/telefone; senão cria o cliente.
    cliente_id = doc.get("cliente_id")
    if not cliente_id:
        existente = None
        if doc.get("email"):
            existente = await db.pessoas.find_one({"email": doc["email"].strip().lower()})
        if not existente and doc.get("telefone"):
            existente = await db.pessoas.find_one({"telefone": doc["telefone"]})
        if existente:
            cliente_id = existente["id"]
        else:
            pessoa = Pessoa(nome=doc["nome"], papeis=["cliente"], telefone=doc.get("telefone"),
                            email=(doc.get("email") or "").strip().lower() or None)
            await db.pessoas.insert_one({**pessoa.model_dump(), "created_by": principal.usuario_id})
            cliente_id = pessoa.id

    funil = await db.funis.find_one({"id": input.funil_id}) if input.funil_id else None
    if not funil:
        preferido = "Locação" if doc.get("interesse") == "locacao" else None
        funil = (await db.funis.find_one({"nome": preferido}) if preferido else None) or await db.funis.find_one({"padrao": True}) or await db.funis.find_one({})
    if not funil:
        raise HTTPException(409, "Nenhum funil configurado")
    etapa = next((e for e in funil["etapas"] if e["id"] == input.etapa_id), funil["etapas"][0])
    corretor = input.corretor_id if principal.is_admin and input.corretor_id else doc.get("corretor_id")
    if not principal.is_admin:
        corretor = principal.pessoa_id

    lead = Lead(
        nome=(input.titulo or "").strip() or f"{doc['nome']} — {'Locação' if doc.get('interesse') == 'locacao' else 'Compra'}",
        cliente_id=cliente_id, imovel_id=doc.get("imovel_id"), veiculo_id=doc.get("veiculo_id"), corretor_id=corretor, origem=doc.get("origem") or "Manual",
        valor_estimado=input.valor_estimado if input.valor_estimado is not None else doc.get("valor_estimado"),
        observacoes=doc.get("mensagem"), funil_id=funil["id"], etapa_id=etapa["id"], status="aberto",
        estagio=estagio_legado(funil, etapa["id"], "aberto"), etapa_desde=now_utc(),
        etiquetas=doc.get("etiquetas") or [], entrada_id=entrada_id, etapas_alcancadas=[etapa["id"]],
    )
    await db.leads.insert_one(lead.model_dump())
    await db.entradas.update_one({"id": entrada_id}, {"$set": {"status": "convertido", "negocio_id": lead.id, "cliente_id": cliente_id, "updated_at": now_utc(),
                                                                "primeiro_contato_em": doc.get("primeiro_contato_em") or now_utc()}})
    await db.atividades.update_many({"entrada_id": entrada_id}, {"$set": {"negocio_id": lead.id}})
    await registrar(lead.id, "criado", f"Convertido do lead da caixa de entrada ({lead.origem})", principal)
    if doc.get("mensagem"):
        await registrar(lead.id, "nota", f"Mensagem original: {doc['mensagem']}", principal)
    await automacoes.negocio_alterado(None, lead.model_dump())
    return lead


# ================================================================== atividades


def to_atividade(doc: dict) -> Atividade:
    data = _limpo(doc)
    for k in ("created_at", "updated_at", "concluida_em"):
        data[k] = utc_aware(data.get(k))
    return Atividade(**{k: v for k, v in data.items() if k in Atividade.model_fields})


@router.get("/atividades", response_model=List[Atividade])
async def list_atividades(
    inicio: str | None = None, fim: str | None = None, corretor_id: str | None = None,
    negocio_id: str | None = None, pendentes: bool = False, atrasadas: bool = False,
    principal: Principal = Depends(require("atividade:read")),
):
    filtro: dict = dict(filtro_do_principal(principal, "atividades"))
    if corretor_id and principal.is_admin:
        filtro["corretor_id"] = corretor_id
    if negocio_id:
        negocio = await db.leads.find_one({"id": negocio_id})
        if not negocio:
            raise HTTPException(404, "Negócio não encontrado")
        authorize(principal, "lead:read", negocio)
        filtro.pop("corretor_id", None)
        filtro["negocio_id"] = negocio_id
    if inicio or fim:
        faixa = {}
        if inicio:
            faixa["$gte"] = inicio
        if fim:
            faixa["$lte"] = fim
        filtro["data"] = faixa
    if pendentes or atrasadas:
        filtro["concluida"] = False
    if atrasadas:
        filtro["data"] = {"$lt": today_iso()}
    docs = await db.atividades.find(filtro).sort([("data", 1), ("hora", 1)]).to_list(5000)
    return [to_atividade(d) for d in docs]


async def _validar_atividade(data: dict, principal: Principal) -> None:
    if data.get("negocio_id"):
        negocio = await reference("leads", data["negocio_id"], principal, "lead:read")
        if not data.get("pessoa_id"):
            data["pessoa_id"] = negocio.get("cliente_id")
        if not data.get("imovel_id"):
            data["imovel_id"] = negocio.get("imovel_id")
        if not data.get("corretor_id"):
            data["corretor_id"] = negocio.get("corretor_id")
    await reference("imoveis", data.get("imovel_id"))
    await reference("pessoas", data.get("pessoa_id"), principal)
    await reference("pessoas", data.get("corretor_id"), principal)


@router.post("/atividades", response_model=Atividade, status_code=201)
async def criar_atividade(input: AtividadeCreate, background: BackgroundTasks, principal: Principal = Depends(require("atividade:write"))):
    data = input.model_dump()
    if not principal.is_admin:
        data["corretor_id"] = principal.pessoa_id
    if not data.get("corretor_id") and not data.get("negocio_id"):
        data["corretor_id"] = principal.pessoa_id
    await _validar_atividade(data, principal)
    if not principal.is_admin:
        data["corretor_id"] = principal.pessoa_id
    if data.get("concluida"):
        data["concluida_em"] = now_utc()
    atividade = Atividade(**data, created_by=principal.usuario_id)
    await db.atividades.insert_one(atividade.model_dump())
    if atividade.negocio_id:
        await registrar(atividade.negocio_id, "atividade",
                        f"{TIPO_LABEL[atividade.tipo]} agendada: {atividade.assunto} ({atividade.data[8:10]}/{atividade.data[5:7]}{' ' + atividade.hora if atividade.hora else ''})",
                        principal)
    from routers.google import agendar, sincronizar_atividade
    await agendar(background, sincronizar_atividade, atividade.id)
    return atividade


@router.patch("/atividades/{atividade_id}", response_model=Atividade)
async def editar_atividade(atividade_id: str, input: AtividadeUpdate, background: BackgroundTasks, principal: Principal = Depends(require("atividade:write"))):
    doc = await db.atividades.find_one({"id": atividade_id})
    if not doc:
        raise HTTPException(404, "Atividade não encontrada")
    authorize(principal, "atividade:write", doc)
    data = patch_data(input, ("tipo", "assunto", "data", "duracao_min", "concluida"))
    if not principal.is_admin:
        data.pop("corretor_id", None)
    await _validar_atividade({**data}, principal)
    if "concluida" in data and data["concluida"] != doc.get("concluida"):
        data["concluida_em"] = now_utc() if data["concluida"] else None
        if data["concluida"] and doc.get("negocio_id"):
            await registrar(doc["negocio_id"], "atividade", f"{TIPO_LABEL.get(doc['tipo'], 'Atividade')} concluída: {doc['assunto']}", principal)
        if data["concluida"] and doc.get("entrada_id"):
            # Concluir a primeira ação do lead conta como primeiro atendimento (SLA).
            await db.entradas.update_one({"id": doc["entrada_id"], "primeiro_contato_em": None}, {"$set": {"primeiro_contato_em": now_utc()}})
            await db.entradas.update_one({"id": doc["entrada_id"], "status": "novo"}, {"$set": {"status": "em_contato", "updated_at": now_utc()}})
    data["updated_at"] = now_utc()
    await db.atividades.update_one({"id": atividade_id}, {"$set": data})
    from routers.google import agendar, sincronizar_atividade
    await agendar(background, sincronizar_atividade, atividade_id)
    return to_atividade(await db.atividades.find_one({"id": atividade_id}))


@router.delete("/atividades/{atividade_id}", status_code=204)
async def excluir_atividade(atividade_id: str, background: BackgroundTasks, principal: Principal = Depends(require("atividade:write"))):
    doc = await db.atividades.find_one({"id": atividade_id})
    if not doc:
        raise HTTPException(404, "Atividade não encontrada")
    authorize(principal, "atividade:write", doc)
    await db.atividades.delete_one({"id": atividade_id})
    from routers.google import agendar, remover_evento
    await agendar(background, remover_evento, doc.get("google_usuario"), doc.get("google_evento_id"))
    return None


# ================================================================== equipe


def _semana(hoje: str) -> tuple[str, str]:
    d = datetime.fromisoformat(hoje)
    inicio = d - timedelta(days=d.weekday())
    return inicio.strftime("%Y-%m-%d"), (inicio + timedelta(days=6)).strftime("%Y-%m-%d")


@router.get("/equipe", response_model=List[MembroEquipe])
async def equipe(principal: Principal = Depends(require("equipe:read"))):
    """Corretores e gestores com indicadores do dia — base da agenda da equipe e do ranking."""
    filtro = {"ativo": True} if principal.is_admin else {"id": principal.usuario_id}
    usuarios = await db.usuarios.find(filtro, {"senha_hash": 0}).sort("nome", 1).to_list(None)
    hoje = today_iso()
    ini_sem, fim_sem = _semana(hoje)
    inicio_mes = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    saida = []
    for u in usuarios:
        if u.get("papel") == "sysadmin":
            continue
        pid = u.get("pessoa_id")
        pessoa = await db.pessoas.find_one({"id": pid}) if pid else None
        m = MembroEquipe(
            usuario_id=u["id"], pessoa_id=pid, nome=u["nome"], email=u.get("email"), papel=u["papel"],
            telefone=u.get("telefone") or (pessoa or {}).get("telefone"), cargo=u.get("cargo"), cor=u.get("cor"),
            tem_foto=bool(u.get("tem_foto")), foto_v=int(u.get("foto_v", 0)), ativo=u.get("ativo", True),
        )
        if pid:
            abertos = await db.leads.find({"corretor_id": pid, "status": "aberto"}, {"valor_estimado": 1}).to_list(None)
            ganhos = await db.leads.find({"corretor_id": pid, "status": "ganho", "closed_at": {"$gte": inicio_mes}}, {"valor_estimado": 1}).to_list(None)
            m.negocios_abertos = len(abertos)
            m.valor_aberto = round(sum(d.get("valor_estimado") or 0 for d in abertos), 2)
            m.ganhos_mes = len(ganhos)
            m.valor_ganho_mes = round(sum(d.get("valor_estimado") or 0 for d in ganhos), 2)
            m.atividades_hoje = await db.atividades.count_documents({"corretor_id": pid, "data": hoje, "concluida": False})
            m.atividades_atrasadas = await db.atividades.count_documents({"corretor_id": pid, "data": {"$lt": hoje}, "concluida": False})
            m.visitas_semana = await db.visitas.count_documents({"corretor_id": pid, "status": "agendada", "data": {"$gte": ini_sem, "$lte": fim_sem}})
        saida.append(m)
    return saida


# ================================================================== busca global


@router.get("/busca", response_model=List[ResultadoBusca])
async def busca(q: str = Query(min_length=2, max_length=80), principal: Principal = Depends(require("lead:read"))):
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    saida: list[ResultadoBusca] = []
    filtro_neg = filtro_do_principal(principal, "leads")
    async for d in db.leads.find({**filtro_neg, "nome": rx}).limit(8):
        saida.append(ResultadoBusca(tipo="negocio", id=d["id"], titulo=d["nome"],
                                    subtitulo={"ganho": "Ganho", "perdido": "Perdido"}.get(d.get("status", ""), "Em andamento")))
    from routers.pessoas import person_scope
    escopo = await person_scope(principal)
    async for p in db.pessoas.find({"$and": [escopo, {"$or": [{"nome": rx}, {"email": rx}, {"telefone": rx}]}]}).limit(8):
        saida.append(ResultadoBusca(tipo="pessoa", id=p["id"], titulo=p["nome"], subtitulo=", ".join(p.get("papeis", [])) or None))
    async for i in db.imoveis.find({"$or": [{"titulo": rx}, {"codigo": rx}, {"bairro": rx}, {"cidade": rx}]}).limit(8):
        saida.append(ResultadoBusca(tipo="imovel", id=i["id"], titulo=i["titulo"], subtitulo=" · ".join(x for x in (i.get("codigo"), i.get("bairro"), i.get("cidade")) if x)))
    async for e in db.entradas.find({"$and": [_filtro_entradas(principal), {"status": {"$in": ["novo", "em_contato"]}},
                                             {"$or": [{"nome": rx}, {"email": rx}, {"telefone": rx}]}]}).limit(5):
        saida.append(ResultadoBusca(tipo="entrada", id=e["id"], titulo=e["nome"], subtitulo=f"Lead · {e.get('origem', '')}"))
    async for c in db.contratos.find({**filtro_do_principal(principal, "contratos"), "numero": rx}).limit(5):
        saida.append(ResultadoBusca(tipo="contrato", id=c["id"], titulo=c["numero"], subtitulo=c.get("tipo")))
    return saida
