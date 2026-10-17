"""Campanhas de WhatsApp (envio em massa com limite seguro).

A conexão é não oficial (QR). Para reduzir o risco de bloqueio do número:
- só vai para quem já é contato da empresa (cadastro com telefone) e, por padrão, só para quem já
  conversou com a empresa no WhatsApp;
- uma mensagem por vez, com intervalo aleatório entre `intervalo_min` e `intervalo_max` segundos;
- teto por dia por número (somando todas as campanhas daquele número) e janela de horário;
- toda mensagem leva "responda SAIR" e quem sai fica em `wa_optout` (nunca recebe outra campanha).

Coleções no banco da empresa:
- wa_campanhas: a campanha (público, mensagem, ritmo, status, `cursor` = próximo da fila, `total`).
- wa_campanha_envios: um por destinatário, `_id` = campanha|ordem (00001...). Ler o próximo é uma leitura.
- wa_envio_dia: contador por número e dia (`_id` = conexao|AAAA-MM-DD).
- wa_optout: telefones que pediram para sair (`_id` = chave do telefone, ver `chave`).

O Vercel não mantém processo rodando: a fila anda em "toques" (`processar`). Quem toca: a tela de
campanhas aberta (a cada 15 s), o cron diário e o disparador externo (`/api/publico/whatsapp/disparar/{token}`,
para um agendador de 1 em 1 minuto). Cada toque manda no máximo uma mensagem por campanha vencida, e a
vaga é tomada com `update_one` condicional (dois toques ao mesmo tempo não mandam a mesma mensagem).
`controle.wa_campanhas_ativas` lista as campanhas em envio de todas as empresas para o disparador não varrer
os bancos.
"""

from __future__ import annotations

import logging
import os
import random
import re
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from lib import whatsapp as wa
from lib.db import controle, db, definir_empresa, empresa_atual_db
from models.common import now_utc

logger = logging.getLogger(__name__)

RODAPE = "Para não receber mais estas mensagens, responda SAIR."
PALAVRAS_SAIR = {"sair", "parar", "pare", "stop", "descadastrar", "nao quero mais receber", "remover"}
ATIVAS = "wa_campanhas_ativas"
MAX_FALHAS_SEGUIDAS = 3


def fuso() -> ZoneInfo:
    return ZoneInfo(os.environ.get("APP_TZ", "America/Sao_Paulo"))


def normalizar_telefone(t: str | None) -> str | None:
    """Telefone brasileiro em dígitos com 55. None se não parece celular/fixo válido."""
    d = re.sub(r"\D", "", t or "").lstrip("0")
    if len(d) in (10, 11):
        d = "55" + d
    if len(d) in (12, 13) and d.startswith("55"):
        return d
    return None


def chave(t: str | None) -> str | None:
    """DDD + últimos 8 dígitos: casa o mesmo celular com e sem o nono dígito (o WhatsApp às vezes tira)."""
    d = normalizar_telefone(t)
    return (d[2:4] + d[-8:]) if d else None


def primeiro_nome(nome: str | None) -> str:
    n = (nome or "").strip().split()
    return n[0].capitalize() if n else ""


def montar_texto(modelo: str, pessoa: dict, empresa: str) -> str:
    texto = (modelo or "").replace("{nome}", primeiro_nome(pessoa.get("nome")) or "tudo bem")
    texto = texto.replace("{nome_completo}", (pessoa.get("nome") or "").strip()).replace("{empresa}", empresa or "")
    return f"{texto.strip()}\n\n{RODAPE}"


# ------------------------------------------------------------------ público


def _aniversario(nasc: str | None, quando: str, hoje: date) -> bool:
    if not nasc or len(nasc) < 10:
        return False
    try:
        m, d = int(nasc[5:7]), int(nasc[8:10])
    except ValueError:
        return False
    if quando == "mes":
        return m == hoje.month
    if quando == "hoje":
        return (m, d) == (hoje.month, hoje.day)
    for i in range(7):  # próximos 7 dias
        dia = hoje + timedelta(days=i)
        if (m, d) == (dia.month, dia.day):
            return True
    return False


def _dt(v) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and len(v) >= 10:
        try:
            return datetime.fromisoformat(v[:10]).replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


