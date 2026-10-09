"""Configuração do sistema + webhook de leads do site.

RBAC: `config:read` / `config:write` existem só para o papel **sysadmin** (Administrador de
Sistema). A rota pública de identidade visual não exige sessão (a tela de login precisa dela) e
nunca devolve segredos.
"""

import base64
import hmac
import logging
import secrets
from typing import List

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from lib.auth import Principal, principal_opcional, require
from lib.db import controle, db, definir_empresa, empresa_atual_db
from lib.integrity import audit, page
import hashlib
import json
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from models.common import now_utc, utc_aware
from models.config import (
    CONFIG_ID,
    MODULOS,
    ConfigLog,
    Configuracao,
    ConfiguracaoPublica,
    ConfiguracaoUpdate,
    LeadDoSite,
    LogoInput,
)
from models.leads import Lead
from models.pessoas import Pessoa

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/configuracoes", tags=["configuracao"])
site_router = APIRouter(prefix="/site", tags=["site"])


async def carregar() -> Configuracao:
    doc = await db.configuracoes.find_one({"id": CONFIG_ID})
    if not doc:
        config = Configuracao(site_api_key=f"ik_{secrets.token_hex(16)}")
        await db.configuracoes.insert_one(config.model_dump())
        return config
    doc = dict(doc)
    doc.pop("_id", None)
    doc["atualizado_em"] = utc_aware(doc.get("atualizado_em"))
    return Configuracao(**doc)


@router.get("/publica", response_model=ConfiguracaoPublica)
async def config_publica(
    empresa: str | None = Query(None, description="slug da empresa"),
    principal: Principal | None = Depends(principal_opcional),
):
    """Identidade visual e módulos ativos — sem sessão, sem segredos.

    Com sessão, a empresa vem do token (já fixada por `principal_opcional`). Sem sessão, vem do
    slug (?empresa=) ou, se a instalação tiver uma única empresa ativa, dela mesma.
    """
    if not empresa_atual_db():
        doc = None
        if empresa:
            doc = await controle.empresas.find_one({"slug": empresa, "ativo": True})
        elif await controle.empresas.count_documents({"ativo": True}) == 1:
            doc = await controle.empresas.find_one({"ativo": True})
        if doc:
            definir_empresa(doc["db_name"])
    c = await carregar()
    public = c.model_dump()
    if principal and principal.empresa_id:
        company = await controle.empresas.find_one({"id": principal.empresa_id})
        entitled = (company or {}).get("modulos")
        if entitled: public["modulos_ativos"] = [m for m in c.modulos_ativos if m in entitled]
    return ConfiguracaoPublica(**public, tem_logo=bool(c.logo_base64))


@router.get("/logo")
async def get_logo(
    empresa: str | None = Query(None, description="slug da empresa"),
    principal: Principal | None = Depends(principal_opcional),
):
    """Logotipo da empresa — público (e-mail e login carregam por URL https)."""
    if not empresa_atual_db():
        doc = None
        if empresa:
            doc = await controle.empresas.find_one({"slug": empresa, "ativo": True})
        elif await controle.empresas.count_documents({"ativo": True}) == 1:
            doc = await controle.empresas.find_one({"ativo": True})
        if doc:
            definir_empresa(doc["db_name"])
    c = await carregar()
    if c.logo_mime == "image/svg+xml": raise HTTPException(404, "Envie novamente o logotipo como PNG, JPG ou WEBP")
    if not c.logo_base64:
        raise HTTPException(status_code=404, detail="Logotipo não configurado")
    try:
        conteudo = base64.b64decode(c.logo_base64)
    except Exception:
        raise HTTPException(status_code=404, detail="Logotipo inválido")
    return Response(
        content=conteudo,
        media_type=c.logo_mime or "image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.put("/logo", response_model=Configuracao)
async def enviar_logo(input: LogoInput, principal: Principal = Depends(require("config:write"))):
    if input.mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=422, detail="Formato aceito: PNG, JPG ou WEBP")
    try:
        bruto = base64.b64decode(input.base64, validate=True)
    except Exception:
        raise HTTPException(status_code=422, detail="Conteúdo do arquivo inválido")
    from PIL import Image
    import io
    try:
        with Image.open(io.BytesIO(bruto)) as image:
            image.verify()
            expected = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(image.format)
            if expected != input.mime: raise ValueError("mime")
    except Exception:
        raise HTTPException(422, "Arquivo de imagem inválido")
    if len(bruto) > 512 * 1024:
        raise HTTPException(status_code=422, detail="O logotipo deve ter no máximo 512 KB")

    await carregar()
    await db.configuracoes.update_one(
        {"id": CONFIG_ID},
        {"$set": {"logo_base64": input.base64, "logo_mime": input.mime,
                  "atualizado_em": now_utc(), "atualizado_por": principal.nome}},
    )
    await _registrar(principal.nome, [("logotipo", "—", f"{input.mime} ({len(bruto) // 1024} KB)")])
    return await carregar()


