"""Sessões: atendimento em grupo, presença por paciente e controle de atendimento (evolução em até 24 h).

- Serviço com `capacidade` > 1 aceita mais de um paciente no mesmo horário: `agendamento.participantes`
  (cliente_id, nome, telefone, presenca, evolucao_id) e `participantes_ids` (para busca). Agendamento antigo,
  sem a lista, tem um participante: o `cliente_id`.
- Presença: presente, falta ou falta_justificada, por paciente, marcada por quem atende ou pelo gestor.
  Sem marcação (só em sessão individual), atendimento concluído conta como presente e status "faltou" como falta.
- Evolução: quem esteve presente precisa de evolução no prontuário ligada à sessão em até 24 h depois do fim.
  `routers/pacientes.nova_evolucao` grava `no_prazo` e liga a evolução ao participante. A tela Controle de
  atendimento mostra pendentes, atrasadas e feitas fora do prazo. Só sessão com presença e evolução conta na
  folha do profissional (`routers/folha.py`).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.agenda_online import agora_local, tz
from lib.auth import Principal, require
from lib.db import db
from models.common import now_utc, utc_aware

router = APIRouter(prefix="/sessoes", tags=["atendimentos"])

PRAZO_H = 24
Presenca = Literal["presente", "falta", "falta_justificada"]


def participantes(a: dict) -> list[dict]:
    if a.get("participantes"):
        return [dict(p) for p in a["participantes"]]
    return [{"cliente_id": a.get("cliente_id"), "cliente_nome": a.get("cliente_nome"), "cliente_telefone": a.get("cliente_telefone"),
             "presenca": a.get("presenca"), "evolucao_id": a.get("evolucao_id")}]


def presenca_efetiva(a: dict, p: dict) -> str | None:
    if p.get("presenca"):
        return p["presenca"]
    if len(a.get("participantes") or []) > 1:
        return None  # em grupo a presença é marcada um a um
    if a.get("status") in ("concluido", "em_atendimento"):
        return "presente"
    if a.get("status") == "faltou":
        return "falta"
    return None


def prazo_evolucao(a: dict) -> datetime:
    fim = datetime.fromisoformat(f"{a['data']}T{a.get('fim') or a.get('inicio') or '23:59'}").replace(tzinfo=tz())
    return fim + timedelta(hours=PRAZO_H)


async def _agendamento(aid: str, principal: Principal) -> dict:
    a = await db.agendamentos.find_one({"id": aid})
    if not a:
        raise HTTPException(404, "Agendamento não encontrado")
    return a


async def _gravar(a: dict, lista: list[dict], extra: dict | None = None) -> dict:
    principal_cli = lista[0]
    mudar = {"participantes": lista, "participantes_ids": [p["cliente_id"] for p in lista if p.get("cliente_id")],
             "cliente_id": principal_cli.get("cliente_id"), "cliente_nome": principal_cli.get("cliente_nome"),
             "cliente_telefone": principal_cli.get("cliente_telefone"), "grupo": len(lista) > 1, "updated_at": now_utc(), **(extra or {})}
    await db.agendamentos.update_one({"id": a["id"]}, {"$set": mudar})
    return {**a, **mudar}


async def capacidade(a: dict) -> int:
    docs = await db.servicos.find({"id": {"$in": a.get("servico_ids") or []}}, {"capacidade": 1}).to_list(20)
    return max([int(d.get("capacidade") or 1) for d in docs] or [1])


def _saida(a: dict, cap: int | None = None) -> dict:
    return {"id": a["id"], "data": a.get("data"), "inicio": a.get("inicio"), "fim": a.get("fim"), "status": a.get("status"),
            "profissional_id": a.get("profissional_id"), "profissional_nome": a.get("profissional_nome"),
            "servicos": [s.get("nome") for s in a.get("servicos") or []], "capacidade": cap,
            "participantes": [{**p, "presenca_efetiva": presenca_efetiva(a, p)} for p in participantes(a)]}


@router.get("/{aid}")
async def ver(aid: str, principal: Principal = Depends(require("agendamento:read"))):
    a = await _agendamento(aid, principal)
    return _saida(a, await capacidade(a))


class ParticipanteIn(BaseModel):
    cliente_id: str | None = None
    cliente_nome: str | None = Field(default=None, max_length=120)
    cliente_telefone: str | None = Field(default=None, max_length=30)


@router.post("/{aid}/participantes", status_code=201)
async def incluir(aid: str, input: ParticipanteIn, principal: Principal = Depends(require("agendamento:write"))):
    from routers.atendimentos import _cliente

    a = await _agendamento(aid, principal)
    if a.get("status") in ("cancelado", "concluido"):
        raise HTTPException(409, "Sessão cancelada ou concluída não recebe paciente novo")
    cap = await capacidade(a)
    lista = participantes(a)
    if len(lista) >= cap:
        raise HTTPException(409, f"Sessão cheia: o serviço aceita {cap} paciente(s). Aumente a capacidade do serviço para atender em grupo.")
    papel = "paciente" if principal.segmento in ("terapia", "odontologia") else "cliente"
    cli = await _cliente(input.cliente_id, input.cliente_nome, input.cliente_telefone, papel)
    if any(p.get("cliente_id") == cli["id"] for p in lista):
        raise HTTPException(409, "Este paciente já está na sessão")
    lista.append({"cliente_id": cli["id"], "cliente_nome": cli.get("nome"), "cliente_telefone": cli.get("telefone"), "presenca": None,
                  "evolucao_id": None})
    return _saida(await _gravar(a, lista), cap)


@router.delete("/{aid}/participantes/{cliente_id}")
async def retirar(aid: str, cliente_id: str, principal: Principal = Depends(require("agendamento:write"))):
    a = await _agendamento(aid, principal)
    lista = participantes(a)
    if len(lista) <= 1:
        raise HTTPException(409, "A sessão precisa de pelo menos um paciente. Para desmarcar, cancele o agendamento.")
    alvo = next((p for p in lista if p.get("cliente_id") == cliente_id), None)
    if not alvo:
        raise HTTPException(404, "Paciente não está na sessão")
    if alvo.get("evolucao_id"):
        raise HTTPException(409, "Este paciente já tem evolução desta sessão no prontuário")
    return _saida(await _gravar(a, [p for p in lista if p.get("cliente_id") != cliente_id]), await capacidade(a))


class PresencaIn(BaseModel):
    cliente_id: str
    presenca: Presenca | None = None
    justificativa: str | None = Field(default=None, max_length=300)


@router.post("/{aid}/presenca")
async def presenca(aid: str, input: PresencaIn, principal: Principal = Depends(require("agendamento:write"))):
    a = await _agendamento(aid, principal)
    if not principal.is_admin and a.get("profissional_id") != principal.usuario_id:
        raise HTTPException(403, "Só quem atende a sessão ou o gestor marca presença")
    if a.get("status") == "cancelado":
        raise HTTPException(409, "Sessão cancelada")
    if a["data"] > agora_local().date().isoformat():
        raise HTTPException(409, "A presença é marcada no dia da sessão")
    lista = participantes(a)
    alvo = next((p for p in lista if p.get("cliente_id") == input.cliente_id), None)
    if not alvo:
        raise HTTPException(404, "Paciente não está na sessão")
    if alvo.get("evolucao_id") and input.presenca != "presente":
        raise HTTPException(409, "Já existe evolução desta sessão para o paciente: ele esteve presente")
    alvo.update({"presenca": input.presenca, "justificativa": input.justificativa if input.presenca == "falta_justificada" else None,
                 "presenca_por": principal.nome, "presenca_em": now_utc()})
    extra: dict = {}
    if a.get("status") in ("agendado", "confirmado") and input.presenca == "presente":
        extra["status"] = "em_atendimento"
    if a.get("status") in ("agendado", "confirmado") and all(p.get("presenca") in ("falta", "falta_justificada") for p in lista):
        extra["status"] = "faltou"
    return _saida(await _gravar(a, lista, extra), await capacidade(a))


# ------------------------------------------------------------------ controle de atendimento


def situacao_evolucao(a: dict, p: dict, evol: dict | None, agora: datetime) -> str | None:
    """None (não precisa), feita, feita_fora_do_prazo, pendente, atrasada."""
    if presenca_efetiva(a, p) != "presente":
        return None
    if evol:
        return "feita" if evol.get("no_prazo", True) else "feita_fora_do_prazo"
    return "atrasada" if agora > prazo_evolucao(a) else "pendente"


async def linhas_controle(inicio: str, fim: str, profissional_id: str | None) -> list[dict]:
    filtro: dict = {"data": {"$gte": inicio, "$lte": fim}}
    if profissional_id:
        filtro["profissional_id"] = profissional_id
    ags = [a for a in await db.agendamentos.find(filtro).to_list(5000) if a.get("status") != "cancelado"]
    ids = [a["id"] for a in ags]
    evols: dict[tuple[str, str], dict] = {}
    for i in range(0, len(ids), 30):
        async for e in db.prontuario.find({"agendamento_id": {"$in": ids[i:i + 30]}}, {"id": 1, "agendamento_id": 1, "paciente_id": 1,
                                                                                       "no_prazo": 1, "created_at": 1, "autor_nome": 1, "tipo": 1}):
            evols.setdefault((e["agendamento_id"], e["paciente_id"]), e)
    agora = now_utc()
    hoje = agora_local().date().isoformat()
    linhas = []
    for a in sorted(ags, key=lambda x: (x["data"], x.get("inicio") or "")):
        if a["data"] > hoje:
            continue
        for p in participantes(a):
            e = evols.get((a["id"], p.get("cliente_id")))
            linhas.append({"agendamento_id": a["id"], "data": a["data"], "inicio": a.get("inicio"), "fim": a.get("fim"), "status": a.get("status"),
                           "profissional_id": a.get("profissional_id"), "profissional_nome": a.get("profissional_nome"),
                           "servicos": [s.get("nome") for s in a.get("servicos") or []], "grupo": len(participantes(a)) > 1,
                           "valor": a.get("valor"), "paciente_id": p.get("cliente_id"), "paciente_nome": p.get("cliente_nome"),
                           "presenca": presenca_efetiva(a, p), "presenca_marcada": bool(p.get("presenca")),
                           "evolucao": situacao_evolucao(a, p, e, agora), "evolucao_id": (e or {}).get("id"),
                           "evolucao_em": utc_aware(e["created_at"]).isoformat() if e and e.get("created_at") else None,
                           "prazo": prazo_evolucao(a).isoformat()})
    return linhas


@router.get("/controle/lista")
async def controle(inicio: str, fim: str, profissional_id: str | None = None, principal: Principal = Depends(require("agendamento:read"))):
    try:
        d0, d1 = date.fromisoformat(inicio), date.fromisoformat(fim)
    except ValueError:
        raise HTTPException(422, "Datas no formato AAAA-MM-DD")
    if d1 < d0 or (d1 - d0).days > 62:
        raise HTTPException(422, "Período máximo de 62 dias")
    if not principal.is_admin:
        profissional_id = principal.usuario_id  # cada profissional vê o dele
    linhas = await linhas_controle(inicio, fim, profissional_id)
    resumo = {"sessoes": len({l["agendamento_id"] for l in linhas}), "atendimentos": len(linhas),
              "presentes": sum(1 for l in linhas if l["presenca"] == "presente"),
              "faltas": sum(1 for l in linhas if l["presenca"] in ("falta", "falta_justificada")),
              "sem_presenca": sum(1 for l in linhas if l["presenca"] is None),
              **{k: sum(1 for l in linhas if l["evolucao"] == k) for k in ("feita", "feita_fora_do_prazo", "pendente", "atrasada")}}
    feitas = resumo["feita"] + resumo["feita_fora_do_prazo"]
    resumo["no_prazo_pct"] = round(resumo["feita"] * 100 / (feitas + resumo["atrasada"])) if (feitas + resumo["atrasada"]) else None
    return {"resumo": resumo, "linhas": linhas}


@router.get("/controle/pendentes")
async def minhas_pendentes(principal: Principal = Depends(require("agendamento:read"))):
    """Evoluções que faltam escrever (últimos 30 dias) de quem está logado: aviso na agenda."""
    hoje = agora_local().date()
    linhas = await linhas_controle((hoje - timedelta(days=30)).isoformat(), hoje.isoformat(), principal.usuario_id)
    falta = [l for l in linhas if l["evolucao"] in ("pendente", "atrasada")]
    return {"pendentes": sum(1 for l in falta if l["evolucao"] == "pendente"), "atrasadas": sum(1 for l in falta if l["evolucao"] == "atrasada"),
            "itens": falta[:50]}