async def montar_publico(p: dict) -> dict:
    """Aplica os filtros e devolve {destinatarios, sem_telefone, sairam, sem_conversa}. Não grava nada."""
    hoje = datetime.now(fuso()).date()
    pessoas: dict[str, dict] = {}
    if p.get("origem") == "negocios":
        filtro: dict = {}
        if p.get("funil_id"):
            filtro["funil_id"] = p["funil_id"]
        if p.get("status"):
            filtro["status"] = p["status"]
        ids: set[str] = set()
        async for n in db.leads.find(filtro, {"cliente_id": 1, "etapa_id": 1, "temperatura": 1, "etiquetas": 1}):
            if p.get("etapa_ids") and n.get("etapa_id") not in p["etapa_ids"]:
                continue
            if p.get("temperaturas") and n.get("temperatura") not in p["temperaturas"]:
                continue
            if p.get("etiquetas") and not set(p["etiquetas"]) & set(n.get("etiquetas") or []):
                continue
            if n.get("cliente_id"):
                ids.add(n["cliente_id"])
        for i in range(0, len(ids), 30):
            async for x in db.pessoas.find({"id": {"$in": list(ids)[i:i + 30]}}):
                pessoas[x["id"]] = x
    else:
        async for x in db.pessoas.find({"papeis": {"$in": ["cliente", "paciente"]}}):
            pessoas[x["id"]] = x
    if p.get("aniversario"):
        pessoas = {k: v for k, v in pessoas.items() if _aniversario(v.get("data_nascimento"), p["aniversario"], hoje)}
    if p.get("sem_atendimento_dias"):
        limite = now_utc() - timedelta(days=int(p["sem_atendimento_dias"]))
        ultimo: dict[str, datetime] = {}

        def marcar(pid, quando):
            q = _dt(quando)
            if pid and q and (pid not in ultimo or q > ultimo[pid]):
                ultimo[pid] = q

        async for a in db.agendamentos.find({}, {"cliente_id": 1, "data": 1, "status": 1}):
            if a.get("status") not in ("cancelado", "faltou"):
                marcar(a.get("cliente_id"), a.get("data"))
        async for n in db.leads.find({}, {"cliente_id": 1, "updated_at": 1}):
            marcar(n.get("cliente_id"), n.get("updated_at"))
        for pid, x in pessoas.items():
            marcar(pid, x.get("created_at"))
        pessoas = {k: v for k, v in pessoas.items() if ultimo.get(k) and ultimo[k] < limite}
    sairam = {d["_id"] async for d in db.wa_optout.find({}, {"_id": 1})}
    conversaram: set[str] = set()
    if p.get("ja_conversou", True):
        async for c in db.wa_conversas.find({}, {"telefone": 1}):
            k = chave(c.get("telefone"))
            if k:
                conversaram.add(k)
    vistos: set[str] = set()
    destinos, sem_tel, saiu, sem_conversa = [], 0, 0, 0
    for x in sorted(pessoas.values(), key=lambda v: (v.get("nome") or "").lower()):
        tel = normalizar_telefone(x.get("telefone")) or normalizar_telefone(x.get("telefone2"))
        k = chave(tel)
        if not tel or not k:
            sem_tel += 1
            continue
        if k in vistos:
            continue
        vistos.add(k)
        if k in sairam:
            saiu += 1
            continue
        if p.get("ja_conversou", True) and k not in conversaram:
            sem_conversa += 1
            continue
        destinos.append({"pessoa_id": x["id"], "nome": x.get("nome") or "", "telefone": tel})
    return {"destinatarios": destinos, "sem_telefone": sem_tel, "sairam": saiu, "sem_conversa": sem_conversa}


# ------------------------------------------------------------------ fila


def _dia_local(agora: datetime) -> str:
    return agora.astimezone(fuso()).date().isoformat()


def na_janela(c: dict, agora: datetime) -> bool:
    local = agora.astimezone(fuso())
    if local.weekday() == 6 and not c.get("domingo"):
        return False
    hm = local.strftime("%H:%M")
    return (c.get("hora_inicio") or "09:00") <= hm < (c.get("hora_fim") or "19:00")


async def enviados_hoje(conexao_id: str, agora: datetime | None = None) -> int:
    d = await db.wa_envio_dia.find_one({"_id": f"{conexao_id}|{_dia_local(agora or now_utc())}"})
    return int((d or {}).get("qtd") or 0)


async def marcar_ativa(c: dict) -> None:
    nome = empresa_atual_db()
    if not nome:
        return
    _id = f"{nome}|{c['id']}"
    if c.get("status") == "enviando":
        await controle[ATIVAS].update_one({"_id": _id}, {"$set": {"db_name": nome, "campanha_id": c["id"], "proximo_em": c.get("proximo_em") or now_utc()}},
                                          upsert=True)
    else:
        await controle[ATIVAS].delete_one({"_id": _id})