@router.delete("/logo", response_model=Configuracao)
async def remover_logo(principal: Principal = Depends(require("config:write"))):
    await db.configuracoes.update_one(
        {"id": CONFIG_ID}, {"$set": {"logo_base64": None, "logo_mime": None}}
    )
    await _registrar(principal.nome, [("logotipo", "definido", "removido")])
    return await carregar()


@router.get("/historico", response_model=List[ConfigLog])
async def historico(response: Response, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000), principal: Principal = Depends(require("config:read"))):
    docs = await page(db.config_logs.find().sort("em", -1), response, offset, limit)
    return [ConfigLog(**{**d, **({"de": "[protegido]", "para": "[protegido]"} if "token" in d.get("campo", "").lower() else {}), "em": utc_aware(d.get("em"))}) for d in docs]


async def _registrar(usuario: str, mudancas: list[tuple[str, str | None, str | None]]) -> None:
    if not mudancas:
        return
    await db.config_logs.insert_many(
        [ConfigLog(campo=c, de="[protegido]" if c == "WhatsApp — token" else de, para="[protegido]" if c == "WhatsApp — token" else para, usuario=usuario).model_dump() for c, de, para in mudancas]
    )


ROTULOS_CAMPO = {
    "nome_software": "Nome do software",
    "slogan": "Slogan",
    "modulos_ativos": "Módulos ativos",
    "titulos_modulos": "Títulos dos módulos",
    "cor_painel": "Cor de fundo dos painéis",
    "cor_fonte": "Cor das fontes",
    "cor_primaria": "Cor de destaque",
    "imagem_fundo_login": "Imagem de fundo do login",
    "email_remetente_nome": "Nome do remetente",
    "email_resposta": "E-mail de resposta",
    "whatsapp_numero": "WhatsApp — número",
    "whatsapp_phone_id": "WhatsApp — Phone ID",
    "whatsapp_token": "WhatsApp — token",
    "site_url": "URL do site",
    "site_webhook_ativo": "Webhook do site",
}


def _texto(valor) -> str | None:
    if valor is None:
        return None
    if isinstance(valor, list):
        return ", ".join(sorted(str(v) for v in valor))
    if isinstance(valor, dict):
        return ", ".join(f"{k}={v}" for k, v in sorted(valor.items()))
    return str(valor)


@router.get("", response_model=Configuracao)
async def get_config(principal: Principal = Depends(require("config:read"))):
    return await carregar()


@router.put("", response_model=Configuracao)
async def update_config(input: ConfiguracaoUpdate, principal: Principal = Depends(require("config:write"))):
    atual = await carregar()
    data = input.model_dump(exclude_unset=True)

    if "modulos_ativos" in data and data["modulos_ativos"] is not None:
        invalidos = [m for m in data["modulos_ativos"] if m not in MODULOS]
        if invalidos:
            raise HTTPException(status_code=422, detail=f"Módulos inexistentes: {', '.join(invalidos)}")
        # Dashboard e Consultores não podem ser desligados: sem eles o sistema fica inacessível.
        data["modulos_ativos"] = sorted(set(data["modulos_ativos"]) | {"dashboard", "usuarios"})

    if "titulos_modulos" in data and data["titulos_modulos"] is not None:
        data["titulos_modulos"] = {
            k: v.strip() for k, v in data["titulos_modulos"].items() if k in MODULOS and v.strip()
        }
        data["titulos_modulos"] = {**atual.titulos_modulos, **data["titulos_modulos"]}

    data["atualizado_em"] = now_utc()
    data["atualizado_por"] = principal.nome
    mudancas = [
        (ROTULOS_CAMPO.get(k, k), _texto(getattr(atual, k, None)), _texto(v))
        for k, v in data.items()
        if k in ROTULOS_CAMPO and _texto(getattr(atual, k, None)) != _texto(v)
    ]
    await db.configuracoes.update_one({"id": CONFIG_ID}, {"$set": data}, upsert=True)
    await _registrar(principal.nome, mudancas)
    return await carregar()


