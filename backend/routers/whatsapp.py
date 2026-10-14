"""WhatsApp dentro do CRM: números conectados por QR code, caixa de conversas e resposta pela equipe.

Coleções no banco da empresa:
- wa_conexoes: números (instâncias da Evolution API) com status.
- wa_conversas: uma por contato e número (`_id` = instância|jid). Responsável = pessoa_id da equipe.
- wa_mensagens: uma por mensagem (`_id` = instância|id da mensagem, não duplica em reenvio do webhook).
- wa_estado: contador `versao` que sobe a cada mudança. A tela consulta só ele (1 leitura) e recarrega a
  lista quando muda, em vez de varrer as conversas a cada poucos segundos.

- wa_setores: departamentos criados pelo gestor (Comercial, Financeiro...), com os membros da equipe.

Quem vê o quê: gestor vê tudo. Cada número pode ter setor e responsáveis. Número com setor ou responsáveis
é restrito: só os responsáveis e os membros do setor veem as conversas dele. Número aberto (sem os dois):
cada um vê as conversas dele e as sem responsável. Em qualquer número, a conversa passada para a pessoa
aparece para ela. Ao responder uma sem responsável, ela passa a ser de quem respondeu (quem pega primeiro
fica, com update condicional).
"""

import hmac
from typing import Literal
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from lib import whatsapp as wa
from lib.auth import Principal, require
from lib.db import controle, db, definir_empresa, empresa_atual_db
from lib.planos import exigir_recurso, recurso_liberado
from models.common import new_id, now_utc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])
admin_router = APIRouter(prefix="/plataforma/whatsapp", tags=["plataforma"])

LIMITE_NUMEROS = 5
COM_LEADS = ("imobiliaria", "veiculos", "odontologia", "estetica", "comercio")
STATUS = {"open": "conectado", "connecting": "conectando", "close": "desconectado", "refused": "desconectado"}


# ------------------------------------------------------------------ utilidades


async def _atender(principal: Principal = Depends(require("whatsapp:atender"))) -> Principal:
    if not principal.empresa_id:
        raise HTTPException(403, "Entre em uma empresa")
    await exigir_recurso("whatsapp")
    return principal


async def _gerir(principal: Principal = Depends(require("whatsapp:gerir"))) -> Principal:
    if not principal.empresa_id:
        raise HTTPException(403, "Entre em uma empresa")
    await exigir_recurso("whatsapp")
    return principal


async def _mudou() -> None:
    await db.wa_estado.update_one({"id": "singleton"}, {"$inc": {"versao": 1}, "$set": {"id": "singleton"}}, upsert=True)


def _iso(v) -> str | None:
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return v


async def _setores_dict() -> dict[str, dict]:
    return {s["id"]: s for s in await db.wa_setores.find({}).to_list(100)}


def _equipe_do_numero(conexao: dict, setores: dict[str, dict]) -> set[str]:
    """Quem atende o número: responsáveis + membros do setor. Vazio = número aberto para a equipe toda."""
    pessoas = set(conexao.get("responsaveis") or [])
    setor = setores.get(conexao.get("setor_id") or "")
    if setor:
        pessoas |= set(setor.get("membros") or [])
    return pessoas


def _restrito(conexao: dict | None) -> bool:
    return bool(conexao and (conexao.get("responsaveis") or conexao.get("setor_id")))


async def _acesso(principal: Principal) -> tuple[list[dict], set[str], set[str]]:
    """(conexões, números que a pessoa atende inteiros, números abertos)."""
    conexoes = await db.wa_conexoes.find({}).to_list(LIMITE_NUMEROS + 5)
    setores = await _setores_dict()
    meus, abertos = set(), set()
    for c in conexoes:
        if not _restrito(c):
            abertos.add(c["id"])
        elif principal.pessoa_id and principal.pessoa_id in _equipe_do_numero(c, setores):
            meus.add(c["id"])
    # Setores da pessoa ("setor:<id>"): conversa que o fluxo passou para um setor aparece para os membros.
    meus |= {f"setor:{sid}" for sid, st in setores.items() if principal.pessoa_id and principal.pessoa_id in (st.get("membros") or [])}
    return conexoes, meus, abertos


def _pode_ver(conv: dict, principal: Principal, meus: set[str], abertos: set[str]) -> bool:
    if principal.is_admin or (principal.pessoa_id and conv.get("responsavel_id") == principal.pessoa_id):
        return True
    if conv.get("setor_id") and f"setor:{conv['setor_id']}" in meus and conv.get("responsavel_id") is None:
        return True
    cid = conv.get("conexao_id")
    return cid in meus or (cid in abertos and conv.get("responsavel_id") is None)


async def _conversa(conversa_id: str, principal: Principal) -> dict:
    conv = await db.wa_conversas.find_one({"_id": conversa_id})
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    if not principal.is_admin:
        _, meus, abertos = await _acesso(principal)
        if not _pode_ver(conv, principal, meus, abertos):
            raise HTTPException(404, "Conversa não encontrada")
    return conv


def _saida_conversa(c: dict) -> dict:
    return {"id": c["_id"], "nome": c.get("nome") or c.get("telefone") or "Contato", "telefone": c.get("telefone"),
            "conexao_id": c.get("conexao_id"), "responsavel_id": c.get("responsavel_id"), "entrada_id": c.get("entrada_id"),
            "ultima_msg": c.get("ultima_msg"), "ultima_de_mim": bool(c.get("ultima_de_mim")), "ultima_em": _iso(c.get("ultima_em")),
            "nao_lidas": int(c.get("nao_lidas") or 0), "setor_id": c.get("setor_id"), "robo": bool(c.get("fluxo"))}