async def _conversa_para(conexao: dict, destino: dict) -> dict:
    """Conversa existente com o contato neste número (casa com e sem o nono dígito) ou uma nova."""
    k = chave(destino["telefone"])
    async for conv in db.wa_conversas.find({"conexao_id": conexao["id"]}, {"telefone": 1, "jid": 1, "nome": 1, "responsavel_id": 1}):
        if chave(conv.get("telefone")) == k:
            return conv
    jid = f"{destino['telefone']}@s.whatsapp.net"
    _id = f"{conexao['instancia']}|{jid}"
    novo = {"_id": _id, "id": _id, "jid": jid, "telefone": destino["telefone"], "nome": destino.get("nome") or destino["telefone"],
            "conexao_id": conexao["id"], "responsavel_id": conexao.get("dono_pessoa_id"), "entrada_id": None, "nao_lidas": 0,
            "pessoa_id": destino.get("pessoa_id"), "criado_em": now_utc()}
    try:
        await db.wa_conversas.insert_one(novo)
    except Exception:  # webhook criou no mesmo instante
        return await db.wa_conversas.find_one({"_id": _id}) or novo
    return novo


async def _pausar(c: dict, motivo: str) -> None:
    await db.wa_campanhas.update_one({"id": c["id"], "status": "enviando"}, {"$set": {"status": "pausada", "motivo_pausa": motivo}})
    await marcar_ativa({**c, "status": "pausada"})


async def processar_campanha(c: dict, agora: datetime | None = None) -> str:
    """Manda a próxima mensagem se for a hora. Devolve o que aconteceu (para log e teste)."""
    agora = agora or now_utc()
    if c.get("status") != "enviando":
        return "parada"
    prox = _dt(c.get("proximo_em"))
    if prox and prox > agora:
        return "aguardando"
    if not na_janela(c, agora):
        return "fora_do_horario"
    conexao = await db.wa_conexoes.find_one({"id": c.get("conexao_id")})
    if not conexao:
        await _pausar(c, "O número da campanha foi removido. Escolha outro e retome.")
        return "sem_numero"
    if conexao.get("status") != "conectado":
        await _pausar(c, "O número da campanha está desconectado. Leia o QR code de novo e retome.")
        return "desconectado"
    if await enviados_hoje(conexao["id"], agora) >= int(c.get("teto_diario") or 60):
        return "teto_do_dia"
    cursor = int(c.get("cursor") or 0)
    if cursor >= int(c.get("total") or 0):
        await db.wa_campanhas.update_one({"id": c["id"], "status": "enviando"}, {"$set": {"status": "concluida", "concluida_em": agora}})
        await marcar_ativa({**c, "status": "concluida"})
        return "concluida"
    espera = random.randint(int(c.get("intervalo_min") or 40), max(int(c.get("intervalo_min") or 40), int(c.get("intervalo_max") or 90)))
    proximo = agora + timedelta(seconds=espera)
    # toma a vaga: só um toque avança o cursor
    r = await db.wa_campanhas.update_one({"id": c["id"], "status": "enviando", "cursor": cursor},
                                         {"$set": {"cursor": cursor + 1, "proximo_em": proximo, "ultimo_envio_em": agora}})
    if r.modified_count != 1:
        return "ocupada"
    await marcar_ativa({**c, "proximo_em": proximo})
    envio_id = f"{c['id']}|{cursor + 1:05d}"
    destino = await db.wa_campanha_envios.find_one({"_id": envio_id})
    if not destino:
        return "sem_destino"
    if await db.wa_optout.find_one({"_id": chave(destino["telefone"])}):
        await db.wa_campanha_envios.update_one({"_id": envio_id}, {"$set": {"status": "pulado", "erro": "Pediu para sair"}})
        await db.wa_campanhas.update_one({"id": c["id"]}, {"$inc": {"pulados": 1}, "$set": {"proximo_em": agora}})
        return "pulado"
    pessoa = await db.pessoas.find_one({"id": destino.get("pessoa_id")}) or destino
    texto = montar_texto(c.get("mensagem") or "", pessoa, c.get("empresa_nome") or "")
    if c.get("formulario_id"):  # pesquisa: link pessoal (uma resposta por pessoa)
        from lib import formularios

        form = await db.formularios.find_one({"id": c["formulario_id"]})
        r = await formularios.criar_convite(form, pessoa if pessoa.get("id") else None, "campanha", chave=f"cp-{envio_id.replace('|', '-')}",
                                            extra={"campanha_id": c["id"]}) if form else None
        if r:
            url = formularios.url_publica(r[1])
            texto = texto.replace("{link}", url) if "{link}" in texto else texto.replace(f"\n\n{RODAPE}", f"\n{url}\n\n{RODAPE}")
    conv = await _conversa_para(conexao, destino)
    try:
        msg_id = await wa.enviar_texto(conexao["instancia"], conv["jid"], texto)
    except wa.ErroWhatsApp as e:
        falhas = int(c.get("falhas_seguidas") or 0) + 1
        await db.wa_campanha_envios.update_one({"_id": envio_id}, {"$set": {"status": "falhou", "erro": e.mensagem[:300], "em": agora}})
        await db.wa_campanhas.update_one({"id": c["id"]}, {"$inc": {"falhas": 1}, "$set": {"falhas_seguidas": falhas}})
        if falhas >= MAX_FALHAS_SEGUIDAS:
            await _pausar(c, "Três envios seguidos falharam. Confira o número no WhatsApp e retome.")
        return "falhou"
    await db.wa_envio_dia.update_one({"_id": f"{conexao['id']}|{_dia_local(agora)}"}, {"$inc": {"qtd": 1}}, upsert=True)
    await db.wa_campanha_envios.update_one({"_id": envio_id}, {"$set": {"status": "enviado", "em": agora, "conversa_id": conv["_id"]}})
    await db.wa_campanhas.update_one({"id": c["id"]}, {"$inc": {"enviados": 1}, "$set": {"falhas_seguidas": 0}})
    doc = {"_id": f"{conexao['instancia']}|{msg_id or os.urandom(8).hex()}", "conversa_id": conv["_id"], "texto": texto[:4096], "tipo": "texto",
           "de_mim": True, "em": agora.replace(microsecond=0), "recebido_em": agora, "autor": f"Campanha: {c.get('nome')}"[:80], "status": "enviada"}
    try:
        await db.wa_mensagens.insert_one(doc)
    except Exception:  # o eco do webhook chegou antes
        await db.wa_mensagens.update_one({"_id": doc["_id"]}, {"$set": {"autor": doc["autor"]}})
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"ultima_msg": texto[:160], "ultima_de_mim": True, "ultima_em": agora,
                                                                     "campanha_em": agora}})
    await db.wa_estado.update_one({"id": "singleton"}, {"$inc": {"versao": 1}, "$set": {"id": "singleton"}}, upsert=True)
    return "enviado"


