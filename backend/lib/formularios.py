"""Formulários, pesquisas e NPS (todos os segmentos).

Coleções no banco da empresa:
- formularios: nome, perguntas (nps 0-10, nota 1-5, escolha, multipla, sim_nao, texto), link público `token`,
  envio automático depois do atendimento concluído e alerta de nota baixa.
- formulario_convites: link pessoal (um por pessoa e envio; `_id` fixo por atendimento, não duplica). Só aceita
  uma resposta.
- formulario_respostas: uma por envio do formulário.

O índice do link fica em `controle.links_publicos` (tipos `form` e `form_convite`, só o hash; ver lib/links.py).
Nota baixa (NPS até `alerta_nota_ate`, ou 1 e 2 na nota de 1 a 5) cria uma tarefa para `alerta_pessoa_id`.
"""

from __future__ import annotations

import logging
import os
from datetime import timedelta

from lib import links
from lib.db import db
from models.common import new_id, now_utc

logger = logging.getLogger(__name__)

TIPOS = ("nps", "nota", "escolha", "multipla", "sim_nao", "texto")
MENSAGEM_PADRAO = "Oi, {nome}! Obrigado pela visita. Você pode avaliar o atendimento? Leva 1 minuto: {link}"


def modelo(chave: str, empresa: str) -> dict:
    nome = empresa or "a empresa"
    if chave == "nps":
        return {"nome": "Pesquisa NPS", "descricao": "Sua opinião ajuda a gente a melhorar.", "perguntas": [
            {"id": "p1", "tipo": "nps", "titulo": f"De 0 a 10, quanto você indicaria {nome} para um amigo ou familiar?", "obrigatoria": True, "opcoes": []},
            {"id": "p2", "tipo": "texto", "titulo": "O que mais pesou na sua nota?", "obrigatoria": False, "opcoes": []}]}
    if chave == "satisfacao":
        return {"nome": "Satisfação com o atendimento", "descricao": "Conte como foi sua experiência.", "perguntas": [
            {"id": "p1", "tipo": "nota", "titulo": "Como você avalia o atendimento?", "obrigatoria": True, "opcoes": []},
            {"id": "p2", "tipo": "sim_nao", "titulo": "Você foi atendido no horário marcado?", "obrigatoria": True, "opcoes": []},
            {"id": "p3", "tipo": "escolha", "titulo": "Como conheceu a gente?", "obrigatoria": False,
             "opcoes": ["Indicação", "Instagram", "Google", "Passei na frente", "Outro"]},
            {"id": "p4", "tipo": "texto", "titulo": "Quer deixar uma sugestão?", "obrigatoria": False, "opcoes": []}]}
    return {"nome": "Novo formulário", "descricao": "", "perguntas": [
        {"id": "p1", "tipo": "texto", "titulo": "Sua pergunta", "obrigatoria": True, "opcoes": []}]}


def url_publica(token: str) -> str:
    return f"{(os.environ.get('APP_URL') or '').rstrip('/')}/f/{token}"


def nota_principal(form: dict, respostas: dict) -> tuple[str | None, int | None]:
    """(tipo, valor) da primeira pergunta de nota do formulário respondida."""
    for p in form.get("perguntas") or []:
        if p.get("tipo") in ("nps", "nota") and isinstance(respostas.get(p["id"]), int):
            return p["tipo"], respostas[p["id"]]
    return None, None


def baixa(form: dict, tipo: str | None, valor: int | None) -> bool:
    if valor is None:
        return False
    if tipo == "nps":
        return valor <= int(form.get("alerta_nota_ate") if form.get("alerta_nota_ate") is not None else 6)
    return tipo == "nota" and valor <= 2


def calcular_nps(notas: list[int]) -> dict:
    total = len(notas)
    prom = sum(1 for n in notas if n >= 9)
    det = sum(1 for n in notas if n <= 6)
    return {"total": total, "promotores": prom, "neutros": total - prom - det, "detratores": det,
            "nps": round((prom - det) * 100 / total) if total else None}