def _saida_conexao(c: dict) -> dict:
    return {"id": c["id"], "nome": c.get("nome"), "status": c.get("status") or "aguardando_qr", "numero": c.get("numero"),
            "perfil": c.get("perfil"), "criado_em": _iso(c.get("criado_em")), "setor_id": c.get("setor_id"),
            "responsaveis": list(c.get("responsaveis") or [])}


def _saida_setor(s: dict) -> dict:
    return {"id": s["id"], "nome": s.get("nome"), "membros": list(s.get("membros") or [])}


# ------------------------------------------------------------------ situação e números


@router.get("/situacao")
async def situacao(principal: Principal = Depends(require("whatsapp:atender"))):
    """O que a tela precisa para decidir o que mostrar (sem exigir o recurso, para explicar quando falta)."""
    cfg = await wa.config()
    estado = await db.wa_estado.find_one({"id": "singleton"}) or {}
    conexoes, setores = [], []
    if principal.empresa_id:
        conexoes, meus, abertos = await _acesso(principal)
        if not principal.is_admin:  # cada um vê os números que atende e os abertos
            conexoes = [c for c in conexoes if c["id"] in meus or c["id"] in abertos]
        setores = [_saida_setor(x) for x in (await _setores_dict()).values()]
        setores.sort(key=lambda x: (x["nome"] or "").lower())
    return {"servidor_ok": wa.configurado(cfg), "liberado": await recurso_liberado("whatsapp"), "pode_gerir": principal.is_admin,
            "versao": int(estado.get("versao") or 0), "conexoes": [_saida_conexao(c) for c in conexoes], "setores": setores}


@router.get("/versao")
async def versao(principal: Principal = Depends(require("whatsapp:atender"))):
    # Chamada a cada poucos segundos: só o contador, sem conferir o plano (as outras rotas conferem).
    if not principal.empresa_id:
        raise HTTPException(403, "Entre em uma empresa")
    estado = await db.wa_estado.find_one({"id": "singleton"}) or {}
    return {"versao": int(estado.get("versao") or 0)}


class ConexaoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=40)


@router.post("/conexoes", status_code=201)
async def criar_conexao(input: ConexaoIn, request: Request, principal: Principal = Depends(_gerir)):
    import os

    if await db.wa_conexoes.count_documents({}) >= LIMITE_NUMEROS:
        raise HTTPException(409, f"Esta conta já tem {LIMITE_NUMEROS} números. Desconecte um para ligar outro.")
    empresa = await controle.empresas.find_one({"id": principal.empresa_id}, {"slug": 1}) or {}
    instancia = wa.nome_instancia(empresa.get("slug") or "empresa")
    import secrets

    token = secrets.token_urlsafe(24)
    base = (os.environ.get("APP_URL") or str(request.base_url)).rstrip("/")
    try:
        r = await wa.criar_instancia(instancia, f"{base}/api/webhooks/whatsapp/{token}", token)
    except wa.ErroWhatsApp as e:
        raise wa.http(e)
    await wa.indexar(instancia, empresa_atual_db(), token)
    doc = {"id": new_id(), "nome": input.nome.strip(), "instancia": instancia, "status": "aguardando_qr", "numero": None,
           "criado_em": now_utc(), "criado_por": principal.nome}
    await db.wa_conexoes.insert_one(doc)
    await _mudou()
    qr = ((r.get("qrcode") or {}).get("base64")) if isinstance(r.get("qrcode"), dict) else None
    return {**_saida_conexao(doc), "qr": qr}


async def _conexao(conexao_id: str) -> dict:
    c = await db.wa_conexoes.find_one({"id": conexao_id})
    if not c:
        raise HTTPException(404, "Número não encontrado")
    return c


@router.get("/conexoes/{conexao_id}/qr")
async def qr_conexao(conexao_id: str, principal: Principal = Depends(_gerir)):
    """QR code para ler no celular. A tela chama de novo a cada poucos segundos até conectar."""
    c = await _conexao(conexao_id)
    try:
        r = await wa.qr(c["instancia"])
    except wa.ErroWhatsApp as e:
        raise wa.http(e)
    if r["conectado"] and c.get("status") != "conectado":
        await db.wa_conexoes.update_one({"id": conexao_id}, {"$set": {"status": "conectado"}})
        await _mudou()
    return {"conectado": r["conectado"], "qr": r["qr"], "codigo": r["codigo"], "status": "conectado" if r["conectado"] else "aguardando_qr"}


@router.delete("/conexoes/{conexao_id}", status_code=204)
async def remover_conexao(conexao_id: str, principal: Principal = Depends(_gerir)):
    c = await _conexao(conexao_id)
    await wa.remover_instancia(c["instancia"])
    await wa.desindexar(c["instancia"])
    await db.wa_conexoes.delete_one({"id": conexao_id})
    await _mudou()