async def processar_empresa(ate: float | None = None) -> int:
    """Um toque em todas as campanhas em envio da empresa atual. Devolve quantas mensagens saíram."""
    n = 0
    for c in await db.wa_campanhas.find({"status": "enviando"}).to_list(20):
        if ate and time.monotonic() > ate:
            break
        try:
            if await processar_campanha(c) == "enviado":
                n += 1
        except Exception:
            logger.exception("campanha %s falhou no toque", c.get("id"))
    return n


async def processar_todas(segundos: float = 40) -> int:
    """Disparador e cron: passa só nas empresas com campanha vencida (índice no controle)."""
    ate = time.monotonic() + segundos
    agora = now_utc()
    total = 0
    vistos: set[str] = set()
    for item in await controle[ATIVAS].find({}).to_list(500):
        if time.monotonic() > ate:
            break
        prox = _dt(item.get("proximo_em"))
        if (prox and prox > agora) or item.get("db_name") in vistos:
            continue
        vistos.add(item["db_name"])
        definir_empresa(item["db_name"])
        try:
            total += await processar_empresa(ate)
        except Exception:
            logger.exception("disparador: falha em %s", item.get("db_name"))
        finally:
            definir_empresa(None)
    return total


async def pediu_para_sair(conv: dict, conexao: dict, texto: str) -> bool:
    """Resposta SAIR a uma campanha: grava o opt-out e confirma. True = a mensagem foi tratada aqui."""
    from lib.wa_fluxos import _enviar, normalizar

    if normalizar(texto).strip(" .!") not in PALAVRAS_SAIR or not conv.get("campanha_em"):
        return False
    k = chave(conv.get("telefone"))
    if not k:
        return False
    await db.wa_optout.update_one({"_id": k}, {"$set": {"telefone": conv.get("telefone"), "nome": conv.get("nome"), "em": now_utc(),
                                                       "conversa_id": conv["_id"]}}, upsert=True)
    await _enviar(conv, conexao, "Pronto, você não vai mais receber nossas mensagens automáticas. Se precisar, é só chamar aqui.")
    return True
