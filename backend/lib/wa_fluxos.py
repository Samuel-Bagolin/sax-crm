"""Fluxos de resposta automática do WhatsApp (robô simples de atendimento).

Um fluxo é uma lista de passos. O primeiro passo é o início. Tipos de passo:
- mensagem: manda o texto e segue para `proximo` (sem esperar resposta).
- menu: manda o texto com as opções numeradas e espera a resposta do cliente; cada opção leva a um passo.
- transferir: manda o texto (se houver) e passa a conversa para uma pessoa, um setor ou a fila da equipe.
- encerrar: manda o texto (se houver) e termina.
- link: manda o texto com um link (agenda da empresa ou de quem atende, agenda de quem o cliente citou,
  catálogo do site, um item ou endereço livre; `lib/wa_links.py`) e segue para `proximo`.

Gatilhos: `nova_conversa` (primeira mensagem de um contato), `palavra_chave` (a mensagem contém uma das
palavras) e `profissional` (a mensagem cita o nome de quem atende). Gatilho específico (palavra ou nome) vale
antes do de conversa nova: quem já chega pedindo "quero marcar com o João" recebe a agenda do João. A conversa guarda `fluxo` = {id, passo, em} enquanto espera a resposta de um menu. Quando alguém da
equipe responde, o fluxo para (`parar`). Mensagem do robô é gravada como `de_mim` com autor "Atendimento
automático" e o eco dela no webhook não dispara nada (é `fromMe`).
"""

from __future__ import annotations

import logging
import unicodedata
from datetime import datetime, timezone

from lib import whatsapp as wa
from lib.db import db
from models.common import new_id, now_utc

logger = logging.getLogger(__name__)

AUTOR = "Atendimento automático"
VALIDADE_S = 24 * 3600  # menu sem resposta por um dia: o fluxo expira
MAX_PASSOS = 15  # proteção contra fluxo em círculo


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", (t or "").lower())
    return " ".join("".join(c for c in t if unicodedata.category(c) != "Mn").split())


def _passo(fluxo: dict, passo_id: str | None) -> dict | None:
    return next((p for p in fluxo.get("passos") or [] if p.get("id") == passo_id), None)


def texto_menu(passo: dict) -> str:
    linhas = [(passo.get("texto") or "").strip()]
    opcoes = passo.get("opcoes") or []
    if opcoes:
        linhas.append("")
        linhas += [f"{i}. {o.get('rotulo')}" for i, o in enumerate(opcoes, 1)]
    return "\n".join(linhas).strip()


def escolher(passo: dict, resposta: str) -> dict | None:
    """Número da opção ("2", "2.", "opção 2") ou o próprio texto da opção."""
    opcoes = passo.get("opcoes") or []
    r = normalizar(resposta)
    digitos = "".join(c for c in r if c.isdigit())
    if digitos and len(digitos) <= 2 and 1 <= int(digitos) <= len(opcoes) and len(r) <= 12:
        return opcoes[int(digitos) - 1]
    for o in opcoes:
        if normalizar(o.get("rotulo") or "") == r:
            return o
    for o in opcoes:
        rot = normalizar(o.get("rotulo") or "")
        if rot and len(rot) >= 3 and rot in r:
            return o
    return None


async def _enviar(conv: dict, conexao: dict, texto: str) -> None:
    texto = (texto or "").strip()
    if not texto:
        return
    try:
        msg_id = await wa.enviar_texto(conexao["instancia"], conv["jid"], texto)
    except wa.ErroWhatsApp as e:
        logger.warning("fluxo: envio falhou: %s", e.mensagem)
        return
    agora = now_utc()
    doc = {"_id": f"{conexao['instancia']}|{msg_id or new_id()}", "conversa_id": conv["_id"], "texto": texto[:4096], "tipo": "texto",
           "de_mim": True, "em": agora.replace(microsecond=0), "recebido_em": agora, "autor": AUTOR, "status": "enviada"}
    try:
        await db.wa_mensagens.insert_one(doc)
    except Exception:  # o eco do webhook chegou antes: só marca o autor
        await db.wa_mensagens.update_one({"_id": doc["_id"]}, {"$set": {"autor": AUTOR}})
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"ultima_msg": texto[:160], "ultima_de_mim": True, "ultima_em": agora}})


async def _transferir(conv: dict, passo: dict) -> None:
    destino, alvo = passo.get("destino_tipo") or "fila", passo.get("destino_id")
    mudar: dict = {"setor_id": None}
    if destino == "pessoa" and alvo:
        mudar["responsavel_id"] = alvo
    elif destino == "setor" and alvo:
        mudar.update(responsavel_id=None, setor_id=alvo)
    else:
        mudar["responsavel_id"] = None
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": mudar})
    if conv.get("entrada_id") and mudar.get("responsavel_id"):
        await db.entradas.update_one({"id": conv["entrada_id"], "status": {"$in": ["novo", "em_contato"]}},
                                     {"$set": {"corretor_id": mudar["responsavel_id"], "na_fila": False, "atribuido_em": now_utc()}})