async def _validar_equipe(pessoas: list[str]) -> list[str]:
    """Só aceita pessoas da equipe desta empresa (nunca um id solto vindo da tela)."""
    pessoas = list(dict.fromkeys(p for p in pessoas if p))
    if not pessoas:
        return []
    validas = {u["pessoa_id"] for u in await db.usuarios.find({"pessoa_id": {"$in": pessoas}}).to_list(200) if u.get("ativo", True)}
    faltam = [p for p in pessoas if p not in validas]
    if faltam:
        raise HTTPException(422, "Escolha pessoas ativas da equipe.")
    return pessoas


class ConexaoEdit(BaseModel):
    nome: str = Field(min_length=2, max_length=40)
    setor_id: str | None = None
    responsaveis: list[str] = Field(default_factory=list, max_length=50)


@router.put("/conexoes/{conexao_id}")
async def editar_conexao(conexao_id: str, input: ConexaoEdit, principal: Principal = Depends(_gerir)):
    await _conexao(conexao_id)
    if input.setor_id and not await db.wa_setores.find_one({"id": input.setor_id}):
        raise HTTPException(422, "Setor não encontrado")
    mudar = {"nome": input.nome.strip(), "setor_id": input.setor_id or None, "responsaveis": await _validar_equipe(input.responsaveis)}
    await db.wa_conexoes.update_one({"id": conexao_id}, {"$set": mudar})
    await _mudou()
    return _saida_conexao(await _conexao(conexao_id))


class SetorIn(BaseModel):
    nome: str = Field(min_length=2, max_length=40)
    membros: list[str] = Field(default_factory=list, max_length=100)


@router.get("/setores")
async def listar_setores(principal: Principal = Depends(_atender)):
    setores = [_saida_setor(x) for x in (await _setores_dict()).values()]
    return sorted(setores, key=lambda x: (x["nome"] or "").lower())


async def _nome_livre(nome: str, ignorar: str | None = None) -> str:
    nome = " ".join(nome.split())
    for x in (await _setores_dict()).values():
        if x["id"] != ignorar and (x.get("nome") or "").lower() == nome.lower():
            raise HTTPException(409, "Já existe um setor com esse nome.")
    return nome


@router.post("/setores", status_code=201)
async def criar_setor(input: SetorIn, principal: Principal = Depends(_gerir)):
    if await db.wa_setores.count_documents({}) >= 30:
        raise HTTPException(409, "Limite de 30 setores.")
    doc = {"id": new_id(), "nome": await _nome_livre(input.nome), "membros": await _validar_equipe(input.membros), "criado_em": now_utc()}
    await db.wa_setores.insert_one(doc)
    await _mudou()
    return _saida_setor(doc)


@router.put("/setores/{setor_id}")
async def editar_setor(setor_id: str, input: SetorIn, principal: Principal = Depends(_gerir)):
    if not await db.wa_setores.find_one({"id": setor_id}):
        raise HTTPException(404, "Setor não encontrado")
    mudar = {"nome": await _nome_livre(input.nome, setor_id), "membros": await _validar_equipe(input.membros)}
    await db.wa_setores.update_one({"id": setor_id}, {"$set": mudar})
    await _mudou()
    return _saida_setor({"id": setor_id, **mudar})


@router.delete("/setores/{setor_id}", status_code=204)
async def remover_setor(setor_id: str, principal: Principal = Depends(_gerir)):
    if not await db.wa_setores.find_one({"id": setor_id}):
        raise HTTPException(404, "Setor não encontrado")
    # Os números do setor ficam só com os responsáveis (ou abertos, se não tiverem).
    for c in await db.wa_conexoes.find({"setor_id": setor_id}).to_list(LIMITE_NUMEROS + 5):
        await db.wa_conexoes.update_one({"id": c["id"]}, {"$set": {"setor_id": None}})
    await db.wa_setores.delete_one({"id": setor_id})
    await _mudou()


# ------------------------------------------------------------------ fluxos de resposta automática


class OpcaoIn(BaseModel):
    rotulo: str = Field(min_length=1, max_length=60)
    proximo: str | None = Field(default=None, max_length=40)


class PassoIn(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    tipo: Literal["mensagem", "menu", "transferir", "encerrar"]
    texto: str = Field(default="", max_length=1500)
    opcoes: list[OpcaoIn] = Field(default_factory=list, max_length=10)
    proximo: str | None = Field(default=None, max_length=40)
    destino_tipo: Literal["pessoa", "setor", "fila"] | None = None
    destino_id: str | None = Field(default=None, max_length=64)


class FluxoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=60)
    ativo: bool = True
    gatilho: Literal["nova_conversa", "palavra_chave"] = "nova_conversa"
    palavras: list[str] = Field(default_factory=list, max_length=20)
    conexoes: list[str] = Field(default_factory=list, max_length=LIMITE_NUMEROS + 5)
    passos: list[PassoIn] = Field(min_length=1, max_length=40)


