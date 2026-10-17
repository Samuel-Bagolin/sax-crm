"""OLX na loja de veículos: conectar a conta da loja, publicar o estoque e receber os leads (regras em lib/olx.py)."""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from lib import automacoes, links
from lib import olx
from lib.auth import Principal, require
from lib.db import controle, db, definir_empresa, empresa_atual_db
from models.common import now_utc, utc_aware

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/olx", tags=["olx"])
publico_router = APIRouter(prefix="/publico/olx", tags=["publico"])
admin_router = APIRouter(prefix="/plataforma/olx", tags=["plataforma"])


def _loja(principal: Principal) -> None:
    if principal.segmento != "veiculos":
        raise HTTPException(404, "A integração com a OLX é da loja de veículos")


def _gestor(principal: Principal) -> None:
    _loja(principal)
    if not principal.is_admin:
        raise HTTPException(403, "Só o gestor mexe na integração com a OLX")


async def _cfg() -> dict:
    return (await db.configuracoes.find_one({"id": "singleton"}, {"olx": 1}) or {}).get("olx") or {}


async def _set(campos: dict) -> None:
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {f"olx.{k}": v for k, v in campos.items()}}, upsert=True)


async def _token_ou_erro() -> str:
    token = (await _cfg()).get("access_token")
    if not token:
        raise HTTPException(409, "Conecte a conta da OLX da loja primeiro.")
    return token


def _erro(e: olx.ErroOlx) -> HTTPException:
    return HTTPException(e.status if e.status < 500 else 502, e.mensagem)


async def _fotos(v: dict) -> list[str]:
    from routers.fotos_imovel import listar, url_publica

    return [url_publica(f["id"], absoluta=True) for f in await listar(v["id"])]


# ------------------------------------------------------------------ situação e configuração


class ConfigIn(BaseModel):
    cep: str | None = Field(default=None, max_length=12)
    telefone: str | None = Field(default=None, max_length=20)


@router.get("")
async def situacao(principal: Principal = Depends(require("veiculo:read"))):
    _loja(principal)
    cfg = await _cfg()
    app = await olx.app_config()
    marcados, prontos, publicados, lista = 0, 0, 0, []
    async for v in db.veiculos.find({"olx.publicar": True, "status": {"$in": ["disponivel", "reservado"]}}):
        marcados += 1
        falta = olx.pendencias(v, cfg, await _fotos(v))
        o = v.get("olx") or {}
        if not falta:
            prontos += 1
        if o.get("situacao") == "publicado":
            publicados += 1
        if falta or o.get("erros"):
            lista.append({"id": v["id"], "codigo": v.get("codigo"), "titulo": " ".join(str(x) for x in (v.get("marca"), v.get("modelo"), v.get("ano_modelo")) if x),
                          "faltando": falta, "erros": o.get("erros") or []})
    ultimo = cfg.get("ultimo_envio") or None
    if ultimo:
        ultimo = {**ultimo, "em": utc_aware(ultimo.get("em"))}
    return {
        "app_pronto": olx.app_pronto(app), "conectado": bool(cfg.get("access_token")),
        "conta": {"nome": cfg.get("conta_nome"), "email": cfg.get("conta_email")} if cfg.get("access_token") else None,
        "leads_ligados": bool(cfg.get("leads_ligados")), "cep": cfg.get("cep"), "telefone": cfg.get("telefone"),
        "marcados": marcados, "prontos": prontos, "publicados": publicados, "pendencias": lista[:100], "ultimo_envio": ultimo,
    }


@router.put("/config")
async def salvar_config(input: ConfigIn, principal: Principal = Depends(require("veiculo:update"))):
    _gestor(principal)
    import re

    cep = re.sub(r"\D", "", input.cep or "")
    tel = re.sub(r"\D", "", input.telefone or "")
    if cep and len(cep) != 8:
        raise HTTPException(422, "CEP deve ter 8 números")
    if tel and len(tel) not in (10, 11):
        raise HTTPException(422, "Telefone com DDD: 10 ou 11 números")
    await _set({"cep": cep or None, "telefone": tel or None})
    return await situacao(principal)


# ------------------------------------------------------------------ conectar a conta da loja (OAuth)


