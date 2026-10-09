"""Integração Google por usuário: conexão OAuth, Google Agenda (sincronização + leitura) e Drive."""

import logging
import os
import secrets
from datetime import timedelta

import jwt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from lib import google
from lib.planos import exigir_recurso, recurso_liberado
from lib.auth import ALGORITHM, Principal, _segredo, principal_atual, require
from lib.db import db, definir_empresa, empresa_atual_db
from models.common import now_utc, utc_aware

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/google", tags=["google"])


class StatusGoogle(BaseModel):
    configurado: bool
    conectado: bool
    email: str | None = None
    sync_agenda: bool = True
    mostrar_agenda: bool = True
    erro: str | None = None
    picker_disponivel: bool = False
    no_plano: bool = True


class PreferenciasGoogle(BaseModel):
    sync_agenda: bool | None = None
    mostrar_agenda: bool | None = None


@router.get("/status", response_model=StatusGoogle)
async def status(principal: Principal = Depends(principal_atual)):
    doc = await google.conta(principal.usuario_id)
    return StatusGoogle(
        configurado=google.configurado(), conectado=bool(doc), email=(doc or {}).get("email"),
        sync_agenda=(doc or {}).get("sync_agenda", True), mostrar_agenda=(doc or {}).get("mostrar_agenda", True),
        erro=(doc or {}).get("erro"),
        picker_disponivel=bool(os.environ.get("GOOGLE_API_KEY") and os.environ.get("GOOGLE_APP_ID")),
        no_plano=await recurso_liberado("google"),
    )


@router.get("/conectar")
async def conectar(principal: Principal = Depends(principal_atual)):
    """Devolve a URL de consentimento do Google. O `state` assinado amarra a volta a este usuário."""
    await exigir_recurso("google")
    state = jwt.encode({"u": principal.usuario_id, "e": principal.empresa_id, "n": secrets.token_hex(8),
                        "exp": now_utc() + timedelta(minutes=10)}, _segredo(), algorithm=ALGORITHM)
    return {"url": google.url_autorizacao(state, principal.email)}


