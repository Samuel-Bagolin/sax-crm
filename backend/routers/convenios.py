"""Convênios (planos de saúde) nas clínicas: operadoras, carteirinhas, guias com saldo de sessões e faturamento em lote.

- `convenios`: operadora (nome, registro ANS, código do prestador na operadora, versão TISS, tabela por serviço com código
  TUSS e valor). Bradesco Saúde vem como modelo (registro ANS 005711; confira no seu contrato).
- `guias`: autorização da operadora para um paciente: número, senha, validade, sessões autorizadas, serviço. Status
  solicitada, autorizada ou negada; esgotada e vencida são calculadas.
- `guia_usos`: uma sessão consumida (`_id` = agendamento|paciente, não duplica). Nasce quando o paciente fica presente
  (routers/sessoes.py) numa sessão coberta por guia autorizada, válida e com saldo; sai se a presença sai (se ainda não
  foi faturada).
- `lotes_fat`: lote por operadora e período com as sessões ainda não faturadas; exporta o XML TISS (lib/tiss.py). Ao
  registrar o recebimento, lança a receita (id fixo `lote-{id}`) e a glosa fica registrada.
"""

from __future__ import annotations

from datetime import date
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from lib.agenda_online import agora_local
from lib.auth import Principal, require
from lib.db import controle, db, empresa_atual_db
from models.common import new_id, now_utc

router = APIRouter(prefix="/convenios", tags=["convenios"])
GERIR = "usuario:manage"
OPERAR = "agendamento:write"
LER = "agendamento:read"

MODELOS = {"bradesco": {"nome": "Bradesco Saúde", "registro_ans": "005711"}}
CONSELHOS = {"01": "CRAS", "02": "COREN", "03": "CRF", "04": "CRFA", "05": "CREFITO", "06": "CRM", "07": "CRN", "08": "CRO", "09": "CRP", "10": "Outros"}


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


# ------------------------------------------------------------------ operadoras


class TabelaItem(BaseModel):
    servico_id: str = Field(min_length=1, max_length=60)
    codigo: str = Field(min_length=1, max_length=10, pattern=r"^\d+$")
    descricao: str | None = Field(default=None, max_length=150)
    valor: float = Field(ge=0, le=100_000)


class ConvenioIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    registro_ans: str = Field(pattern=r"^\d{6}$")
    codigo_prestador: str | None = Field(default=None, max_length=20)
    cnes: str | None = Field(default=None, pattern=r"^\d{7}$")
    versao_tiss: str = Field(default="4.03.00", pattern=r"^\d\.\d{2}\.\d{2}$")
    codigo_tabela: str = Field(default="22", pattern=r"^\d{2}$")
    tipo_atendimento: str | None = Field(default=None, pattern=r"^\d{1,2}$")
    regime_atendimento: str = Field(default="01", pattern=r"^\d{2}$")
    tabela: List[TabelaItem] = Field(default_factory=list, max_length=200)
    portal: str | None = Field(default=None, max_length=200)
    observacoes: str | None = Field(default=None, max_length=1000)
    ativo: bool = True


def _saida_conv(c: dict) -> dict:
    return {k: c.get(k) for k in ("id", "nome", "registro_ans", "codigo_prestador", "cnes", "versao_tiss", "codigo_tabela", "tipo_atendimento",
                                  "regime_atendimento", "tabela", "portal", "observacoes", "ativo", "modelo")} | {"tabela": c.get("tabela") or []}


@router.get("")
async def listar(principal: Principal = Depends(require(LER))):
    return [_saida_conv(c) for c in sorted(await db.convenios.find({}).to_list(200), key=lambda c: c.get("nome") or "")]


@router.get("/modelos")
async def modelos(principal: Principal = Depends(require(LER))):
    return {"operadoras": [{"chave": k, **v} for k, v in MODELOS.items()], "conselhos": CONSELHOS}


