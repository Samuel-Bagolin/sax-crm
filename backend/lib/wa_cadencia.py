"""Mensagens automáticas do WhatsApp (cadência de relacionamento).

- Lembrete do dia seguinte com confirmação pela resposta: "1" confirma, "2" cancela e libera o horário.
- Parabéns no aniversário.
- Retorno: quem passou do prazo de retorno do serviço (`servicos.retorno_dias`, senão `dias_retorno` da agenda)
  e não tem horário marcado recebe um convite para voltar (uma vez por último atendimento).

Uma vez por dia, a partir das 8h, `preparar_dia` monta uma campanha do sistema por tipo (`wa_campanhas.sistema`),
que anda pela mesma fila das campanhas (intervalo aleatório, janela de horário). Lembrete é transacional: não
conta no teto diário e vai mesmo para quem pediu para sair das campanhas. Aniversário e retorno respeitam o SAIR.
Config em `wa_cadencia` (`_id` "config"); controle do dia em `wa_cadencia_dias`; o que já foi mandado em
`wa_cadencia_feitos` (não repete).
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta

from lib import wa_campanhas as camp
from lib.db import db
from models.common import new_id, now_utc

logger = logging.getLogger(__name__)

TEXTOS = {
    "lembrete": "Oi, {nome}! Passando para lembrar do seu horário amanhã, {data}, às {hora}, com {profissional}.\n\nResponda 1 para confirmar ou 2 para cancelar.",
    "aniversario": "Parabéns, {nome}! Toda a equipe da {empresa} deseja um ótimo aniversário para você.",
    "retorno": "Oi, {nome}! Já faz um tempo desde o seu último atendimento aqui na {empresa}. Que tal marcar o próximo? É só responder esta mensagem.",
}
NOMES = {"lembrete": "Lembretes de", "aniversario": "Aniversariantes de", "retorno": "Retornos de"}
SIM = {"1", "sim", "confirmo", "confirmado", "confirmar", "ok", "s"}
NAO = {"2", "nao", "cancelar", "cancela", "desmarcar", "n"}
DIAS_SEMANA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


async def config() -> dict:
    c = await db.wa_cadencia.find_one({"_id": "config"}) or {}
    return {"conexao_id": c.get("conexao_id"),
            **{k: {"ativo": bool((c.get(k) or {}).get("ativo")), "texto": (c.get(k) or {}).get("texto") or TEXTOS[k]} for k in TEXTOS}}


def _hora() -> int:
    """Hora local em que as mensagens automáticas começam (8h; o ambiente de teste usa 0)."""
    return int(os.environ.get("WA_CADENCIA_HORA", "8"))


def _br(d: str) -> str:
    x = date.fromisoformat(d)
    return f"{DIAS_SEMANA[x.weekday()]}, {x.day:02d}/{x.month:02d}"


def _texto(modelo: str, pessoa_nome: str | None, empresa: str, extra: dict | None = None) -> str:
    t = modelo.replace("{nome}", camp.primeiro_nome(pessoa_nome) or "tudo bem").replace("{empresa}", empresa or "")
    for k, v in (extra or {}).items():
        t = t.replace("{" + k + "}", v or "")
    return t.strip()


async def _ja_feito(chave: str) -> bool:
    try:
        await db.wa_cadencia_feitos.insert_one({"_id": chave, "em": now_utc()})
        return False
    except Exception:
        return True


async def _criar(tipo: str, hoje: date, conexao: dict, destinos: list[dict], empresa: str) -> str | None:
    if not destinos:
        return None
    cid = new_id()
    for i, d in enumerate(destinos, start=1):
        await db.wa_campanha_envios.insert_one({"_id": f"{cid}|{i:05d}", "campanha_id": cid, "ordem": i, "status": "pendente", **d})
    doc = {"_id": cid, "id": cid, "nome": f"{NOMES[tipo]} {hoje.day:02d}/{hoje.month:02d}", "sistema": True, "tipo": tipo,
           "transacional": tipo == "lembrete", "conexao_id": conexao["id"], "conexao_nome": conexao.get("nome"), "mensagem": TEXTOS[tipo],
           "publico": {}, "intervalo_min": 15, "intervalo_max": 40, "teto_diario": 300, "hora_inicio": f"{_hora():02d}:00", "hora_fim": os.environ.get("WA_CADENCIA_FIM", "20:00"),
           "domingo": True, "status": "enviando", "total": len(destinos), "cursor": 0, "enviados": 0, "falhas": 0, "pulados": 0,
           "empresa_nome": empresa, "proximo_em": now_utc(), "criado_em": now_utc(), "criado_por": "Mensagens automáticas"}
    await db.wa_campanhas.insert_one(doc)
    await camp.marcar_ativa(doc)
    return cid


async def preparar_dia(agora: datetime | None = None) -> dict:
    """Uma vez por dia (a partir das 8h): monta as filas de lembrete, aniversário e retorno."""
    agora = agora or now_utc()
    local = agora.astimezone(camp.fuso())
    if local.hour < _hora():
        return {"pronto": False}
    cfg = await config()
    if not any(cfg[k]["ativo"] for k in TEXTOS):
        return {"pronto": False}
    hoje = local.date()
    try:
        await db.wa_cadencia_dias.insert_one({"_id": hoje.isoformat(), "em": agora})
    except Exception:
        return {"pronto": True, "ja": True}
    filtro = {"id": cfg["conexao_id"]} if cfg.get("conexao_id") else {"status": "conectado"}
    conexao = await db.wa_conexoes.find_one(filtro)
    if not conexao:
        return {"pronto": True, "sem_numero": True}
    empresa = ((await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1})) or {}).get("nome_software") or ""
    sairam = {d["_id"] async for d in db.wa_optout.find({}, {"_id": 1})}
    resumo: dict = {"pronto": True}

    if cfg["lembrete"]["ativo"]:
        amanha = (hoje + timedelta(days=1)).isoformat()
        destinos, vistos = [], set()
        async for a in db.agendamentos.find({"data": amanha, "status": "agendado"}):
            p = await db.pessoas.find_one({"id": a.get("cliente_id")}, {"nome": 1, "telefone": 1}) if a.get("cliente_id") else None
            tel = camp.normalizar_telefone((p or {}).get("telefone") or a.get("cliente_telefone"))
            if not tel or (a["id"] in vistos) or await _ja_feito(f"lem-{a['id']}"):
                continue
            vistos.add(a["id"])
            nome = (p or {}).get("nome") or a.get("cliente_nome")
            destinos.append({"pessoa_id": a.get("cliente_id"), "nome": nome, "telefone": tel, "agendamento_id": a["id"],
                             "texto": _texto(cfg["lembrete"]["texto"], nome, empresa, {"data": _br(amanha), "hora": a.get("inicio"),
                                                                                       "profissional": a.get("profissional_nome") or "a equipe"})})
        destinos.sort(key=lambda d: d["texto"])
        resumo["lembrete"] = len(destinos)
        await _criar("lembrete", hoje, conexao, destinos, empresa)

    if cfg["aniversario"]["ativo"]:
        destinos = []
        async for p in db.pessoas.find({"papeis": {"$in": ["cliente", "paciente"]}}, {"id": 1, "nome": 1, "telefone": 1, "data_nascimento": 1}):
            n = p.get("data_nascimento") or ""
            tel = camp.normalizar_telefone(p.get("telefone"))
            if len(n) < 10 or n[5:10] != hoje.isoformat()[5:10] or not tel or camp.chave(tel) in sairam:
                continue
            if await _ja_feito(f"niver-{p['id']}-{hoje.year}"):
                continue
            destinos.append({"pessoa_id": p["id"], "nome": p.get("nome"), "telefone": tel, "texto": _texto(cfg["aniversario"]["texto"], p.get("nome"), empresa)})
        resumo["aniversario"] = len(destinos)
        await _criar("aniversario", hoje, conexao, destinos, empresa)

    if cfg["retorno"]["ativo"]:
        from lib.agenda_online import config as cfg_agenda

        padrao = int((await cfg_agenda()).get("dias_retorno") or 30)
        servicos = {s["id"]: s for s in await db.servicos.find({}, {"id": 1, "retorno_dias": 1}).to_list(500)}
        ultimo: dict[str, dict] = {}
        futuros: set[str] = set()
        async for a in db.agendamentos.find({"status": {"$in": ["concluido", "agendado", "confirmado"]}},
                                            {"id": 1, "cliente_id": 1, "data": 1, "status": 1, "servico_ids": 1, "cliente_nome": 1, "cliente_telefone": 1}):
            if not a.get("cliente_id"):
                continue
            if a["status"] != "concluido":
                if a["data"] >= hoje.isoformat():
                    futuros.add(a["cliente_id"])
                continue
            if a["cliente_id"] not in ultimo or a["data"] > ultimo[a["cliente_id"]]["data"]:
                ultimo[a["cliente_id"]] = a
        destinos = []
        for cid, a in ultimo.items():
            if cid in futuros:
                continue
            prazos = [servicos[s]["retorno_dias"] for s in a.get("servico_ids") or [] if s in servicos and servicos[s].get("retorno_dias")]
            if (hoje - date.fromisoformat(a["data"])).days < (min(prazos) if prazos else padrao):
                continue
            p = await db.pessoas.find_one({"id": cid}, {"nome": 1, "telefone": 1})
            tel = camp.normalizar_telefone((p or {}).get("telefone") or a.get("cliente_telefone"))
            if not tel or camp.chave(tel) in sairam or await _ja_feito(f"ret-{a['id']}"):
                continue
            nome = (p or {}).get("nome") or a.get("cliente_nome")
            destinos.append({"pessoa_id": cid, "nome": nome, "telefone": tel, "texto": _texto(cfg["retorno"]["texto"], nome, empresa)})
        resumo["retorno"] = len(destinos)
        await _criar("retorno", hoje, conexao, destinos, empresa)
    return resumo


async def resposta_confirmacao(conv: dict, conexao: dict, texto: str) -> bool:
    """Resposta a um lembrete: 1 confirma, 2 cancela. True = tratada aqui (o robô de fluxo não roda)."""
    from lib.wa_fluxos import _enviar, normalizar

    pend = conv.get("confirmacao") or {}
    em = pend.get("em")
    if not pend.get("agendamento_id") or not isinstance(em, datetime):
        return False
    if (now_utc() - (em if em.tzinfo else em.replace(tzinfo=now_utc().tzinfo))).total_seconds() > 48 * 3600:
        return False
    t = normalizar(texto).strip(" .!")
    if t not in SIM and t not in NAO:
        return False
    a = await db.agendamentos.find_one({"id": pend["agendamento_id"]})
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"confirmacao": None}})
    if not a or a.get("status") not in ("agendado", "confirmado"):
        return False
    quando = f"{_br(a['data'])} às {a.get('inicio')}"
    if t in SIM:
        await db.agendamentos.update_one({"id": a["id"], "status": "agendado"}, {"$set": {"status": "confirmado", "confirmado_por": "WhatsApp",
                                                                                          "updated_at": now_utc()}})
        await _enviar(conv, conexao, f"Confirmado! Te esperamos {quando}.")
        return True
    from lib.agenda_online import destravar

    r = await db.agendamentos.update_one({"id": a["id"], "status": {"$in": ["agendado", "confirmado"]}},
                                         {"$set": {"status": "cancelado", "cancelado_por": "Cliente pelo WhatsApp", "updated_at": now_utc()}})
    if r.modified_count == 1:
        await destravar(a)
        from routers.espera import vaga_aberta

        await vaga_aberta({**a, "status": "cancelado"})
    await _enviar(conv, conexao, f"Pronto, cancelamos o horário de {quando}. Se quiser marcar outro dia, é só responder aqui.")
    return True