@router.get("/callback")
async def callback(code: str | None = None, state: str | None = None, error: str | None = None,
                   principal: Principal = Depends(principal_atual)):
    destino = "/perfil?google="
    if error or not code or not state:
        return RedirectResponse(destino + "cancelado")
    try:
        dados = jwt.decode(state, _segredo(), algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return RedirectResponse(destino + "expirado")
    if dados.get("u") != principal.usuario_id or dados.get("e") != principal.empresa_id:
        return RedirectResponse(destino + "outra-sessao")
    try:
        tok = await google.trocar_codigo(code)
        await google.salvar_conta(principal.usuario_id, tok)
    except HTTPException as e:
        logger.warning("callback google: %s", e.detail)
        return RedirectResponse(destino + "erro")
    return RedirectResponse(destino + "ok")


@router.post("/desconectar", status_code=204)
async def desconectar(principal: Principal = Depends(principal_atual)):
    await google.revogar(principal.usuario_id)
    await db.atividades.update_many({"google_usuario": principal.usuario_id}, {"$unset": {"google_evento_id": "", "google_usuario": ""}})
    await db.visitas.update_many({"google_usuario": principal.usuario_id}, {"$unset": {"google_evento_id": "", "google_usuario": ""}})
    return None


@router.patch("/preferencias", response_model=StatusGoogle)
async def preferencias(input: PreferenciasGoogle, principal: Principal = Depends(principal_atual)):
    if not await google.conta(principal.usuario_id):
        raise HTTPException(409, "Conecte sua conta Google primeiro")
    await db.google_contas.update_one({"usuario_id": principal.usuario_id}, {"$set": input.model_dump(exclude_none=True)})
    return await status(principal)


@router.post("/sincronizar")
async def sincronizar_tudo(principal: Principal = Depends(principal_atual)):
    """Envia ao Google as atividades e visitas futuras do usuário (primeira conexão ou reparo)."""
    if not principal.pessoa_id:
        return {"enviados": 0}
    from lib.dates import today_iso
    hoje = today_iso()
    n = 0
    async for a in db.atividades.find({"corretor_id": principal.pessoa_id, "concluida": False, "data": {"$gte": hoje}}):
        if await sincronizar_atividade(a["id"]):
            n += 1
    async for v in db.visitas.find({"corretor_id": principal.pessoa_id, "status": "agendada", "data": {"$gte": hoje}}):
        if await sincronizar_visita(v["id"]):
            n += 1
    return {"enviados": n}


@router.get("/eventos")
async def eventos(inicio: str, fim: str, corretor_id: str | None = None, principal: Principal = Depends(require("atividade:read"))):
    """Compromissos do Google para mostrar na agenda do CRM.

    - Os próprios: título e horário (exceto os que o CRM mesmo criou, para não duplicar).
    - De outro corretor (só gestor): apenas blocos "Ocupado", sem título — a agenda pessoal é privada.
    """
    alvo_usuario = principal.usuario_id
    privado = False
    if corretor_id and corretor_id != principal.pessoa_id:
        if not principal.is_admin:
            raise HTTPException(403, "Sem acesso à agenda de outro corretor")
        u = await db.usuarios.find_one({"pessoa_id": corretor_id}, {"id": 1})
        if not u:
            return []
        alvo_usuario, privado = u["id"], True
    doc = await google.conta(alvo_usuario)
    if not doc or (not privado and not doc.get("mostrar_agenda", True)):
        return []
    try:
        if privado:
            blocos = await google.ocupado(alvo_usuario, inicio, fim)
            return [{"id": f"busy-{i}", "titulo": "Ocupado (Google)", "inicio": b["start"], "fim": b["end"], "dia_todo": False,
                     "corretor_id": corretor_id, "privado": True} for i, b in enumerate(blocos)]
        itens = await google.listar_eventos(alvo_usuario, inicio, fim)
    except HTTPException:
        return []
    saida = []
    for ev in itens:
        if (ev.get("extendedProperties", {}).get("private", {}) or {}).get("crm_origem"):
            continue  # já aparece como atividade/visita do CRM
        s, e = ev.get("start", {}), ev.get("end", {})
        saida.append({
            "id": ev.get("id"), "titulo": ev.get("summary") or "(sem título)", "inicio": s.get("dateTime") or s.get("date"),
            "fim": e.get("dateTime") or e.get("date"), "dia_todo": "date" in s and "dateTime" not in s,
            "link": ev.get("htmlLink"), "corretor_id": principal.pessoa_id, "privado": False,
        })
    return saida


@router.get("/picker-token")
async def picker_token(principal: Principal = Depends(principal_atual)):
    """Token curto para o seletor do Google Drive no navegador (escopo drive.file)."""
    token = await google.token_valido(principal.usuario_id)
    if not token:
        raise HTTPException(409, "Conecte sua conta Google para escolher arquivos do Drive")
    return {"access_token": token, "api_key": os.environ.get("GOOGLE_API_KEY"), "app_id": os.environ.get("GOOGLE_APP_ID"),
            "client_id": os.environ.get("GOOGLE_CLIENT_ID")}


# ------------------------------------------------------------------ sincronização (chamada pelos routers)

async def _usuario_do_corretor(pessoa_id: str | None) -> dict | None:
    if not pessoa_id:
        return None
    u = await db.usuarios.find_one({"pessoa_id": pessoa_id, "ativo": True}, {"id": 1})
    if not u:
        return None
    conta = await google.conta(u["id"])
    if not conta or not conta.get("sync_agenda", True):
        return None
    return u


async def sincronizar_atividade(atividade_id: str) -> bool:
    from routers.crm import TIPO_LABEL
    a = await db.atividades.find_one({"id": atividade_id})
    if not a:
        return False
    u = await _usuario_do_corretor(a.get("corretor_id"))
    dono_antigo = a.get("google_usuario")
    # Mudou de responsável ou foi concluída/excluída: remove o evento do Google antigo.
    if dono_antigo and a.get("google_evento_id") and (not u or u["id"] != dono_antigo or a.get("concluida")):
        try:
            await google.apagar_evento(dono_antigo, a["google_evento_id"])
        except HTTPException:
            pass
        await db.atividades.update_one({"id": atividade_id}, {"$unset": {"google_evento_id": "", "google_usuario": ""}})
        a.pop("google_evento_id", None)
    if not u or a.get("concluida"):
        return False
    negocio = await db.leads.find_one({"id": a.get("negocio_id")}, {"nome": 1}) if a.get("negocio_id") else None
    base = (os.environ.get("APP_URL") or "").rstrip("/")
    descricao = "\n".join(x for x in [
        f"{TIPO_LABEL.get(a['tipo'], 'Atividade')} no SAX CRM",
        f"Negócio: {negocio['nome']}" if negocio else "",
        f"{base}/negocios/{a['negocio_id']}" if negocio and base else "",
        a.get("notas") or "",
    ] if x)
    corpo = google.evento_de(f"{TIPO_LABEL.get(a['tipo'], '')}: {a['assunto']}", a["data"], a.get("hora"), a.get("duracao_min", 30), descricao, None, f"atividade:{a['id']}")
    try:
        evento = await google.salvar_evento(u["id"], a.get("google_evento_id") if a.get("google_usuario") == u["id"] else None, corpo)
    except HTTPException as e:
        await db.atividades.update_one({"id": atividade_id}, {"$set": {"google_erro": e.detail}})
        return False
    await db.atividades.update_one({"id": atividade_id}, {"$set": {"google_evento_id": evento, "google_usuario": u["id"], "google_erro": None}})
    return True


async def sincronizar_visita(visita_id: str) -> bool:
    v = await db.visitas.find_one({"id": visita_id})
    if not v:
        return False
    u = await _usuario_do_corretor(v.get("corretor_id"))
    dono_antigo = v.get("google_usuario")
    if dono_antigo and v.get("google_evento_id") and (not u or u["id"] != dono_antigo or v.get("status") == "cancelada"):
        try:
            await google.apagar_evento(dono_antigo, v["google_evento_id"])
        except HTTPException:
            pass
        await db.visitas.update_one({"id": visita_id}, {"$unset": {"google_evento_id": "", "google_usuario": ""}})
        v.pop("google_evento_id", None)
    if not u or v.get("status") == "cancelada":
        return False
    cliente = await db.pessoas.find_one({"id": v.get("cliente_id")}, {"nome": 1, "telefone": 1}) if v.get("cliente_id") else None
    imovel = await db.imoveis.find_one({"id": v.get("imovel_id")}, {"titulo": 1, "endereco": 1, "cidade": 1}) if v.get("imovel_id") else None
    descricao = "\n".join(x for x in [
        "Visita agendada no SAX CRM",
        f"Cliente: {cliente['nome']} {cliente.get('telefone') or ''}".strip() if cliente else "",
        f"Imóvel: {imovel['titulo']}" if imovel else "",
        v.get("observacoes") or "",
    ] if x)
    local = v.get("local") or (", ".join(x for x in [(imovel or {}).get("endereco"), (imovel or {}).get("cidade")] if x) or None)
    corpo = google.evento_de(f"Visita: {v['titulo']}", v["data"], v.get("hora"), v.get("duracao_min", 60), descricao, local, f"visita:{v['id']}")
    try:
        evento = await google.salvar_evento(u["id"], v.get("google_evento_id") if v.get("google_usuario") == u["id"] else None, corpo)
    except HTTPException as e:
        await db.visitas.update_one({"id": visita_id}, {"$set": {"google_erro": e.detail}})
        return False
    await db.visitas.update_one({"id": visita_id}, {"$set": {"google_evento_id": evento, "google_usuario": u["id"], "google_erro": None}})
    return True


async def remover_evento(google_usuario: str | None, evento_id: str | None) -> None:
    if google_usuario and evento_id:
        try:
            await google.apagar_evento(google_usuario, evento_id)
        except HTTPException:
            pass


def agendar(background: BackgroundTasks, funcao, *args) -> None:
    """Roda a sincronização depois da resposta, no banco da mesma empresa."""
    banco = empresa_atual_db()

    async def tarefa():
        definir_empresa(banco)
        try:
            await funcao(*args)
        except Exception:
            logger.exception("sincronização Google falhou")
        finally:
            definir_empresa(None)

    background.add_task(tarefa)