@router.post("", status_code=201)
async def criar(input: ConvenioIn, principal: Principal = Depends(require(GERIR))):
    if await db.convenios.find_one({"registro_ans": input.registro_ans}, {"id": 1}):
        raise HTTPException(409, "Já existe uma operadora com esse registro ANS")
    cid = new_id()
    doc = {"_id": cid, "id": cid, **input.model_dump(), "ultimo_lote": 0, "created_at": now_utc()}
    await db.convenios.insert_one(doc)
    return _saida_conv(doc)


@router.put("/{cid}")
async def editar(cid: str, input: ConvenioIn, principal: Principal = Depends(require(GERIR))):
    c = await db.convenios.find_one({"id": cid})
    if not c:
        raise HTTPException(404, "Operadora não encontrada")
    if await db.convenios.find_one({"registro_ans": input.registro_ans, "id": {"$ne": cid}}, {"id": 1}):
        raise HTTPException(409, "Já existe uma operadora com esse registro ANS")
    await db.convenios.update_one({"id": cid}, {"$set": input.model_dump()})
    return _saida_conv({**c, **input.model_dump()})


class TissProfIn(BaseModel):
    conselho: str = Field(pattern=r"^\d{2}$")
    numero_conselho: str = Field(min_length=1, max_length=15)
    uf: str = Field(pattern=r"^[A-Z]{2}$")
    cbos: str = Field(pattern=r"^\d{6}$")
    cpf: str | None = Field(default=None, max_length=14)


@router.get("/profissionais")
async def profissionais(principal: Principal = Depends(require(LER))):
    us = await db.usuarios.find({"atende": True}).to_list(300)
    return [{"usuario_id": u["id"], "nome": u.get("nome"), "registro": u.get("registro"), "tiss": u.get("tiss")} for u in sorted(us, key=lambda u: u.get("nome") or "")]


@router.put("/profissionais/{usuario_id}")
async def tiss_prof(usuario_id: str, input: TissProfIn, principal: Principal = Depends(require(GERIR))):
    if not await db.usuarios.find_one({"id": usuario_id}, {"id": 1}):
        raise HTTPException(404, "Profissional não encontrado")
    await db.usuarios.update_one({"id": usuario_id}, {"$set": {"tiss": input.model_dump()}})
    return {"ok": True}


# ------------------------------------------------------------------ guias


class GuiaIn(BaseModel):
    convenio_id: str
    paciente_id: str
    numero_carteira: str = Field(min_length=3, max_length=30)
    servico_id: str | None = None
    status: Literal["solicitada", "autorizada", "negada"] = "autorizada"
    numero_operadora: str | None = Field(default=None, max_length=30)
    senha: str | None = Field(default=None, max_length=30)
    data_solicitacao: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    data_autorizacao: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    validade: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    sessoes_autorizadas: int = Field(default=1, ge=1, le=500)
    indicacao_clinica: str | None = Field(default=None, max_length=500)
    solicitante_nome: str | None = Field(default=None, max_length=120)
    solicitante_conselho: str | None = Field(default=None, pattern=r"^\d{2}$")
    solicitante_numero_conselho: str | None = Field(default=None, max_length=15)
    solicitante_uf: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    solicitante_cbos: str | None = Field(default=None, pattern=r"^\d{6}$")
    observacoes: str | None = Field(default=None, max_length=1000)


async def _usadas(gid: str) -> int:
    return await db.guia_usos.count_documents({"guia_id": gid})


def _situacao(g: dict, usadas: int, hoje: str) -> str:
    if g.get("status") != "autorizada":
        return g.get("status") or "solicitada"
    if usadas >= int(g.get("sessoes_autorizadas") or 0):
        return "esgotada"
    if g.get("validade") and g["validade"] < hoje:
        return "vencida"
    return "autorizada"


async def _saida_guia(g: dict, hoje: str | None = None) -> dict:
    hoje = hoje or agora_local().date().isoformat()
    usadas = await _usadas(g["id"])
    saldo = max(0, int(g.get("sessoes_autorizadas") or 0) - usadas)
    sit = _situacao(g, usadas, hoje)
    vence_em = (date.fromisoformat(g["validade"]) - date.fromisoformat(hoje)).days if g.get("validade") else None
    return {**{k: v for k, v in g.items() if k != "_id"}, "usadas": usadas, "saldo": saldo, "situacao": sit, "vence_em_dias": vence_em,
            "alerta": sit == "autorizada" and (saldo <= 2 or (vence_em is not None and vence_em <= 7)), "created_at": _iso(g.get("created_at"))}