@router.post("/conectar")
async def conectar(principal: Principal = Depends(require("veiculo:update"))):
    """Devolve o endereço da OLX para o gestor autorizar. O `state` é de uso único e vale 15 minutos."""
    _gestor(principal)
    estado = await links.criar("olx_estado", principal.usuario_id)
    try:
        return {"url": await olx.url_autorizacao(estado)}
    except olx.ErroOlx as e:
        raise _erro(e)


@publico_router.get("/retorno")
async def retorno(state: str = Query("", max_length=100), code: str = Query("", max_length=500), error: str = Query("", max_length=100)):
    """A OLX volta para cá depois que o gestor autoriza. Troca o código pelo token e liga o recebimento de leads."""
    destino = f"{olx.base_app()}/veiculos?olx="
    try:
        await links.resolver(state, "olx_estado")
    except HTTPException:
        return RedirectResponse(destino + "expirou", status_code=302)
    indice = await controle.links_publicos.find_one({"_id": links.digest(state)})
    await controle.links_publicos.delete_one({"_id": links.digest(state)})  # uso único
    em = utc_aware((indice or {}).get("em"))
    if not em or now_utc() - em > timedelta(minutes=15):
        return RedirectResponse(destino + "expirou", status_code=302)
    if error or not code:
        return RedirectResponse(destino + "recusado", status_code=302)
    try:
        token = await olx.trocar_codigo(code)
        conta = await olx.conta(token)
    except olx.ErroOlx as e:
        logger.warning("olx retorno: %s", e.mensagem)
        return RedirectResponse(destino + "erro", status_code=302)
    await _set({"access_token": token, "conta_nome": conta.get("nome"), "conta_email": conta.get("email"),
                "conectado_em": now_utc(), "leads_ligados": False})
    await _ligar_leads(token)
    return RedirectResponse(destino + "conectado", status_code=302)


async def _ligar_leads(token: str) -> bool:
    """Cadastra na OLX a URL que recebe os leads da loja (com um segredo que a OLX devolve no cabeçalho)."""
    url_token = await links.criar("olx_leads", "webhook", substituir=True)
    segredo = olx.novo_segredo()
    try:
        cid = await olx.configurar_leads(token, f"{olx.base_app()}/api/publico/olx/leads/{url_token}", segredo)
    except olx.ErroOlx as e:
        logger.warning("olx leads de %s: %s", empresa_atual_db(), e.mensagem)
        await _set({"leads_ligados": False})
        return False
    await _set({"leads_ligados": True, "leads_config_id": cid, "leads_segredo": segredo})
    return True


@router.post("/religar-leads")
async def religar_leads(principal: Principal = Depends(require("veiculo:update"))):
    _gestor(principal)
    ok = await _ligar_leads(await _token_ou_erro())
    if not ok:
        raise HTTPException(502, "A OLX não aceitou a configuração de leads agora. Tente de novo em alguns minutos.")
    return await situacao(principal)


@router.post("/desconectar")
async def desconectar(principal: Principal = Depends(require("veiculo:update"))):
    _gestor(principal)
    await links.revogar("olx_leads", "webhook")
    await db.configuracoes.update_one({"id": "singleton"}, {"$unset": {"olx.access_token": "", "olx.leads_segredo": ""},
                                                            "$set": {"olx.leads_ligados": False, "olx.conta_nome": None, "olx.conta_email": None}})
    return await situacao(principal)


# ------------------------------------------------------------------ catálogo e envio dos anúncios


@router.get("/catalogo")
async def catalogo(marca: str | None = Query(None, max_length=20), modelo: str | None = Query(None, max_length=20),
                   principal: Principal = Depends(require("veiculo:read"))):
    _loja(principal)
    try:
        return await olx.catalogo(await _token_ou_erro(), marca, modelo)
    except olx.ErroOlx as e:
        raise _erro(e)


