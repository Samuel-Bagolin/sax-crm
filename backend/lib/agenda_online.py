"""Regras da agenda de atendimentos (barbearia, clínicas, odontologia e estética).

- Profissional = usuário com `atende=True` e uma jornada semanal (`jornada`: {"0".."6": [[ini, fim], ...]},
  0 = domingo). Sem jornada, vale a jornada padrão da empresa.
- Horário livre = dentro da jornada, fora de agendamentos ativos e bloqueios, respeitando a antecedência.
- Dois agendamentos nunca ocupam o mesmo horário do mesmo profissional: cada bloco de 5 minutos vira
  uma trava (`agenda_travas`, _id único). A gravação das travas é atômica; se outra pessoa reservou o
  mesmo horário um instante antes, a segunda gravação falha e o cliente vê "horário acabou de ser ocupado".
"""

from __future__ import annotations

import os
import re
import unicodedata
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from lib.db import db

BLOCO = 5  # minutos por trava
ATIVOS = ("agendado", "confirmado", "em_atendimento", "concluido")

JORNADA_PADRAO = {str(d): [["09:00", "12:00"], ["13:00", "19:00"]] for d in range(1, 6)} | {"6": [["09:00", "14:00"]], "0": []}

CONFIG_PADRAO = {
    "ativo": False, "slug": None, "intervalo_min": 15, "antecedencia_min": 60, "janela_dias": 30,
    "cancelamento_horas": 2, "mensagem": "", "pedir_email": False, "jornada_padrao": JORNADA_PADRAO,
    "dias_retorno": 30,
}


def tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("TZ_EMPRESA", "America/Sao_Paulo"))


def agora_local() -> datetime:
    return datetime.now(tz())


def minutos(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def hhmm(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validar_hora(v: str) -> str:
    if not HORA.match(v or ""):
        raise HTTPException(422, "Horário inválido. Use HH:MM.")
    return v


def validar_data(v: str) -> date:
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        raise HTTPException(422, "Data inválida. Use AAAA-MM-DD.")


def slug_de(texto: str) -> str:
    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40] or "agenda"


async def config() -> dict:
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"agenda_online": 1}) or {}
    return {**CONFIG_PADRAO, **(cfg.get("agenda_online") or {})}


def jornada_do(prof: dict, cfg: dict) -> dict:
    return prof.get("jornada") or cfg.get("jornada_padrao") or JORNADA_PADRAO


def _sobrepoe(a_ini: int, a_fim: int, b_ini: int, b_fim: int) -> bool:
    return a_ini < b_fim and b_ini < a_fim


async def ocupados(profissional_id: str, dia: str, ignorar: str | None = None) -> list[tuple[int, int]]:
    faixas = []
    async for a in db.agendamentos.find({"profissional_id": profissional_id, "data": dia, "status": {"$in": list(ATIVOS)}},
                                        {"id": 1, "inicio": 1, "fim": 1}):
        if a["id"] != ignorar:
            faixas.append((minutos(a["inicio"]), minutos(a["fim"])))
    async for b in db.agenda_bloqueios.find({"data": dia}):
        if b.get("profissional_id") in (None, profissional_id):
            faixas.append((minutos(b.get("inicio") or "00:00"), minutos(b.get("fim") or "23:59")))
    return faixas


async def horarios_livres(prof: dict, dia: date, duracao: int, cfg: dict, ignorar: str | None = None) -> list[str]:
    jornada = jornada_do(prof, cfg).get(str((dia.weekday() + 1) % 7), [])
    if not jornada:
        return []
    passo = max(5, int(cfg.get("intervalo_min") or 15))
    agora = agora_local()
    limite = agora + timedelta(minutes=int(cfg.get("antecedencia_min") or 0))
    ocup = await ocupados(prof["id"], dia.isoformat(), ignorar)
    livres = []
    for ini, fim in jornada:
        t, f = minutos(ini), minutos(fim)
        while t + duracao <= f:
            inicio_dt = datetime.combine(dia, datetime.min.time(), tzinfo=tz()) + timedelta(minutes=t)
            if inicio_dt >= limite and not any(_sobrepoe(t, t + duracao, a, b) for a, b in ocup):
                livres.append(hhmm(t))
            t += passo
    return livres


def _ids_travas(profissional_id: str, dia: str, ini: int, fim: int) -> list[str]:
    inicio = ini - ini % BLOCO
    return [f"{profissional_id}:{dia}:{hhmm(m)}" for m in range(inicio, fim, BLOCO)]


async def travar(profissional_id: str, dia: str, ini: int, fim: int, agendamento_id: str) -> None:
    """Grava as travas do horário de uma vez. Falha com 409 se algum bloco já estiver ocupado."""
    ids = _ids_travas(profissional_id, dia, ini, fim)
    docs = [{"_id": i, "agendamento_id": agendamento_id} for i in ids]
    try:
        await db.agenda_travas.insert_many(docs)
    except Exception:
        # No Firestore a gravação é atômica; no banco de desenvolvimento pode ter gravado parte.
        await db.agenda_travas.delete_many({"_id": {"$in": ids}, "agendamento_id": agendamento_id})
        raise HTTPException(409, "Esse horário acabou de ser ocupado. Escolha outro.")


async def destravar(agendamento: dict) -> None:
    ids = _ids_travas(agendamento["profissional_id"], agendamento["data"], minutos(agendamento["inicio"]), minutos(agendamento["fim"]))
    await db.agenda_travas.delete_many({"_id": {"$in": ids}, "agendamento_id": agendamento["id"]})