@router.get("/guias")
async def guias(paciente_id: str | None = None, convenio_id: str | None = None, principal: Principal = Depends(require(LER))):
    filtro: dict = {}
    if paciente_id:
        filtro["paciente_id"] = paciente_id
    if convenio_id:
        filtro["convenio_id"] = convenio_id
    docs = await db.guias.find(filtro).sort("created_at", -1).to_list(1000)
    hoje = agora_local().date().isoformat()
    return [await _saida_guia(g, hoje) for g in docs]


async def _validar_guia(input: GuiaIn) -> tuple[dict, dict]:
    conv = await db.convenios.find_one({"id": input.convenio_id})
    pac = await db.pessoas.find_one({"id": input.paciente_id}, {"id": 1, "nome": 1})
    if not conv or not pac:
        raise HTTPException(422, "Operadora ou paciente não encontrado")
    if input.servico_id and not await db.servicos.find_one({"id": input.servico_id}, {"id": 1}):
        raise HTTPException(422, "Serviço não encontrado")
    if input.status == "autorizada" and not (input.senha or input.numero_operadora):
        raise HTTPException(422, "Guia autorizada precisa da senha ou do número da guia na operadora")
    if input.validade and input.data_autorizacao and input.validade < input.data_autorizacao:
        raise HTTPException(422, "A validade não pode ser antes da autorização")
    return conv, pac


async def _lembrar_carteira(paciente_id: str, convenio_id: str, numero: str) -> None:
    p = await db.pessoas.find_one({"id": paciente_id}, {"carteiras": 1}) or {}
    cs = [c for c in p.get("carteiras") or [] if c.get("convenio_id") != convenio_id] + [{"convenio_id": convenio_id, "numero": numero}]
    await db.pessoas.update_one({"id": paciente_id}, {"$set": {"carteiras": cs}})


@router.post("/guias", status_code=201)
async def nova_guia(input: GuiaIn, principal: Principal = Depends(require(OPERAR))):
    conv, pac = await _validar_guia(input)
    r = await db.convenios.find_one_and_update({"id": conv["id"]}, {"$inc": {"ultima_guia": 1}}, return_document=ReturnDocument.AFTER)
    numero = f"{int((r or {}).get('ultima_guia') or 1):08d}"
    gid = new_id()
    doc = {"_id": gid, "id": gid, **input.model_dump(), "convenio_nome": conv["nome"], "paciente_nome": pac.get("nome"),
           "numero_prestador": numero, "created_at": now_utc(), "criado_por": principal.nome}
    await db.guias.insert_one(doc)
    await _lembrar_carteira(input.paciente_id, conv["id"], input.numero_carteira)
    await _consumir_pendentes(doc)
    return await _saida_guia(doc)


@router.put("/guias/{gid}")
async def editar_guia(gid: str, input: GuiaIn, principal: Principal = Depends(require(OPERAR))):
    g = await db.guias.find_one({"id": gid})
    if not g:
        raise HTTPException(404, "Guia não encontrada")
    if input.convenio_id != g["convenio_id"] or input.paciente_id != g["paciente_id"]:
        raise HTTPException(422, "Operadora e paciente da guia não mudam. Crie outra guia.")
    await _validar_guia(input)
    usadas = await _usadas(gid)
    if input.sessoes_autorizadas < usadas:
        raise HTTPException(409, f"Esta guia já tem {usadas} sessão(ões) usada(s)")
    await db.guias.update_one({"id": gid}, {"$set": input.model_dump()})
    await _lembrar_carteira(input.paciente_id, input.convenio_id, input.numero_carteira)
    novo = {**g, **input.model_dump()}
    await _consumir_pendentes(novo)
    return await _saida_guia(novo)


@router.delete("/guias/{gid}", status_code=204)
async def remover_guia(gid: str, principal: Principal = Depends(require(OPERAR))):
    if await db.guia_usos.find_one({"guia_id": gid}, {"_id": 1}):
        raise HTTPException(409, "Guia com sessão usada não pode ser excluída. Marque como negada ou ajuste.")
    await db.guias.delete_one({"id": gid})


