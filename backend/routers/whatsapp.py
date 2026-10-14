"""WhatsApp dentro do CRM: números conectados por QR code, caixa de conversas e resposta pela equipe.

Coleções no banco da empresa:
- wa_conexoes: números (instâncias da Evolution API) com status.
- wa_conversas: uma por contato e número (`_id` = instância|jid). Responsável = pessoa_id da equipe.
- wa_mensagens: uma por mensagem (`_id` = instância|id da mensagem, não duplica em reenvio do webhook).
- wa_estado: contador `versao` que sobe a cada mudança. A tela consulta só ele (1 leitura) e recarrega a
  lista quando muda, em vez de varrer as conversas a cada poucos segundos.

Quem vê o quê: gestor vê tudo. Corretor/profissional vê as conversas dele e as sem responsável; ao
responder uma sem responsável, ela passa a ser dele (quem pega primeiro fica, com update condicional).
"""

import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
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
COM_LEADS = ("imobiliaria", "veiculos", "odontologia", "estetica")
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


def _pode_ver(conv: dict, principal: Principal) -> bool:
    return principal.is_admin or conv.get("responsavel_id") in (None, principal.pessoa_id)


async def _conversa(conversa_id: str, principal: Principal) -> dict:
    conv = await db.wa_conversas.find_one({"_id": conversa_id})
    if not conv or not _pode_ver(conv, principal):
        raise HTTPException(404, "Conversa não encontrada")
    return conv


def _saida_conversa(c: dict) -> dict:
    return {"id": c["_id"], "nome": c.get("nome") or c.get("telefone") or "Contato", "telefone": c.get("telefone"),
            "conexao_id": c.get("conexao_id"), "responsavel_id": c.get("responsavel_id"), "entrada_id": c.get("entrada_id"),
            "ultima_msg": c.get("ultima_msg"), "ultima_de_mim": bool(c.get("ultima_de_mim")), "ultima_em": _iso(c.get("ultima_em")),
            "nao_lidas": int(c.get("nao_lidas") or 0)}


def _saida_conexao(c: dict) -> dict:
    return {"id": c["id"], "nome": c.get("nome"), "status": c.get("status") or "aguardando_qr", "numero": c.get("numero"),
            "perfil": c.get("perfil"), "criado_em": _iso(c.get("criado_em"))}


# ------------------------------------------------------------------ situação e números


@router.get("/situacao")
async def situacao(principal: Principal = Depends(require("whatsapp:atender"))):
    """O que a tela precisa para decidir o que mostrar (sem exigir o recurso, para explicar quando falta)."""
    cfg = await wa.config()
    estado = await db.wa_estado.find_one({"id": "singleton"}) or {}
    conexoes = await db.wa_conexoes.find({}).to_list(LIMITE_NUMEROS + 5) if principal.empresa_id else []
    return {"servidor_ok": wa.configurado(cfg), "liberado": await recurso_liberado("whatsapp"), "pode_gerir": principal.is_admin,
            "versao": int(estado.get("versao") or 0), "conexoes": [_saida_conexao(c) for c in conexoes]}


@router.get("/versao")
async def versao(principal: Principal = Depends(_atender)):
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


# ------------------------------------------------------------------ conversas


@router.get("/conversas")
async def conversas(filtro: str = Query("todas", pattern="^(todas|minhas|sem_responsavel|nao_lidas)$"), principal: Principal = Depends(_atender)):
    if principal.is_admin and filtro in ("todas", "nao_lidas"):
        docs = await db.wa_conversas.find({}).sort("ultima_em", -1).to_list(300)
    elif filtro == "minhas" or (not principal.is_admin and filtro == "todas"):
        docs = await db.wa_conversas.find({"responsavel_id": principal.pessoa_id}).sort("ultima_em", -1).to_list(300)
        if filtro == "todas":  # corretor: as dele e as sem responsável
            docs += await db.wa_conversas.find({"responsavel_id": None}).sort("ultima_em", -1).to_list(300)
    elif filtro == "sem_responsavel":
        docs = await db.wa_conversas.find({"responsavel_id": None}).sort("ultima_em", -1).to_list(300)
    else:  # nao_lidas, corretor
        docs = [d for d in await db.wa_conversas.find({"responsavel_id": principal.pessoa_id}).to_list(300)]
        docs += await db.wa_conversas.find({"responsavel_id": None}).to_list(300)
    if filtro == "nao_lidas":
        docs = [d for d in docs if d.get("nao_lidas")]
    docs = [d for d in docs if _pode_ver(d, principal)]
    docs.sort(key=lambda d: _iso(d.get("ultima_em")) or "", reverse=True)
    return [_saida_conversa(d) for d in docs]


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
                           "em": _iso(m.get("em")), "autor": m.get("autor"), "status": m.get("status")} for m in docs]}


class EnvioIn(BaseModel):
    texto: str = Field(min_length=1, max_length=4096)


@router.post("/conversas/{conversa_id}/mensagens", status_code=201)
async def enviar(conversa_id: str, input: EnvioIn, principal: Principal = Depends(_atender)):
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
    texto = input.texto.strip()
    try:
        msg_id = await wa.enviar_texto(conexao["instancia"], conv["jid"], texto)
    except wa.ErroWhatsApp as e:
        raise wa.http(e)
    agora = now_utc()
    em = agora.replace(microsecond=0)  # mesma precisão do WhatsApp (segundos); a ordem fina vem de recebido_em
    doc = {"_id": f"{conexao['instancia']}|{msg_id or new_id()}", "conversa_id": conversa_id, "texto": texto, "tipo": "texto",
           "de_mim": True, "em": em, "recebido_em": agora, "autor": principal.nome, "status": "enviada"}
    try:
        await db.wa_mensagens.insert_one(doc)
    except DuplicateKeyError:  # o webhook da própria mensagem chegou antes
        await db.wa_mensagens.update_one({"_id": doc["_id"]}, {"$set": {"autor": principal.nome}})
    await db.wa_conversas.update_one({"_id": conversa_id}, {"$set": {"ultima_msg": texto[:160], "ultima_de_mim": True, "ultima_em": agora, "nao_lidas": 0}})
    await _mudou()
    return {"id": doc["_id"], "texto": texto, "tipo": "texto", "de_mim": True, "em": _iso(agora), "autor": principal.nome, "status": "enviada"}


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
        await db.wa_mensagens.insert_one({"_id": f"{instancia}|{msg_id}", "conversa_id": conversa_id, "texto": texto[:4096], "tipo": tipo,
                                          "de_mim": de_mim, "em": em, "recebido_em": now_utc(), "autor": None if not de_mim else "Celular",
                                          "status": item.get("status")})
    except DuplicateKeyError:
        return  # reenvio do webhook ou mensagem que o próprio CRM mandou
    nome = None if de_mim else (item.get("pushName") or "").strip()[:80] or None
    conv = await db.wa_conversas.find_one({"_id": conversa_id})
    if not conv:
        novo = {"_id": conversa_id, "id": conversa_id, "jid": jid, "telefone": wa.telefone(jid), "nome": nome or wa.telefone(jid) or "Contato",
                "conexao_id": conexao["id"], "responsavel_id": None, "entrada_id": None, "nao_lidas": 0, "criado_em": now_utc()}
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