async def _validar_fluxo(f: FluxoIn, ignorar: str | None = None) -> dict:
    ids = [p.id for p in f.passos]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Há dois passos com o mesmo código.")
    existe = set(ids)
    setores = await _setores_dict()
    for i, p in enumerate(f.passos, 1):
        if p.tipo == "menu":
            if len(p.opcoes) < 2:
                raise HTTPException(422, f"O passo {i} é um menu: coloque pelo menos 2 opções.")
            if any(o.proximo and o.proximo not in existe for o in p.opcoes):
                raise HTTPException(422, f"Uma opção do passo {i} aponta para um passo que não existe.")
        if p.tipo in ("mensagem", "menu") and not p.texto.strip():
            raise HTTPException(422, f"Escreva a mensagem do passo {i}.")
        if p.proximo and p.proximo not in existe:
            raise HTTPException(422, f"O passo {i} segue para um passo que não existe.")
        if p.tipo == "transferir":
            if p.destino_tipo == "pessoa":
                await _validar_equipe([p.destino_id or ""])
            elif p.destino_tipo == "setor" and p.destino_id not in setores:
                raise HTTPException(422, f"Escolha o setor do passo {i}.")
    palavras = [w.strip()[:40] for w in f.palavras if w.strip()]
    if f.gatilho == "palavra_chave" and not palavras:
        raise HTTPException(422, "Informe ao menos uma palavra-chave.")
    conexoes_validas = {c["id"] for c in await db.wa_conexoes.find({}).to_list(LIMITE_NUMEROS + 5)}
    if any(c not in conexoes_validas for c in f.conexoes):
        raise HTTPException(422, "Número não encontrado.")
    if f.ativo and f.gatilho == "nova_conversa":
        # Um número tem um fluxo de boas-vindas só (senão o cliente receberia dois).
        for o in await db.wa_fluxos.find({"gatilho": "nova_conversa"}).to_list(50):
            if o["id"] == ignorar or not o.get("ativo"):
                continue
            mesmos = not o.get("conexoes") or not f.conexoes or set(o["conexoes"]) & set(f.conexoes)
            if mesmos:
                raise HTTPException(409, f"O fluxo \"{o.get('nome')}\" já responde as conversas novas destes números. Desative um deles.")
    dados = f.model_dump()
    dados["palavras"] = palavras
    return dados


def _saida_fluxo(d: dict) -> dict:
    return {k: d.get(k) for k in ("id", "nome", "ativo", "gatilho", "palavras", "conexoes", "passos")} | {"atualizado_em": _iso(d.get("atualizado_em"))}


@router.get("/fluxos")
async def listar_fluxos(principal: Principal = Depends(_gerir)):
    docs = await db.wa_fluxos.find({}).to_list(50)
    return sorted((_saida_fluxo(d) for d in docs), key=lambda x: (x["nome"] or "").lower())


@router.post("/fluxos", status_code=201)
async def criar_fluxo(input: FluxoIn, principal: Principal = Depends(_gerir)):
    if await db.wa_fluxos.count_documents({}) >= 20:
        raise HTTPException(409, "Limite de 20 fluxos.")
    doc = {"id": new_id(), **await _validar_fluxo(input), "atualizado_em": now_utc(), "criado_por": principal.nome}
    await db.wa_fluxos.insert_one(doc)
    return _saida_fluxo(doc)


@router.put("/fluxos/{fluxo_id}")
async def editar_fluxo(fluxo_id: str, input: FluxoIn, principal: Principal = Depends(_gerir)):
    if not await db.wa_fluxos.find_one({"id": fluxo_id}):
        raise HTTPException(404, "Fluxo não encontrado")
    dados = {**await _validar_fluxo(input, fluxo_id), "atualizado_em": now_utc()}
    await db.wa_fluxos.update_one({"id": fluxo_id}, {"$set": dados})
    return _saida_fluxo({"id": fluxo_id, **dados})


@router.delete("/fluxos/{fluxo_id}", status_code=204)
async def remover_fluxo(fluxo_id: str, principal: Principal = Depends(_gerir)):
    if not await db.wa_fluxos.find_one({"id": fluxo_id}):
        raise HTTPException(404, "Fluxo não encontrado")
    await db.wa_fluxos.delete_one({"id": fluxo_id})
    # Conversas paradas num menu deste fluxo seguem sem robô.
    for c in [c for c in await db.wa_conversas.find({}).to_list(3000) if (c.get("fluxo") or {}).get("id") == fluxo_id]:
        await db.wa_conversas.update_one({"_id": c["_id"]}, {"$set": {"fluxo": None}})


# ------------------------------------------------------------------ conversas


@router.get("/conversas")
async def conversas(filtro: str = Query("todas", pattern="^(todas|minhas|sem_responsavel|nao_lidas)$"),
                    conexao_id: str | None = Query(None, max_length=64), setor_id: str | None = Query(None, max_length=64),
                    principal: Principal = Depends(_atender)):
    conexoes, meus, abertos = await _acesso(principal)
    if principal.is_admin:
        docs = await db.wa_conversas.find({}).sort("ultima_em", -1).to_list(500)
    else:
        # Só o que a pessoa pode ver: números que ela atende inteiros, as dela e as sem responsável dos abertos.
        docs = []
        if meus:
            docs += await db.wa_conversas.find({"conexao_id": {"$in": sorted(meus)}}).to_list(500)
        if principal.pessoa_id:
            docs += await db.wa_conversas.find({"responsavel_id": principal.pessoa_id}).to_list(500)
        if abertos:
            docs += [d for d in await db.wa_conversas.find({"conexao_id": {"$in": sorted(abertos)}}).to_list(500) if d.get("responsavel_id") is None]
        setores_meus = sorted(m.split(":", 1)[1] for m in meus if m.startswith("setor:"))
        if setores_meus:
            docs += await db.wa_conversas.find({"setor_id": {"$in": setores_meus}}).to_list(500)
        unicos = {d["_id"]: d for d in docs}
        docs = [d for d in unicos.values() if _pode_ver(d, principal, meus, abertos)]
    if filtro == "minhas":
        docs = [d for d in docs if principal.pessoa_id and d.get("responsavel_id") == principal.pessoa_id]
    elif filtro == "sem_responsavel":
        docs = [d for d in docs if d.get("responsavel_id") is None]
    elif filtro == "nao_lidas":
        docs = [d for d in docs if d.get("nao_lidas")]
    if conexao_id:
        docs = [d for d in docs if d.get("conexao_id") == conexao_id]
    if setor_id:
        do_setor = {c["id"] for c in conexoes if c.get("setor_id") == setor_id}
        docs = [d for d in docs if d.get("conexao_id") in do_setor]
    docs.sort(key=lambda d: _iso(d.get("ultima_em")) or "", reverse=True)
    return [_saida_conversa(d) for d in docs[:300]]