async def sincronizar_loja() -> dict:
    """Publica (insere ou atualiza) os carros marcados e prontos e tira da OLX o que saiu: vendido, desmarcado
    ou com pendência. Usado pelo botão e pela rotina diária."""
    cfg = await _cfg()
    token = cfg.get("access_token")
    if not token:
        raise HTTPException(409, "Conecte a conta da OLX da loja primeiro.")
    inserir, apagar, ids_inserir, ids_apagar, pendentes = [], [], [], [], 0
    async for v in db.veiculos.find({}):
        o = v.get("olx") or {}
        quer = o.get("publicar") and v.get("status") in ("disponivel", "reservado")
        fotos = await _fotos(v) if quer else []
        falta = olx.pendencias(v, cfg, fotos) if quer else []
        if quer and not falta:
            inserir.append(olx.anuncio(v, cfg, fotos))
            ids_inserir.append(v["id"])
        elif o.get("situacao") in ("publicado", "enviado"):
            apagar.append({"id": olx.id_anuncio(v), "operation": "delete"})
            ids_apagar.append(v["id"])
        if quer and falta:
            pendentes += 1
    if not inserir and not apagar:
        r = {"ok": True, "status": -3, "mensagem": "Nenhum carro pronto para a OLX.", "enviados": 0, "removidos": 0, "erros": {}, "pendentes": pendentes}
    else:
        try:
            res = await olx.importar(token, inserir + apagar)
        except olx.ErroOlx as e:
            await _set({"ultimo_envio": {"em": now_utc(), "ok": False, "mensagem": e.mensagem}})
            raise _erro(e)
        erros = res["erros"]
        codigos = {}
        async for v in db.veiculos.find({"id": {"$in": ids_inserir + ids_apagar}}, {"id": 1, "codigo": 1}):
            codigos[v["id"]] = olx.id_anuncio(v)
        aceitos = res["status"] in (0, -8)
        for vid in ids_inserir:
            motivos = [olx.ERROS.get(m, m) for m in erros.get(codigos.get(vid, ""), [])]
            if motivos:
                await db.veiculos.update_one({"id": vid}, {"$set": {"olx.situacao": "erro", "olx.erros": motivos, "olx.enviado_em": now_utc()}})
            elif aceitos:
                await db.veiculos.update_one({"id": vid}, {"$set": {"olx.situacao": "enviado", "olx.erros": [], "olx.enviado_em": now_utc()}})
            # lote recusado por causa de outro carro: este fica como estava na OLX
        if aceitos:
            for vid in ids_apagar:
                await db.veiculos.update_one({"id": vid}, {"$set": {"olx.situacao": "removido", "olx.erros": [], "olx.enviado_em": now_utc()}})
        mensagem = "Anúncios enviados. A OLX revisa antes de publicar." if res["status"] == 0 else olx.MENSAGENS.get(res["status"], res["mensagem"])
        r = {"ok": res["ok"], "status": res["status"], "mensagem": mensagem, "enviados": len(inserir), "removidos": len(apagar),
             "erros": {k: [olx.ERROS.get(m, m) for m in v] for k, v in erros.items()}, "pendentes": pendentes, "tokens": res["tokens"]}
    await _set({"ultimo_envio": {"em": now_utc(), "ok": r["ok"], "mensagem": r["mensagem"], "enviados": r["enviados"], "removidos": r["removidos"]}})
    return r


@router.post("/sincronizar")
async def sincronizar(principal: Principal = Depends(require("veiculo:update"))):
    _gestor(principal)
    return await sincronizar_loja()


async def tirar_vendido(v: dict) -> None:
    """Carro vendido sai da OLX na hora (sem esperar a rotina). Falha não atrapalha a venda."""
    o = v.get("olx") or {}
    if o.get("situacao") not in ("publicado", "enviado"):
        return
    token = (await _cfg()).get("access_token")
    if not token:
        return
    try:
        res = await olx.importar(token, [{"id": olx.id_anuncio(v), "operation": "delete"}])
        if res["status"] == 0:
            await db.veiculos.update_one({"id": v["id"]}, {"$set": {"olx.situacao": "removido", "olx.enviado_em": now_utc()}})
    except olx.ErroOlx as e:
        logger.warning("olx: não tirei %s depois da venda: %s", v.get("codigo"), e.mensagem)


async def sincronizar_todas() -> int:
    """Rotina diária: cada loja conectada manda o estoque de novo (preço, fotos, vendidos)."""
    feitas = 0
    async for e in controle.empresas.find({"segmento": "veiculos", "ativo": {"$ne": False}}, {"db_name": 1}):
        definir_empresa(e["db_name"])
        try:
            if (await _cfg()).get("access_token"):
                await sincronizar_loja()
                feitas += 1
        except Exception:
            logger.exception("olx: rotina falhou em %s", e.get("db_name"))
        finally:
            definir_empresa(None)
    return feitas


# ------------------------------------------------------------------ leads da OLX