# ------------------------------------------------------------------ consumo (chamado pela presença)


async def _guia_para(a: dict, paciente_id: str) -> dict | None:
    data = a["data"]
    candidatas = []
    async for g in db.guias.find({"paciente_id": paciente_id, "status": "autorizada"}):
        if g.get("servico_id") and g["servico_id"] not in (a.get("servico_ids") or []):
            continue
        if g.get("validade") and g["validade"] < data:
            continue
        if g.get("data_autorizacao") and g["data_autorizacao"] > data:
            continue
        if await _usadas(g["id"]) >= int(g.get("sessoes_autorizadas") or 0):
            continue
        candidatas.append(g)
    candidatas.sort(key=lambda g: (g.get("validade") or "9999", _iso(g.get("created_at")) or ""))
    return candidatas[0] if candidatas else None


async def registrar_uso(a: dict, paciente_id: str) -> str | None:
    """Paciente presente: consome uma sessão da guia que cobre a sessão (uma vez por sessão)."""
    _id = f"{a['id']}|{paciente_id}"
    if await db.guia_usos.find_one({"_id": _id}, {"_id": 1}):
        return None
    g = await _guia_para(a, paciente_id)
    if not g:
        return None
    servico = next((s for s in a.get("servicos") or [] if not g.get("servico_id") or s.get("id") == g["servico_id"]), (a.get("servicos") or [{}])[0])
    try:
        await db.guia_usos.insert_one({"_id": _id, "id": _id, "guia_id": g["id"], "convenio_id": g["convenio_id"], "paciente_id": paciente_id,
                                       "agendamento_id": a["id"], "data": a["data"], "servico_id": servico.get("id"), "servico_nome": servico.get("nome"),
                                       "profissional_id": a.get("profissional_id"), "lote_id": None, "em": now_utc()})
    except Exception:
        return None
    return g["id"]


async def desfazer_uso(a: dict, paciente_id: str) -> None:
    await db.guia_usos.delete_one({"_id": f"{a['id']}|{paciente_id}", "lote_id": None})


async def _consumir_pendentes(g: dict) -> None:
    """Guia cadastrada depois da sessão: consome as presenças já marcadas que ela cobre."""
    if g.get("status") != "autorizada":
        return
    from routers.sessoes import participantes, presenca_efetiva

    filtro: dict = {"participantes_ids": g["paciente_id"]}
    vistos = set()
    for f in (filtro, {"cliente_id": g["paciente_id"]}):
        async for a in db.agendamentos.find(f):
            if a["id"] in vistos or a.get("status") == "cancelado":
                continue
            vistos.add(a["id"])
            p = next((x for x in participantes(a) if x.get("cliente_id") == g["paciente_id"]), None)
            if p and presenca_efetiva(a, p) == "presente":
                await registrar_uso(a, g["paciente_id"])


# ------------------------------------------------------------------ faturamento


class LoteIn(BaseModel):
    convenio_id: str
    inicio: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    fim: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


def _saida_lote(l: dict) -> dict:
    return {k: (_iso(v) if k.endswith("_em") else v) for k, v in l.items() if k != "_id"}


@router.get("/lotes")
async def lotes(principal: Principal = Depends(require(GERIR))):
    return [_saida_lote(l) for l in await db.lotes_fat.find({}).sort("created_em", -1).to_list(300)]


@router.get("/a-faturar")
async def a_faturar(convenio_id: str, inicio: str, fim: str, principal: Principal = Depends(require(GERIR))):
    usos = [u for u in await db.guia_usos.find({"convenio_id": convenio_id, "lote_id": None}).to_list(5000) if inicio <= u["data"] <= fim]
    return {"sessoes": len(usos), "pacientes": len({u["paciente_id"] for u in usos})}


async def _valor(conv: dict, servico_id: str | None) -> tuple[str | None, str | None, float]:
    item = next((t for t in conv.get("tabela") or [] if t.get("servico_id") == servico_id), None)
    if not item:
        return None, None, 0.0
    return item["codigo"], item.get("descricao"), float(item["valor"])