@router.get("/conversas/{conversa_id}/mensagens")
async def mensagens(conversa_id: str, principal: Principal = Depends(_atender)):
    conv = await _conversa(conversa_id, principal)
    docs = await db.wa_mensagens.find({"conversa_id": conversa_id}).sort("em", -1).to_list(80)
    # O WhatsApp marca a hora em segundos: no mesmo segundo, vale a ordem de chegada.
    docs.sort(key=lambda m: (_iso(m.get("em")) or "", _iso(m.get("recebido_em")) or ""))
    if conv.get("nao_lidas"):
        await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"nao_lidas": 0}})
        await _mudou()
    return {"conversa": _saida_conversa({**conv, "nao_lidas": 0}),
            "mensagens": [{"id": m["_id"], "texto": m.get("texto"), "tipo": m.get("tipo") or "texto", "de_mim": bool(m.get("de_mim")),
                           "em": _iso(m.get("em")), "autor": m.get("autor"), "status": m.get("status"), "midia": _saida_midia(m)} for m in docs]}


TIPO_POR_ROTULO = {"Foto": "imagem", "Figurinha": "imagem", "Áudio": "audio", "Vídeo": "video", "Documento": "documento"}


def _saida_midia(m: dict) -> dict | None:
    """Mídia tocável na tela. Mensagens antigas (sem os dados guardados) tentam pelo id na Evolution."""
    md = m.get("midia")
    if md:
        return {"tipo": md.get("tipo"), "mime": md.get("mime"), "nome": md.get("nome"), "segundos": md.get("segundos")}
    tipo = TIPO_POR_ROTULO.get(m.get("tipo") or "")
    return {"tipo": tipo, "mime": None, "nome": None, "segundos": None} if tipo else None


@router.get("/mensagens/{mensagem_id}/midia")
async def midia(mensagem_id: str, principal: Principal = Depends(_atender)):
    """Áudio, foto, vídeo ou documento da mensagem, buscado na Evolution na hora (não guardamos o arquivo)."""
    m = await db.wa_mensagens.find_one({"_id": mensagem_id})
    if not m:
        raise HTTPException(404, "Mensagem não encontrada")
    conv = await _conversa(m["conversa_id"], principal)
    instancia = mensagem_id.split("|", 1)[0]
    md = m.get("midia") or {}
    tipo = md.get("tipo") or TIPO_POR_ROTULO.get(m.get("tipo") or "")
    if not tipo:
        raise HTTPException(404, "Esta mensagem não tem arquivo")
    key = m.get("chave_wa") or {"id": mensagem_id.split("|", 1)[1], "remoteJid": conv.get("jid"), "fromMe": bool(m.get("de_mim"))}
    try:
        conteudo, mime = await wa.baixar_midia(instancia, key, md.get("crua"), converter_audio=tipo == "audio")
    except wa.ErroWhatsApp as e:
        raise HTTPException(413 if e.status == 413 else 404, e.mensagem)
    nome = (md.get("nome") or "").replace('"', "")
    cabecalhos = {"Cache-Control": "private, max-age=86400"}
    if tipo == "documento" and nome:
        cabecalhos["Content-Disposition"] = f'inline; filename="{nome[:120]}"'
    return Response(conteudo, media_type=mime, headers=cabecalhos)


FOTO_VALIDADE = 24 * 3600


@router.get("/conversas/{conversa_id}/foto")
async def foto(conversa_id: str, principal: Principal = Depends(_atender)):
    """Foto de perfil do contato. O link do WhatsApp expira: renovamos uma vez por dia e servimos daqui."""
    conv = await _conversa(conversa_id, principal)
    agora = now_utc()
    em = conv.get("foto_em")
    url = conv.get("foto_url")
    fresca = isinstance(em, datetime) and (agora - (em if em.tzinfo else em.replace(tzinfo=timezone.utc))).total_seconds() < FOTO_VALIDADE
    if not fresca:
        url = await wa.foto_perfil(conversa_id.split("|", 1)[0], conv.get("jid") or "")
        await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"foto_url": url, "foto_em": agora}})
    if not url:
        raise HTTPException(404, "Contato sem foto")
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
            r = await c.get(url)
    except httpx.HTTPError:
        raise HTTPException(404, "Foto indisponível")
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"foto_em": None}})  # link venceu: renova na próxima
        raise HTTPException(404, "Foto indisponível")
    return Response(r.content, media_type=r.headers["content-type"], headers={"Cache-Control": "private, max-age=86400"})


class EnvioIn(BaseModel):
    texto: str = Field(min_length=1, max_length=4096)


