"""Lista de espera e remanejamento da agenda (regras, não modelo de IA: ver CLAUDE.md).

- `lista_espera`: paciente que quer horário (serviço, profissional ou qualquer um, dias da semana, período, prioridade).
- Vaga: agendamento futuro cancelado (pelo CRM ou pela resposta "2" ao lembrete). Os candidatos da lista são
  ordenados por: serviço igual, profissional pedido, dia e período preferidos, prioridade e tempo de espera.
- Oferta pelo WhatsApp (`espera_ofertas`, `_id` = vaga|espera): o primeiro que responder "1" fica com o horário
  (`criar_agendamento` com trava; se alguém já pegou, avisa). Com `espera_config.auto`, ao abrir a vaga o sistema
  oferece sozinho ao primeiro candidato e, sem resposta em `minutos`, passa ao próximo (no toque da fila do WhatsApp).
- Remanejar (`POST /espera/remanejar`): profissional ausente num dia. Para cada atendimento, sugere o mesmo
  profissional em outro dia (mesmo horário ou o mais próximo, até 14 dias) ou outro profissional que faz o serviço
  no mesmo horário. Aplicar usa o PATCH normal da agenda (travas e conflitos continuam valendo).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.agenda_online import agora_local, config as cfg_agenda, horarios_livres, minutos
from lib.auth import Principal, require
from lib.db import db
from models.common import new_id, now_utc, utc_aware

router = APIRouter(prefix="/espera", tags=["atendimentos"])
DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]
PERIODOS = {"manha": (0, 12 * 60), "tarde": (12 * 60, 18 * 60), "noite": (18 * 60, 24 * 60)}


class EsperaIn(BaseModel):
    cliente_id: str | None = None
    cliente_nome: str | None = Field(default=None, max_length=120)
    cliente_telefone: str | None = Field(default=None, max_length=30)
    servico_id: str | None = None
    profissional_id: str | None = None
    dias: List[int] = Field(default_factory=list, max_length=7)  # 0 = domingo
    periodos: List[Literal["manha", "tarde", "noite"]] = Field(default_factory=list)
    prioridade: Literal["normal", "alta"] = "normal"
    observacoes: str | None = Field(default=None, max_length=500)


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def _saida(e: dict) -> dict:
    return {k: _iso(v) for k, v in e.items() if k != "_id"}


@router.get("")
async def listar(principal: Principal = Depends(require("agendamento:read"))):
    docs = await db.lista_espera.find({"status": {"$in": ["aguardando", "oferecido"]}}).to_list(1000)
    docs.sort(key=lambda e: (e.get("prioridade") != "alta", _iso(e.get("criado_em")) or ""))
    return [_saida(e) for e in docs]


@router.post("", status_code=201)
async def incluir(input: EsperaIn, principal: Principal = Depends(require("agendamento:write"))):
    from routers.atendimentos import _cliente

    if any(d < 0 or d > 6 for d in input.dias):
        raise HTTPException(422, "Dia da semana inválido")
    papel = "paciente" if principal.segmento in ("terapia", "odontologia") else "cliente"
    cli = await _cliente(input.cliente_id, input.cliente_nome, input.cliente_telefone, papel)
    if await db.lista_espera.find_one({"cliente_id": cli["id"], "servico_id": input.servico_id, "status": {"$in": ["aguardando", "oferecido"]}}, {"id": 1}):
        raise HTTPException(409, "Este paciente já está na lista de espera para esse serviço")
    serv = await db.servicos.find_one({"id": input.servico_id}, {"nome": 1, "duracao_min": 1}) if input.servico_id else None
    prof = await db.usuarios.find_one({"id": input.profissional_id}, {"nome": 1}) if input.profissional_id else None
    eid = new_id()
    doc = {"_id": eid, "id": eid, "cliente_id": cli["id"], "cliente_nome": cli.get("nome"), "cliente_telefone": cli.get("telefone"),
           "servico_id": input.servico_id, "servico_nome": (serv or {}).get("nome"), "profissional_id": input.profissional_id,
           "profissional_nome": (prof or {}).get("nome"), "dias": sorted(set(input.dias)), "periodos": input.periodos, "prioridade": input.prioridade,
           "observacoes": input.observacoes, "status": "aguardando", "criado_em": now_utc(), "criado_por": principal.nome}
    await db.lista_espera.insert_one(doc)
    return _saida(doc)


@router.delete("/{eid}", status_code=204)
async def remover(eid: str, principal: Principal = Depends(require("agendamento:write"))):
    await db.lista_espera.update_one({"id": eid}, {"$set": {"status": "removido", "removido_em": now_utc()}})


# ------------------------------------------------------------------ vagas e candidatos


def pontuar(e: dict, vaga: dict) -> int | None:
    """Pontos do candidato para a vaga (None = não serve)."""
    servicos_vaga = vaga.get("servico_ids") or []
    if e.get("servico_id") and e["servico_id"] not in servicos_vaga:
        return None
    if e.get("profissional_id") and e["profissional_id"] != vaga.get("profissional_id"):
        return None
    dia = date.fromisoformat(vaga["data"])
    dow = (dia.weekday() + 1) % 7
    if e.get("dias") and dow not in e["dias"]:
        return None
    ini = minutos(vaga["inicio"])
    if e.get("periodos") and not any(PERIODOS[p][0] <= ini < PERIODOS[p][1] for p in e["periodos"]):
        return None
    pts = 0
    pts += 40 if e.get("servico_id") else 10
    pts += 20 if e.get("profissional_id") else 0
    pts += 15 if e.get("dias") else 0
    pts += 10 if e.get("periodos") else 0
    pts += 50 if e.get("prioridade") == "alta" else 0
    criado = utc_aware(e["criado_em"]) if e.get("criado_em") else now_utc()
    pts += min(30, (now_utc() - criado).days)  # um ponto por dia de espera, até 30
    return pts


async def candidatos(vaga: dict, limite: int = 5) -> list[dict]:
    tentados = {o["espera_id"] async for o in db.espera_ofertas.find({"vaga_id": vaga["id"]}, {"espera_id": 1})}
    lista = []
    async for e in db.lista_espera.find({"status": "aguardando"}):
        if e["id"] in tentados or e.get("cliente_id") == vaga.get("cliente_id"):
            continue
        p = pontuar(e, vaga)
        if p is not None:
            lista.append({**_saida(e), "pontos": p})
    lista.sort(key=lambda x: -x["pontos"])
    return lista[:limite]


async def _vaga_livre(vaga: dict) -> bool:
    if vaga.get("vaga_preenchida"):
        return False
    from lib.agenda_online import ocupados

    ini, fim = minutos(vaga["inicio"]), minutos(vaga["fim"])
    return not any(a < fim and ini < b for a, b in await ocupados(vaga["profissional_id"], vaga["data"]))


@router.get("/vagas")
async def vagas(principal: Principal = Depends(require("agendamento:read"))):
    agora = agora_local()
    hoje = agora.date().isoformat()
    saida = []
    for a in await db.agendamentos.find({"status": "cancelado", "data": {"$gte": hoje}}).to_list(500):
        if a["data"] == hoje and minutos(a["inicio"]) <= agora.hour * 60 + agora.minute:
            continue
        if not await _vaga_livre(a):
            continue
        oferta = await db.espera_ofertas.find_one({"vaga_id": a["id"], "status": "aguardando"})
        saida.append({"id": a["id"], "data": a["data"], "inicio": a["inicio"], "fim": a["fim"], "profissional_id": a["profissional_id"],
                      "profissional_nome": a.get("profissional_nome"), "servicos": [s.get("nome") for s in a.get("servicos") or []],
                      "cancelado": a.get("cliente_nome"), "candidatos": await candidatos(a),
                      "oferta": {"nome": oferta.get("cliente_nome"), "expira_em": _iso(oferta.get("expira_em"))} if oferta else None})
    saida.sort(key=lambda v: (v["data"], v["inicio"]))
    return saida


# ------------------------------------------------------------------ oferta e agendamento


async def agendar_na_vaga(vaga: dict, e: dict, por: str) -> dict:
    from routers.atendimentos import _servicos, criar_agendamento

    prof = await db.usuarios.find_one({"id": vaga["profissional_id"]})
    if not prof:
        raise HTTPException(409, "Profissional da vaga não encontrado")
    servicos = await _servicos([e["servico_id"]] if e.get("servico_id") else vaga["servico_ids"])
    cli = await db.pessoas.find_one({"id": e["cliente_id"]})
    a = await criar_agendamento(prof=prof, servicos=servicos, dia=date.fromisoformat(vaga["data"]), inicio=vaga["inicio"], cliente=cli,
                                unidade_id=vaga.get("unidade_id"), observacoes="Encaixe da lista de espera", status="confirmado",
                                origem="manual", criado_por=por, encaixe=True)
    await db.lista_espera.update_one({"id": e["id"]}, {"$set": {"status": "agendado", "agendamento_id": a["id"], "agendado_em": now_utc()}})
    await db.agendamentos.update_one({"id": vaga["id"]}, {"$set": {"vaga_preenchida": a["id"]}})
    await db.espera_ofertas.update_many({"vaga_id": vaga["id"], "status": "aguardando"}, {"$set": {"status": "encerrada"}})
    return a


class AgendarIn(BaseModel):
    vaga_id: str


@router.post("/{eid}/agendar")
async def agendar(eid: str, input: AgendarIn, principal: Principal = Depends(require("agendamento:write"))):
    e = await db.lista_espera.find_one({"id": eid, "status": {"$in": ["aguardando", "oferecido"]}})
    vaga = await db.agendamentos.find_one({"id": input.vaga_id, "status": "cancelado"})
    if not e or not vaga:
        raise HTTPException(404, "Vaga ou paciente não encontrado")
    if not await _vaga_livre(vaga):
        raise HTTPException(409, "Esse horário já foi ocupado")
    a = await agendar_na_vaga(vaga, e, principal.nome)
    return {"agendamento_id": a["id"]}


async def oferecer(vaga: dict, e: dict, minutos_resposta: int, por: str) -> bool:
    """Manda a oferta pelo WhatsApp. False se não deu (sem telefone, sem número conectado)."""
    from lib import wa_campanhas as camp
    from lib.wa_cadencia import _br
    from lib.wa_fluxos import _enviar

    tel = camp.normalizar_telefone(e.get("cliente_telefone"))
    cfg = await db.espera_config.find_one({"_id": "config"}) or {}
    filtro = {"id": cfg["conexao_id"]} if cfg.get("conexao_id") else {"status": "conectado"}
    conexao = await db.wa_conexoes.find_one(filtro)
    if not tel or not conexao or conexao.get("status") != "conectado":
        return False
    _id = f"{vaga['id']}|{e['id']}"
    expira = now_utc() + timedelta(minutes=minutos_resposta)
    try:
        await db.espera_ofertas.insert_one({"_id": _id, "id": _id, "vaga_id": vaga["id"], "espera_id": e["id"], "cliente_nome": e.get("cliente_nome"),
                                            "status": "aguardando", "em": now_utc(), "expira_em": expira, "por": por})
    except Exception:
        return False
    conv = await camp._conversa_para(conexao, {"telefone": tel, "nome": e.get("cliente_nome"), "pessoa_id": e.get("cliente_id")})
    texto = (f"Oi, {camp.primeiro_nome(e.get('cliente_nome')) or 'tudo bem'}! Abriu um horário {_br(vaga['data'])} às {vaga['inicio']}"
             f" com {vaga.get('profissional_nome') or 'a equipe'}. Quer ficar com ele?\n\nResponda 1 para confirmar ou 2 se não puder.")
    await _enviar(conv, conexao, texto)
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"oferta_vaga": {"id": _id, "em": now_utc()}}})
    await db.lista_espera.update_one({"id": e["id"]}, {"$set": {"status": "oferecido"}})
    return True


@router.post("/{eid}/oferecer")
async def oferecer_rota(eid: str, input: AgendarIn, principal: Principal = Depends(require("agendamento:write"))):
    e = await db.lista_espera.find_one({"id": eid, "status": "aguardando"})
    vaga = await db.agendamentos.find_one({"id": input.vaga_id, "status": "cancelado"})
    if not e or not vaga:
        raise HTTPException(404, "Vaga ou paciente não encontrado")
    cfg = await db.espera_config.find_one({"_id": "config"}) or {}
    if not await oferecer(vaga, e, int(cfg.get("minutos") or 30), principal.nome):
        raise HTTPException(409, "Não deu para mandar: confira o celular do paciente e se há número de WhatsApp conectado.")
    return {"ok": True}


async def resposta_oferta(conv: dict, conexao: dict, texto: str) -> bool:
    """Resposta "1"/"2" a uma oferta de vaga. True = tratada (o robô de fluxo não roda)."""
    from lib.wa_fluxos import _enviar, normalizar
    from lib.wa_cadencia import NAO, SIM

    of = conv.get("oferta_vaga") or {}
    t = normalizar(texto).strip(" .!")
    if not of.get("id") or (t not in SIM and t not in NAO):
        return False
    oferta = await db.espera_ofertas.find_one({"_id": of["id"]})
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"oferta_vaga": None}})
    if not oferta:
        return False
    e = await db.lista_espera.find_one({"id": oferta["espera_id"]})
    if t in NAO:
        await db.espera_ofertas.update_one({"_id": oferta["_id"]}, {"$set": {"status": "recusada"}})
        if e and e.get("status") == "oferecido":
            await db.lista_espera.update_one({"id": e["id"]}, {"$set": {"status": "aguardando"}})
        await _enviar(conv, conexao, "Tudo bem! Você continua na lista de espera e avisamos no próximo horário.")
        await proxima_oferta(oferta["vaga_id"])
        return True
    vaga = await db.agendamentos.find_one({"id": oferta["vaga_id"]})
    if oferta.get("status") != "aguardando" or not vaga or not e or not await _vaga_livre(vaga):
        await _enviar(conv, conexao, "Que pena, esse horário acabou de ser preenchido. Você continua na lista de espera.")
        if e and e.get("status") == "oferecido":
            await db.lista_espera.update_one({"id": e["id"]}, {"$set": {"status": "aguardando"}})
        return True
    try:
        await agendar_na_vaga(vaga, e, "Cliente pelo WhatsApp")
    except HTTPException:
        await _enviar(conv, conexao, "Que pena, esse horário acabou de ser preenchido. Você continua na lista de espera.")
        return True
    from lib.wa_cadencia import _br

    await db.espera_ofertas.update_one({"_id": oferta["_id"]}, {"$set": {"status": "aceita"}})
    await _enviar(conv, conexao, f"Pronto! Seu horário ficou marcado para {_br(vaga['data'])} às {vaga['inicio']}. Até lá!")
    return True


async def proxima_oferta(vaga_id: str) -> bool:
    cfg = await db.espera_config.find_one({"_id": "config"}) or {}
    if not cfg.get("auto"):
        return False
    vaga = await db.agendamentos.find_one({"id": vaga_id, "status": "cancelado"})
    if not vaga or not await _vaga_livre(vaga) or vaga["data"] < agora_local().date().isoformat():
        return False
    if await db.espera_ofertas.find_one({"vaga_id": vaga_id, "status": "aguardando"}):
        return False
    for c in await candidatos(vaga, 10):
        e = await db.lista_espera.find_one({"id": c["id"]})
        if e and await oferecer(vaga, e, int(cfg.get("minutos") or 30), "Automático"):
            return True
    return False


async def vaga_aberta(a: dict) -> None:
    """Chamado quando um agendamento futuro é cancelado."""
    try:
        await proxima_oferta(a["id"])
    except Exception:
        pass


async def expirar_ofertas() -> int:
    """No toque da fila: oferta sem resposta no prazo passa para o próximo candidato."""
    n = 0
    for o in await db.espera_ofertas.find({"status": "aguardando"}).to_list(200):
        exp = o.get("expira_em")
        if exp and utc_aware(exp) < now_utc():
            await db.espera_ofertas.update_one({"_id": o["_id"], "status": "aguardando"}, {"$set": {"status": "expirada"}})
            await db.lista_espera.update_one({"id": o["espera_id"], "status": "oferecido"}, {"$set": {"status": "aguardando"}})
            if await proxima_oferta(o["vaga_id"]):
                n += 1
    return n


class EsperaCfgIn(BaseModel):
    auto: bool = False
    minutos: int = Field(default=30, ge=5, le=720)
    conexao_id: str | None = None


@router.get("/config")
async def ver_config(principal: Principal = Depends(require("agendamento:read"))):
    c = await db.espera_config.find_one({"_id": "config"}) or {}
    return {"auto": bool(c.get("auto")), "minutos": int(c.get("minutos") or 30), "conexao_id": c.get("conexao_id")}


@router.put("/config")
async def salvar_config(input: EsperaCfgIn, principal: Principal = Depends(require("usuario:manage"))):
    await db.espera_config.update_one({"_id": "config"}, {"$set": input.model_dump()}, upsert=True)
    return input.model_dump()


# ------------------------------------------------------------------ remanejar o dia de um profissional


class RemanejarIn(BaseModel):
    profissional_id: str
    data: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.post("/remanejar")
async def remanejar(input: RemanejarIn, principal: Principal = Depends(require("agendamento:write"))):
    cfg = {**await cfg_agenda(), "antecedencia_min": 0, "intervalo_min": 5}
    ags = [a for a in await db.agendamentos.find({"profissional_id": input.profissional_id, "data": input.data}).to_list(200)
           if a.get("status") in ("agendado", "confirmado")]
    profs = await db.usuarios.find({"atende": True, "ativo": {"$ne": False}}).to_list(100)
    servicos = {s["id"]: s for s in await db.servicos.find({}).to_list(500)}
    dia0 = date.fromisoformat(input.data)
    saida = []
    for a in sorted(ags, key=lambda x: x["inicio"]):
        dur = minutos(a["fim"]) - minutos(a["inicio"])
        opcoes = []
        # 1) outro profissional que faz o serviço, mesmo dia e horário
        for p in profs:
            if p["id"] == input.profissional_id:
                continue
            permitido = all(not servicos.get(s, {}).get("profissionais") or p["id"] in servicos[s]["profissionais"] for s in a.get("servico_ids") or [])
            if permitido and a["inicio"] in await horarios_livres(p, dia0, dur, cfg):
                opcoes.append({"tipo": "outro_profissional", "profissional_id": p["id"], "profissional_nome": p["nome"], "data": input.data, "inicio": a["inicio"]})
        # 2) mesmo profissional, próximos 14 dias, horário mais perto do original
        prof = next((p for p in profs if p["id"] == input.profissional_id), None)
        if prof:
            for k in range(1, 15):
                d = dia0 + timedelta(days=k)
                livres = await horarios_livres(prof, d, dur, cfg)
                if livres:
                    melhor = min(livres, key=lambda h: abs(minutos(h) - minutos(a["inicio"])))
                    opcoes.append({"tipo": "outro_dia", "profissional_id": prof["id"], "profissional_nome": prof["nome"], "data": d.isoformat(), "inicio": melhor})
                    if len([o for o in opcoes if o["tipo"] == "outro_dia"]) >= 2:
                        break
        saida.append({"agendamento_id": a["id"], "cliente_nome": a.get("cliente_nome"), "cliente_telefone": a.get("cliente_telefone"),
                      "inicio": a["inicio"], "fim": a["fim"], "servicos": [s.get("nome") for s in a.get("servicos") or []], "opcoes": opcoes[:4]})
    return {"data": input.data, "atendimentos": saida}