@router.post("/lotes", status_code=201)
async def criar_lote(input: LoteIn, principal: Principal = Depends(require(GERIR))):
    conv = await db.convenios.find_one({"id": input.convenio_id})
    if not conv:
        raise HTTPException(404, "Operadora não encontrada")
    usos = [u for u in await db.guia_usos.find({"convenio_id": conv["id"], "lote_id": None}).to_list(5000) if input.inicio <= u["data"] <= input.fim]
    if not usos:
        raise HTTPException(422, "Nenhuma sessão a faturar nesse período")
    sem_codigo = sorted({u.get("servico_nome") or "?" for u in usos if not next((t for t in conv.get("tabela") or [] if t.get("servico_id") == u.get("servico_id")), None)})
    if sem_codigo:
        raise HTTPException(422, f"Cadastre o código e o valor na tabela da operadora para: {', '.join(sem_codigo)}")
    r = await db.convenios.find_one_and_update({"id": conv["id"]}, {"$inc": {"ultimo_lote": 1}}, return_document=ReturnDocument.AFTER)
    numero = int((r or {}).get("ultimo_lote") or 1)
    lid = new_id()
    por_guia: dict[str, list[dict]] = {}
    for u in sorted(usos, key=lambda u: u["data"]):
        por_guia.setdefault(u["guia_id"], []).append(u)
    itens, total = [], 0.0
    for gid, us in por_guia.items():
        g = await db.guias.find_one({"id": gid}) or {}
        for u in us:
            codigo, desc, valor = await _valor(conv, u.get("servico_id"))
            itens.append({"uso_id": u["_id"], "guia_id": gid, "numero_guia": g.get("numero_prestador"), "paciente_id": u["paciente_id"],
                          "paciente_nome": g.get("paciente_nome"), "data": u["data"], "codigo": codigo, "descricao": desc or u.get("servico_nome"),
                          "valor": valor, "profissional_id": u.get("profissional_id")})
            total += valor
    lote = {"_id": lid, "id": lid, "numero": numero, "convenio_id": conv["id"], "convenio_nome": conv["nome"], "inicio": input.inicio, "fim": input.fim,
            "itens": itens, "guias": len(por_guia), "sessoes": len(itens), "total": round(total, 2), "status": "aberto", "created_em": now_utc(),
            "criado_por": principal.nome, "recebido": None, "glosa": None}
    await db.lotes_fat.insert_one(lote)
    for u in usos:
        await db.guia_usos.update_one({"_id": u["_id"], "lote_id": None}, {"$set": {"lote_id": lid}})
    return _saida_lote(lote)


async def _lote(lid: str) -> dict:
    l = await db.lotes_fat.find_one({"id": lid})
    if not l:
        raise HTTPException(404, "Lote não encontrado")
    return l


@router.delete("/lotes/{lid}", status_code=204)
async def desfazer_lote(lid: str, principal: Principal = Depends(require(GERIR))):
    l = await _lote(lid)
    if l.get("status") != "aberto":
        raise HTTPException(409, "Só lote aberto (não enviado) pode ser desfeito")
    await db.guia_usos.update_many({"lote_id": lid}, {"$set": {"lote_id": None}})
    await db.lotes_fat.delete_one({"id": lid})