async def _preparar_envio(conversa_id: str, principal: Principal) -> tuple[dict, dict]:
    conv = await _conversa(conversa_id, principal)
    conexao = await db.wa_conexoes.find_one({"id": conv.get("conexao_id")})
    if not conexao:
        raise HTTPException(409, "O número desta conversa foi desconectado do CRM.")
    if conexao.get("status") != "conectado":
        raise HTTPException(409, "O número desta conversa está desconectado. Peça ao gestor para ler o QR code de novo.")
    if conv.get("responsavel_id") is None and not principal.is_admin:
        # Sem responsável: quem responde primeiro fica com a conversa.
        r = await db.wa_conversas.update_one({"_id": conversa_id, "responsavel_id": None}, {"$set": {"responsavel_id": principal.pessoa_id}})
        if r.modified_count != 1:
            raise HTTPException(409, "Outra pessoa da equipe acabou de assumir esta conversa.")
    if conv.get("fluxo"):
        from lib.wa_fluxos import parar

        await parar(conversa_id)  # alguém da equipe assumiu: o robô para
    return conv, conexao


async def _gravar_enviada(conversa_id: str, conexao: dict, msg_id: str | None, texto: str, tipo: str, principal: Principal,
                          midia: dict | None = None) -> dict:
    agora = now_utc()
    em = agora.replace(microsecond=0)  # mesma precisão do WhatsApp (segundos); a ordem fina vem de recebido_em
    doc = {"_id": f"{conexao['instancia']}|{msg_id or new_id()}", "conversa_id": conversa_id, "texto": texto, "tipo": tipo,
           "de_mim": True, "em": em, "recebido_em": agora, "autor": principal.nome, "status": "enviada", "midia": midia}
    try:
        await db.wa_mensagens.insert_one(doc)
    except DuplicateKeyError:  # o webhook da própria mensagem chegou antes
        await db.wa_mensagens.update_one({"_id": doc["_id"]}, {"$set": {"autor": principal.nome}})
    await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"ultima_msg": texto[:160], "ultima_de_mim": True, "ultima_em": agora, "nao_lidas": 0}})
    await _mudou()
    return {"id": doc["_id"], "texto": texto, "tipo": tipo, "de_mim": True, "em": _iso(agora), "autor": principal.nome, "status": "enviada",
            "midia": _saida_midia(doc)}


@router.post("/conversas/{conversa_id}/mensagens", status_code=201)
async def enviar(conversa_id: str, input: EnvioIn, principal: Principal = Depends(_atender)):
    conv, conexao = await _preparar_envio(conversa_id, principal)
    texto = input.texto.strip()
    try:
        msg_id = await wa.enviar_texto(conexao["instancia"], conv["jid"], texto)
    except wa.ErroWhatsApp as e:
        raise wa.http(e)
    return await _gravar_enviada(conversa_id, conexao, msg_id, texto, "texto", principal)


LIMITE_ARQUIVO = 3 * 1024 * 1024  # a função do Vercel recebe até ~4,5 MB e o arquivo vai em base64


class MidiaIn(BaseModel):
    audio: bool = False
    base64: str = Field(min_length=8, max_length=4_300_000)
    mime: str = Field(min_length=3, max_length=120)
    nome: str | None = Field(default=None, max_length=180)
    legenda: str | None = Field(default=None, max_length=1024)
    segundos: int | None = Field(default=None, ge=0, le=3600)


@router.post("/conversas/{conversa_id}/midia", status_code=201)
async def enviar_midia(conversa_id: str, input: MidiaIn, principal: Principal = Depends(_atender)):
    """Áudio gravado no navegador ou arquivo (foto, vídeo, documento) enviado pela equipe."""
    import base64 as b64

    b = input.base64.split(",", 1)[1] if input.base64.startswith("data:") else input.base64
    try:
        tamanho = len(b64.b64decode(b, validate=True))
    except ValueError:
        raise HTTPException(422, "Arquivo inválido")
    if tamanho > LIMITE_ARQUIVO:
        raise HTTPException(413, "O arquivo passa de 3 MB. Envie um menor ou mande pelo celular.")
    conv, conexao = await _preparar_envio(conversa_id, principal)
    nome = (input.nome or "").strip()[:180] or None
    legenda = (input.legenda or "").strip() or None
    try:
        msg_id, mensagem = await wa.enviar_midia(conexao["instancia"], conv["jid"], audio=input.audio, base64=b, mime=input.mime,
                                                 nome=nome, legenda=legenda)
    except wa.ErroWhatsApp as e:
        raise wa.http(e)
    tipo_tela = "audio" if input.audio else {"image": "imagem", "video": "video"}.get(wa.tipo_envio(input.mime), "documento")
    midia = wa.midia_da_mensagem(mensagem) or {"tipo": tipo_tela, "mime": input.mime, "nome": nome, "segundos": input.segundos, "crua": None}
    rotulo = {"audio": "Áudio", "imagem": "Foto", "video": "Vídeo"}.get(tipo_tela, "Documento")
    texto = f"[{rotulo}] {legenda or (nome if tipo_tela == 'documento' else '') or ''}".strip()
    return await _gravar_enviada(conversa_id, conexao, msg_id, texto, rotulo, principal, midia)


class ResponsavelIn(BaseModel):
    pessoa_id: str | None = None