@router.post("/api-key", response_model=Configuracao)
async def regerar_api_key(principal: Principal = Depends(require("config:write"))):
    """Gera uma nova chave de API do site — a anterior deixa de funcionar imediatamente."""
    await carregar()
    nova = f"ik_{secrets.token_hex(16)}"
    await db.configuracoes.update_one(
        {"id": CONFIG_ID},
        {"$set": {"site_api_key": nova, "atualizado_em": now_utc(), "atualizado_por": principal.nome}},
    )
    if principal.empresa_id:
        # Espelha no registro de controle: é por ela que o webhook descobre a empresa.
        await controle.empresas.update_one({"id": principal.empresa_id}, {"$set": {"site_api_key": nova}})
    return await carregar()


@site_router.post("/leads", status_code=201)
async def receber_lead_do_site(input: LeadDoSite, x_api_key: str | None = Header(None), idempotency_key: str | None = Header(None, max_length=128)):
    """Webhook do site: cria um lead no funil da EMPRESA dona da chave de API."""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Chave de API inválida")

    # A chave identifica a empresa (registro de controle) → define o banco do request.
    empresa = await controle.empresas.find_one({"site_api_key": x_api_key, "ativo": True})
    if not empresa:
        raise HTTPException(status_code=401, detail="Chave de API inválida")
    definir_empresa(empresa["db_name"])

    config = await carregar()
    if not config.site_webhook_ativo:
        raise HTTPException(status_code=403, detail="Integração com o site está desativada")
    if not config.site_api_key or not hmac.compare_digest(x_api_key, config.site_api_key):
        raise HTTPException(status_code=401, detail="Chave de API inválida")

    imovel_id = None
    if input.codigo_imovel:
        imovel = await db.imoveis.find_one({"codigo": input.codigo_imovel.upper().strip()})
        imovel_id = imovel["id"] if imovel else None

    from uuid import uuid5, NAMESPACE_URL
    normalized = input.model_dump()
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()
    # Explicit key is permanent; legacy senders deduplicate the same payload for one day.
    key = idempotency_key or f"{now_utc().date()}:{digest}"
    event_id = hashlib.sha256(key.encode()).hexdigest()
    person_key = (input.email or "").strip().lower() or event_id
    pid = str(uuid5(NAMESPACE_URL, "site-person:" + person_key))
    lid = str(uuid5(NAMESPACE_URL, "site-lead:" + event_id))
    await db.site_events.update_one({"_id": event_id}, {"$setOnInsert": {"digest": digest, "created_at": now_utc(), "lead_id": lid}}, upsert=True)
    event = await db.site_events.find_one({"_id": event_id})
    if event["digest"] != digest: raise HTTPException(409, "Chave de integração reutilizada com dados diferentes")
    email = (input.email or "").strip().lower() or None
    existing_person = await db.pessoas.find_one({"email": email}) if email else None
    person = Pessoa(id=pid, nome=input.nome.strip(), papeis=["cliente"], email=email, telefone=input.telefone)
    if existing_person: pid = existing_person["id"]
    else: await db.pessoas.update_one({"_id": "site:" + pid}, {"$setOnInsert": person.model_dump()}, upsert=True)
    # Pipedrive: o contato do site entra na CAIXA DE ENTRADA; vira negócio ao ser qualificado.
    from models.crm import Entrada
    from lib.crm import carregar_crm_config

    corretor_id = None
    if (await carregar_crm_config()).distribuicao == "rodizio":
        from routers.crm import _proximo_rodizio
        corretor_id = await _proximo_rodizio()
    entrada = Entrada(id=lid, nome=input.nome.strip(), telefone=input.telefone, email=email, origem=input.origem or "Site",
                      mensagem=input.mensagem, imovel_id=imovel_id, cliente_id=pid, corretor_id=corretor_id)
    r = await db.entradas.update_one({"_id": "site:" + lid}, {"$setOnInsert": entrada.model_dump()}, upsert=True)
    if r.upserted_id is not None:
        from lib import automacoes
        await automacoes.lead_novo(entrada.model_dump())
    return {"lead_id": lid, "imovel_vinculado": imovel_id is not None, "triagem": corretor_id is None}