async def executar(conv: dict, conexao: dict, fluxo: dict, passo_id: str | None, texto_cliente: str = "") -> None:
    for _ in range(MAX_PASSOS):
        passo = _passo(fluxo, passo_id)
        if not passo:
            break
        tipo = passo.get("tipo")
        if tipo == "link":
            from lib import wa_links

            url, valores = await wa_links.montar(passo, texto_cliente)
            if not url:
                logger.warning("fluxo %s: link do passo %s indisponível agora", fluxo.get("id"), passo.get("id"))
            await _enviar(conv, conexao, wa_links.texto_com_link(passo.get("texto") or "", url, valores))
            passo_id = passo.get("proximo")
            continue
        if tipo == "menu":
            await _enviar(conv, conexao, texto_menu(passo))
            await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"fluxo": {"id": fluxo["id"], "passo": passo["id"], "em": now_utc(), "erros": 0,
                                                                          "texto": (texto_cliente or "")[-500:]}}})
            return
        await _enviar(conv, conexao, passo.get("texto") or "")
        if tipo == "transferir":
            await _transferir(conv, passo)
            break
        if tipo == "encerrar":
            break
        passo_id = passo.get("proximo")
    await parar(conv["_id"])


async def parar(conversa_id: str) -> None:
    await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"fluxo": None}})


def _vale_para(fluxo: dict, conexao_id: str) -> bool:
    return bool(fluxo.get("ativo")) and (not fluxo.get("conexoes") or conexao_id in fluxo["conexoes"])


async def fluxo_de_entrada(conexao_id: str) -> dict | None:
    """O fluxo que atende conversa nova neste número (o gestor marca um só por número)."""
    for f in await db.wa_fluxos.find({"gatilho": "nova_conversa"}).to_list(50):
        if _vale_para(f, conexao_id):
            return f
    return None


async def ao_receber(conv: dict, conexao: dict, texto: str, nova: bool) -> None:
    """Chamado a cada mensagem do cliente (nunca nas da empresa)."""
    estado = conv.get("fluxo") or None
    if estado:
        em = estado.get("em")
        if isinstance(em, datetime) and (now_utc() - (em if em.tzinfo else em.replace(tzinfo=timezone.utc))).total_seconds() > VALIDADE_S:
            await parar(conv["_id"])
            estado = None
    if estado:
        fluxo = await db.wa_fluxos.find_one({"id": estado.get("id")})
        passo = _passo(fluxo or {}, estado.get("passo"))
        if not fluxo or not passo or not fluxo.get("ativo"):
            await parar(conv["_id"])
            return
        opcao = escolher(passo, texto)
        if opcao:
            # o que o cliente já disse no fluxo vale para achar o profissional citado (ex.: "quero com o Diego" e depois "1")
            await executar(conv, conexao, fluxo, opcao.get("proximo"), f"{estado.get('texto') or ''} {texto}".strip())
            return
        erros = int(estado.get("erros") or 0) + 1
        if erros >= 3:  # três respostas fora do menu: passa para a equipe
            await _enviar(conv, conexao, "Vou chamar alguém da equipe para te atender.")
            await _transferir(conv, {"destino_tipo": "fila"})
            await parar(conv["_id"])
            return
        await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"fluxo.erros": erros}})
        await _enviar(conv, conexao, "Não entendi. Responda com o número da opção.\n\n" + texto_menu({"opcoes": passo.get("opcoes")}))
        return
    # Sem fluxo em andamento: palavra-chave ou nome de quem atende; senão, conversa nova.
    fluxo = None
    t = normalizar(texto)
    especificos = [f for f in await db.wa_fluxos.find({"gatilho": {"$in": ["palavra_chave", "profissional"]}}).to_list(50)
                   if _vale_para(f, conexao["id"])]
    for f in sorted(especificos, key=lambda f: f.get("gatilho") != "palavra_chave"):
        if f.get("gatilho") == "palavra_chave":
            if any(p and normalizar(p) in t for p in f.get("palavras") or []):
                fluxo = f
                break
        else:
            from lib import wa_links

            if wa_links.citado(texto, await wa_links.profissionais()):
                fluxo = f
                break
    if not fluxo and nova:
        fluxo = await fluxo_de_entrada(conexao["id"])
    if fluxo and fluxo.get("passos"):
        await executar(conv, conexao, fluxo, fluxo["passos"][0].get("id"), texto)