@router.put("/conversas/{conversa_id}/responsavel")
async def responsavel(conversa_id: str, input: ResponsavelIn, principal: Principal = Depends(_atender)):
    conv = await _conversa(conversa_id, principal)
    if not principal.is_admin and input.pessoa_id not in (principal.pessoa_id, None):
        raise HTTPException(403, "Só o gestor passa a conversa para outra pessoa.")
    if not principal.is_admin and conv.get("responsavel_id") not in (None, principal.pessoa_id):
        raise HTTPException(404, "Conversa não encontrada")
    await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"responsavel_id": input.pessoa_id}})
    if conv.get("entrada_id") and input.pessoa_id:
        await db.entradas.update_one({"id": conv["entrada_id"], "status": {"$in": ["novo", "em_contato"]}},
                                     {"$set": {"corretor_id": input.pessoa_id, "na_fila": False, "atribuido_em": now_utc()}})
    await _mudou()
    return _saida_conversa({**conv, "responsavel_id": input.pessoa_id})


@router.post("/conversas/{conversa_id}/lead")
async def criar_lead(conversa_id: str, principal: Principal = Depends(_atender)):
    """Leva o contato para Leads (origem WhatsApp). Se já existir, só devolve o lead."""
    conv = await _conversa(conversa_id, principal)
    if conv.get("entrada_id") and await db.entradas.find_one({"id": conv["entrada_id"]}, {"id": 1}):
        return {"entrada_id": conv["entrada_id"], "criado": False}
    entrada_id = await _novo_lead(conv, conv.get("ultima_msg"), conv.get("responsavel_id") or principal.pessoa_id)
    await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"entrada_id": entrada_id}})
    await _mudou()
    return {"entrada_id": entrada_id, "criado": True}


async def _novo_lead(conv: dict, mensagem: str | None, corretor_id: str | None) -> str:
    from lib.automacoes import lead_novo
    from models.crm import Entrada

    entrada = Entrada(nome=(conv.get("nome") or conv.get("telefone") or "Contato do WhatsApp")[:200], telefone=conv.get("telefone"),
                      origem="WhatsApp", interesse="outro", mensagem=(mensagem or None) and mensagem[:2000], corretor_id=corretor_id)
    await db.entradas.insert_one(entrada.model_dump())
    await lead_novo(entrada.model_dump())
    return entrada.id


# ------------------------------------------------------------------ webhook da Evolution API


@webhook_router.post("/whatsapp/{token}")
async def webhook(token: str, request: Request):
    try:
        corpo = await request.json()
    except ValueError:
        raise HTTPException(400, "JSON inválido")
    instancia = str((corpo or {}).get("instance") or "")
    indice = await controle[wa.INDICE].find_one({"_id": instancia}) if instancia else None
    cabecalho = request.headers.get("x-sax-token") or token
    if not indice or not hmac.compare_digest(str(indice.get("token")), token) or not hmac.compare_digest(str(indice.get("token")), cabecalho):
        raise HTTPException(404, "Instância desconhecida")
    definir_empresa(indice["db_name"])
    evento = str(corpo.get("event") or "").lower().replace("_", ".")
    dados = corpo.get("data") or {}
    if evento == "connection.update":
        await _conexao_mudou(instancia, dados)
    elif evento == "messages.upsert":
        for item in dados if isinstance(dados, list) else [dados]:
            await _mensagem_recebida(instancia, item)
    return {"ok": True}


async def _conexao_mudou(instancia: str, dados: dict) -> None:
    status = STATUS.get(str(dados.get("state") or ""), None)
    if not status:
        return
    mudar = {"status": status, "atualizado_em": now_utc()}
    wuid = dados.get("wuid") or ""
    if status == "conectado" and wuid:
        mudar["numero"] = wuid.split("@")[0]
        if dados.get("profileName"):
            mudar["perfil"] = str(dados["profileName"])[:80]
    await db.wa_conexoes.update_one({"instancia": instancia}, {"$set": mudar})
    await _mudou()