async def criar_convite(form: dict, pessoa: dict | None, origem: str, chave: str | None = None, extra: dict | None = None) -> tuple[dict, str] | None:
    """Link pessoal. Com `chave` fixa, não cria de novo (devolve None se já existe)."""
    cid = chave or new_id()
    doc = {"_id": cid, "id": cid, "formulario_id": form["id"], "pessoa_id": (pessoa or {}).get("id"), "nome": (pessoa or {}).get("nome"),
           "origem": origem, "usado": False, "criado_em": now_utc(), **(extra or {})}
    try:
        await db.formulario_convites.insert_one(doc)
    except Exception:
        return None
    token = await links.criar("form_convite", cid)
    return doc, token


async def apos_atendimento(a: dict) -> str:
    """Atendimento concluído: manda a pesquisa automática pelo WhatsApp (uma por atendimento)."""
    form = await db.formularios.find_one({"auto_apos_atendimento": True, "ativo": True})
    if not form:
        return "sem_formulario"
    pessoa = await db.pessoas.find_one({"id": a.get("cliente_id")}) if a.get("cliente_id") else None
    if not pessoa:
        return "sem_cliente"
    from lib import wa_campanhas as camp

    tel = camp.normalizar_telefone(pessoa.get("telefone") or a.get("cliente_telefone"))
    if not tel:
        return "sem_telefone"
    if await db.wa_optout.find_one({"_id": camp.chave(tel)}):
        return "saiu"
    dias = int(form.get("intervalo_dias") or 30)
    recente = await db.formulario_convites.find_one({"formulario_id": form["id"], "pessoa_id": pessoa["id"], "origem": "atendimento",
                                                     "criado_em": {"$gte": now_utc() - timedelta(days=dias)}})
    if recente:
        return "recente"
    filtro = {"id": form["conexao_id"]} if form.get("conexao_id") else {"status": "conectado"}
    conexao = await db.wa_conexoes.find_one(filtro)
    if not conexao or conexao.get("status") != "conectado":
        return "sem_numero"
    prof = await db.usuarios.find_one({"id": a.get("profissional_id")}, {"nome": 1}) if a.get("profissional_id") else None
    r = await criar_convite(form, pessoa, "atendimento", chave=f"ag-{a['id']}",
                            extra={"agendamento_id": a["id"], "profissional_id": a.get("profissional_id"), "profissional_nome": (prof or {}).get("nome")})
    if not r:
        return "ja_enviado"
    _, token = r
    texto = (form.get("mensagem_whatsapp") or MENSAGEM_PADRAO).replace("{nome}", camp.primeiro_nome(pessoa.get("nome")) or "tudo bem")
    texto = texto.replace("{link}", url_publica(token)).replace("{empresa}", form.get("empresa_nome") or "")
    if url_publica(token) not in texto:
        texto += f"\n{url_publica(token)}"
    conv = await camp._conversa_para(conexao, {"telefone": tel, "nome": pessoa.get("nome"), "pessoa_id": pessoa["id"]})
    from lib.wa_fluxos import _enviar

    try:
        await _enviar(conv, conexao, texto)
    except Exception:
        logger.exception("pesquisa pós-atendimento não saiu")
        return "falhou"
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"campanha_em": now_utc()}})
    return "enviado"


async def alertar(form: dict, resposta: dict, tipo: str | None, valor: int | None) -> None:
    from lib.dates import today_iso
    from models.crm import Atividade

    dono = form.get("alerta_pessoa_id")
    if not dono:
        return
    quem = resposta.get("nome") or "Cliente sem identificação"
    escala = "de 0 a 10" if tipo == "nps" else "de 1 a 5"
    comentario = next((v for v in (resposta.get("respostas") or {}).values() if isinstance(v, str) and len(v) > 3), None)
    ativ = Atividade(tipo="tarefa", assunto=f"Nota {valor} ({escala}) em \"{form.get('nome')}\": retornar para {quem}"[:300], data=today_iso(),
                     pessoa_id=resposta.get("pessoa_id"), corretor_id=dono, created_by="pesquisa",
                     notas=(f"Comentário: {comentario}" if comentario else None))
    await db.atividades.insert_one({**ativ.model_dump(), "resposta_id": resposta["id"]})