@router.get("/lotes/{lid}/xml")
async def xml_lote(lid: str, principal: Principal = Depends(require(GERIR))):
    from lib import tiss

    l = await _lote(lid)
    conv = await db.convenios.find_one({"id": l["convenio_id"]}) or {}
    emp = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1, "cnpj": 1, "titular": 1}) if empresa_atual_db() else None
    prestador = {"nome": (emp or {}).get("nome"), "cnpj": (emp or {}).get("cnpj") or ((emp or {}).get("titular") or {}).get("documento"), "cnes": conv.get("cnes")}
    faltando = []
    if not conv.get("codigo_prestador") and not prestador["cnpj"]:
        faltando.append("código do prestador na operadora (cadastro da operadora)")
    profs: dict[str, dict] = {}
    guias_xml = []
    por_guia: dict[str, list[dict]] = {}
    for i in l["itens"]:
        por_guia.setdefault(i["guia_id"], []).append(i)
    for gid, its in por_guia.items():
        g = await db.guias.find_one({"id": gid}) or {}
        pid = its[0].get("profissional_id")
        if pid not in profs:
            u = await db.usuarios.find_one({"id": pid}, {"nome": 1, "tiss": 1}) or {}
            profs[pid] = {"nome": u.get("nome"), **(u.get("tiss") or {})}
            if not u.get("tiss"):
                faltando.append(f"dados TISS de {u.get('nome') or 'profissional'} (conselho, número, UF, CBO)")
        guias_xml.append({"guia": g, "paciente": {"nome": g.get("paciente_nome")}, "profissional": profs[pid],
                          "itens": [{"data": i["data"], "codigo": i["codigo"], "descricao": i["descricao"], "valor": i["valor"], "quantidade": 1} for i in its]})
    if faltando:
        raise HTTPException(422, "Falta para gerar o XML: " + "; ".join(sorted(set(faltando))))
    xml, h = tiss.gerar_lote(operadora=conv, prestador=prestador, lote=l, guias=guias_xml, agora=agora_local())
    await db.lotes_fat.update_one({"id": lid}, {"$set": {"hash": h, "xml_em": now_utc()}})
    nome = f"lote-{l['numero']:05d}-{(conv.get('registro_ans') or 'ans')}.xml"
    return Response(content=xml.encode("iso-8859-1", errors="replace"), media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


class EnvioIn(BaseModel):
    protocolo: str | None = Field(default=None, max_length=40)


@router.post("/lotes/{lid}/enviado")
async def enviado(lid: str, input: EnvioIn, principal: Principal = Depends(require(GERIR))):
    l = await _lote(lid)
    if l.get("status") != "aberto":
        raise HTTPException(409, "Lote já enviado")
    await db.lotes_fat.update_one({"id": lid}, {"$set": {"status": "enviado", "protocolo": input.protocolo, "enviado_em": now_utc(), "enviado_por": principal.nome}})
    return _saida_lote({**l, "status": "enviado", "protocolo": input.protocolo})


class RecebidoIn(BaseModel):
    valor: float = Field(ge=0, le=10_000_000)
    data: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    motivo_glosa: str | None = Field(default=None, max_length=500)


@router.post("/lotes/{lid}/recebido")
async def recebido(lid: str, input: RecebidoIn, principal: Principal = Depends(require(GERIR))):
    l = await _lote(lid)
    if l.get("status") not in ("enviado", "aberto"):
        raise HTTPException(409, "Recebimento já registrado")
    if input.valor > l["total"] + 0.001:
        raise HTTPException(422, "O valor recebido passa do total do lote")
    r = await db.lotes_fat.update_one({"id": lid, "status": l["status"]}, {"$set": {
        "status": "pago" if abs(input.valor - l["total"]) < 0.005 else "pago_com_glosa", "recebido": round(input.valor, 2),
        "glosa": round(l["total"] - input.valor, 2), "motivo_glosa": input.motivo_glosa, "recebido_em": now_utc(), "recebido_por": principal.nome}})
    if r.modified_count == 1 and input.valor > 0:
        conta = await db.plano_contas.find_one({"codigo": "1.1.1"}) or await db.plano_contas.find_one({"tipo": "receita"})
        if conta:
            try:
                await db.transacoes.insert_one({
                    "_id": f"lote-{lid}", "id": f"lote-{lid}", "descricao": f"Convênio {l['convenio_nome']} | lote {l['numero']} ({l['sessoes']} sessões)"[:300],
                    "tipo": "receber", "valor": round(input.valor, 2), "plano_conta_id": conta["id"], "imovel_id": None, "pessoa_id": None,
                    "corretor_id": None, "evento_id": None, "contrato_id": None, "vencimento": input.data, "pagamento": input.data, "status": "pago",
                    "forma_pagamento": "outro", "vencido": False, "cancelado_em": None, "created_at": now_utc()})
            except Exception:
                pass
    return _saida_lote(await _lote(lid))