async def _mensagem_recebida(instancia: str, item: dict) -> None:
    key = item.get("key") or {}
    jid = wa.jid_do_contato(key)
    msg_id = key.get("id")
    if not jid or not msg_id:
        return
    conexao = await db.wa_conexoes.find_one({"instancia": instancia})
    if not conexao:
        return
    de_mim = bool(key.get("fromMe"))
    texto, tipo = wa.texto_da_mensagem(item.get("message") or {}, item.get("messageType"))
    ts = item.get("messageTimestamp")
    try:
        em = datetime.fromtimestamp(int(ts), tz=timezone.utc) if ts else now_utc()
    except (TypeError, ValueError, OverflowError):
        em = now_utc()
    conversa_id = f"{instancia}|{jid}"
    try:
        midia = wa.midia_da_mensagem(item.get("message") or {})
        await db.wa_mensagens.insert_one({"_id": f"{instancia}|{msg_id}", "conversa_id": conversa_id, "texto": texto[:4096], "tipo": tipo,
                                          "de_mim": de_mim, "em": em, "recebido_em": now_utc(), "autor": None if not de_mim else "Celular",
                                          "status": item.get("status"), "midia": midia,
                                          "chave_wa": {"id": msg_id, "remoteJid": key.get("remoteJid"), "fromMe": de_mim}})
    except DuplicateKeyError:
        return  # reenvio do webhook ou mensagem que o próprio CRM mandou
    nome = None if de_mim else (item.get("pushName") or "").strip()[:80] or None
    conv = await db.wa_conversas.find_one({"_id": conversa_id})
    nova = False
    if not conv:
        nova = True
        # Número com uma pessoa só (responsável ou setor de um membro): a conversa já nasce dela.
        equipe = _equipe_do_numero(conexao, await _setores_dict()) if _restrito(conexao) else set()
        novo = {"_id": conversa_id, "id": conversa_id, "jid": jid, "telefone": wa.telefone(jid), "nome": nome or wa.telefone(jid) or "Contato",
                "conexao_id": conexao["id"], "responsavel_id": next(iter(equipe)) if len(equipe) == 1 else None, "entrada_id": None,
                "nao_lidas": 0, "criado_em": now_utc()}
        try:
            await db.wa_conversas.insert_one(novo)
            conv = novo
            if not de_mim:
                await _primeiro_contato(conv, texto)
                conv = await db.wa_conversas.find_one({"_id": conversa_id}) or conv
        except DuplicateKeyError:
            conv = await db.wa_conversas.find_one({"_id": conversa_id}) or novo
    mudar: dict = {"ultima_msg": texto[:160], "ultima_de_mim": de_mim, "ultima_em": em}
    if nome and (not conv.get("nome") or conv.get("nome") == conv.get("telefone")):
        mudar["nome"] = nome
    atualizar: dict = {"$set": mudar}
    if not de_mim:
        atualizar["$inc"] = {"nao_lidas": 1}
    await db.wa_conversas.update_one({"_id": conversa_id}, atualizar)
    if not de_mim:
        from lib import wa_fluxos

        try:
            await wa_fluxos.ao_receber(await db.wa_conversas.find_one({"_id": conversa_id}) or conv, conexao, texto, nova)
        except Exception:  # robô com problema nunca derruba o recebimento da mensagem
            logger.exception("fluxo de resposta falhou")
    await _mudou()


async def _primeiro_contato(conv: dict, texto: str) -> None:
    """Contato novo: nos segmentos com Leads, vira lead (origem WhatsApp) e entra no rodízio da equipe."""
    from lib.crm import carregar_crm_config
    from lib.segmentos import segmento_de

    empresa = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"segmento": 1}) or {}
    if segmento_de(empresa) not in COM_LEADS:
        return
    telefone = conv.get("telefone")
    if telefone:  # já existe lead aberto com esse número: liga a conversa a ele
        for alvo in (telefone, telefone[2:] if telefone.startswith("55") else telefone):
            existente = await db.entradas.find_one({"telefone": alvo, "status": {"$in": ["novo", "em_contato"]}})
            if existente:
                await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"entrada_id": existente["id"], "responsavel_id": existente.get("corretor_id")}})
                return
    from routers.crm import _proximo_rodizio

    conexao = await db.wa_conexoes.find_one({"id": conv.get("conexao_id")}) or {}
    from lib.wa_fluxos import fluxo_de_entrada

    if await fluxo_de_entrada(conexao.get("id") or ""):
        corretor_id = conv.get("responsavel_id")  # o fluxo de entrada decide para quem vai (passo Transferir)
    elif _restrito(conexao):
        # Número de setor ou com responsáveis: o rodízio geral não vale. Uma pessoa só fica com a conversa;
        # mais de uma, a conversa espera na fila do número e quem responder primeiro fica.
        equipe = _equipe_do_numero(conexao, await _setores_dict())
        corretor_id = next(iter(equipe)) if len(equipe) == 1 else None
    else:
        corretor_id = await _proximo_rodizio() if (await carregar_crm_config()).distribuicao == "rodizio" else None
    entrada_id = await _novo_lead(conv, texto, corretor_id)
    await db.wa_conversas.update_one({"_id": conv["_id"]}, {"$set": {"entrada_id": entrada_id, "responsavel_id": corretor_id}})


# ------------------------------------------------------------------ servidor (plano de controle)


class ServidorIn(BaseModel):
    url: str = Field(min_length=8, max_length=200, pattern=r"^https?://")
    apikey: str | None = Field(default=None, max_length=200)


@admin_router.get("")
async def ver_servidor(principal: Principal = Depends(require("empresa:manage"))):
    cfg = await wa.config()
    chave = cfg.get("apikey") or ""
    total = await controle[wa.INDICE].count_documents({})
    return {"configurado": wa.configurado(cfg), "por_env": cfg["por_env"], "url": cfg["url"],
            "chave_mascarada": (chave[:3] + "..." + chave[-3:]) if len(chave) > 8 else None, "numeros": total}


@admin_router.put("")
async def salvar_servidor(input: ServidorIn, principal: Principal = Depends(require("empresa:manage"))):
    atual = await wa.config()
    cfg = {"url": input.url.strip().rstrip("/"), "apikey": (input.apikey or "").strip() or atual.get("apikey") or ""}
    if not cfg["apikey"]:
        raise HTTPException(422, "Informe a chave (apikey) do servidor.")
    try:
        await wa.chamar("GET", "/instance/fetchInstances", cfg=cfg)
    except wa.ErroWhatsApp as e:
        raise HTTPException(422, "Não consegui falar com o servidor com esses dados. Confira o endereço e a chave. " + e.mensagem)
    await controle.plataforma.update_one({"_id": wa.DOC}, {"$set": {**cfg, "atualizado_em": now_utc(), "atualizado_por": principal.email}}, upsert=True)
    return await ver_servidor(principal)