@publico_router.post("/leads/{token}")
async def receber_lead(token: str, request: Request):
    """Cada lead chega sozinho. Responder 2xx em menos de 5 s; a OLX não reenvia o que falhar."""
    await links.resolver(token, "olx_leads")
    cfg = await _cfg()
    cab = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    if cfg.get("leads_segredo") and cab and cab != cfg["leads_segredo"]:
        raise HTTPException(401, "Token inválido")
    try:
        p = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")
    if not isinstance(p, dict):
        raise HTTPException(400, "JSON inválido")
    externo = str(p.get("externalId") or "").strip()[:120] or None
    chave = f"olx:{externo}" if externo else None
    if chave:
        existente = await db.entradas.find_one({"portal_lead_id": chave}, {"id": 1})
        if existente:
            return {"responseId": existente["id"], "duplicado": True}
    from models.crm import Entrada
    from lib.crm import carregar_crm_config
    from lib.temperatura import da_origem

    codigo = str(p.get("adId") or "").strip()[:30]
    veiculo = await db.veiculos.find_one({"codigo": codigo}, {"id": 1}) if codigo else None
    canal = {"whatsapp": "WhatsApp", "telefone": "Telefone", "chat": "Chat", "financing": "Simulação de financiamento", "olx": "Formulário"}.get(
        str(p.get("source") or "").lower(), str(p.get("source") or ""))
    partes = [str(p.get("message") or "").strip(), f"Canal na OLX: {canal}" if canal else "",
              f"Anúncio: {p['linkAd']}" if p.get("linkAd") else "",
              "" if veiculo or not codigo else f"Código do anúncio não encontrado no estoque: {codigo}"]
    troca = ((p.get("buyerHistory") or {}).get("adToExchange") or {}) if isinstance(p.get("buyerHistory"), dict) else {}
    if troca.get("subject"):
        partes.append(f"Quer dar na troca: {troca['subject']}")
    corretor_id = None
    if (await carregar_crm_config()).distribuicao == "rodizio":
        from routers.crm import _proximo_rodizio

        corretor_id = await _proximo_rodizio()
    nome = str(p.get("name") or "").strip()[:200] or "Cliente da OLX"
    tel = "".join(c for c in str(p.get("phone") or "") if c.isdigit())[:13] or None
    entrada = Entrada(nome=nome, telefone=tel, email=(str(p.get("email") or "").strip().lower() or None), origem="OLX",
                      interesse="compra", mensagem="\n".join(x for x in partes if x)[:2000] or None,
                      veiculo_id=(veiculo or {}).get("id"), corretor_id=corretor_id, etiquetas=[], portal_lead_id=chave)
    entrada.temperatura = await da_origem("OLX")
    await db.entradas.insert_one(entrada.model_dump())
    await automacoes.lead_novo(entrada.model_dump())
    return {"responseId": entrada.id}


# ------------------------------------------------------------------ aplicativo da SAX na OLX (administrador da plataforma)


class AppIn(BaseModel):
    client_id: str = Field(min_length=3, max_length=200)
    client_secret: str | None = Field(default=None, max_length=300)


@admin_router.get("")
async def ver_app(principal: Principal = Depends(require("empresa:manage"))):
    cfg = await olx.app_config()
    s = cfg.get("client_secret") or ""
    lojas = 0
    async for e in controle.empresas.find({"segmento": "veiculos"}, {"db_name": 1}):
        from lib.db import client

        if ((await client[e["db_name"]].configuracoes.find_one({"id": "singleton"}, {"olx": 1}) or {}).get("olx") or {}).get("access_token"):
            lojas += 1
    return {"configurado": olx.app_pronto(cfg), "por_env": cfg["por_env"], "client_id": cfg.get("client_id") or None,
            "segredo_mascarado": (s[:2] + "..." + s[-2:]) if len(s) > 6 else None, "redirect_uri": olx.redirect_uri(), "lojas_conectadas": lojas}


@admin_router.put("")
async def salvar_app(input: AppIn, principal: Principal = Depends(require("empresa:manage"))):
    atual = await olx.app_config()
    segredo = (input.client_secret or "").strip() or atual.get("client_secret") or ""
    if not segredo:
        raise HTTPException(422, "Informe a chave secreta (client_secret) que a OLX enviou.")
    await controle.plataforma.update_one({"_id": olx.DOC}, {"$set": {
        "client_id": input.client_id.strip(), "client_secret": segredo, "atualizado_em": now_utc(), "atualizado_por": principal.email}}, upsert=True)
    return await ver_app(principal)
