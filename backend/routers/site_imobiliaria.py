"""Site da imobiliária: vitrine pública com os imóveis, a marca e o WhatsApp de cada empresa.

- Configuração, logo e imagem de capa ficam no banco da empresa (`site_imobiliaria`, `site_midia`).
- O endereço público é `/s/{slug}`. O índice `controle.sites_index` diz em qual empresa o slug está,
  então a página abre sem login e nunca mistura empresas.
- Só o gestor ou quem ele liberou (`usuarios.gerencia_site`) cria o site e decide quais imóveis
  aparecem (ativo, reservado ou inativo). Os demais veem a tela em modo leitura.
- Formulário do site vira lead na caixa de entrada (origem "Site"). Visualizações e cliques no
  WhatsApp são contados por imóvel para o gestor ver o que gera interesse.
"""

import base64
import re
import time
from datetime import datetime
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from lib.auth import Principal, require
from lib.db import controle, db, definir_empresa, empresa_atual_db
from lib.planos import exigir_recurso, recurso_liberado
from models.common import now_utc

router = APIRouter(prefix="/site-imobiliaria", tags=["site"])
publico_router = APIRouter(prefix="/publico/site", tags=["publico"])

DOC_ID = "singleton"
COR_PADRAO = "#4a03a2"
DESTAQUE_PADRAO = "#ff7a00"
MSG_PADRAO = "Olá! Vi o imóvel {codigo} ({titulo}) no site e quero mais informações."
RESERVADOS = {"admin", "api", "app", "login", "site", "www", "sax", "suporte", "s", "novo", "teste-sax"}
LIMITE_MIDIA = 900 * 1024  # bytes da imagem; o documento do Firestore tem 1 MiB
_SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
_COR = re.compile(r"^#[0-9a-fA-F]{6}$")


# --------------------------------------------------------------------------- modelos


class SiteConfig(BaseModel):
    ativo: bool = False
    slug: str | None = None
    nome: str = ""
    titulo: str = "Encontre o imóvel certo para você"
    subtitulo: str = "Casas, apartamentos e terrenos selecionados pela nossa equipe."
    sobre: str = ""
    cor_primaria: str = COR_PADRAO
    cor_destaque: str = DESTAQUE_PADRAO
    fonte: Literal["moderna", "elegante", "classica"] = "moderna"
    whatsapp: str = ""
    mensagem_whatsapp: str = MSG_PADRAO
    telefone: str = ""
    email: str = ""
    endereco: str = ""
    creci: str = ""
    horario: str = ""
    instagram: str = ""
    facebook: str = ""
    tem_logo: bool = False
    tem_capa: bool = False
    midia_v: int = 0
    atualizado_em: datetime | None = None
    atualizado_por: str | None = None


class SiteConfigInput(BaseModel):
    ativo: bool = False
    slug: str = Field(min_length=3, max_length=40)
    nome: str = Field(min_length=2, max_length=80)
    titulo: str = Field(default=SiteConfig.model_fields["titulo"].default, max_length=90)
    subtitulo: str = Field(default=SiteConfig.model_fields["subtitulo"].default, max_length=200)
    sobre: str = Field(default="", max_length=1500)
    cor_primaria: str = COR_PADRAO
    cor_destaque: str = DESTAQUE_PADRAO
    fonte: Literal["moderna", "elegante", "classica"] = "moderna"
    whatsapp: str = Field(default="", max_length=30)
    mensagem_whatsapp: str = Field(default=MSG_PADRAO, max_length=300)
    telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    endereco: str = Field(default="", max_length=200)
    creci: str = Field(default="", max_length=30)
    horario: str = Field(default="", max_length=120)
    instagram: str = Field(default="", max_length=120)
    facebook: str = Field(default="", max_length=120)


class MidiaInput(BaseModel):
    base64: str = Field(min_length=16, max_length=1_300_000)
    mime: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class ImovelNoSite(BaseModel):
    id: str
    codigo: str
    titulo: str
    tipo: str
    finalidade: str
    status: str
    bairro: str | None = None
    cidade: str = ""
    valor_venda: float | None = None
    valor_aluguel: float | None = None
    foto_url: str | None = None
    site_status: str = "inativo"
    site_destaque: bool = False
    visualizacoes: int = 0
    cliques_whatsapp: int = 0
    contatos: int = 0


class PainelSite(BaseModel):
    liberado: bool
    pode_editar: bool
    configurado: bool
    config: SiteConfig
    url: str | None = None
    sugestao_slug: str = ""
    visualizacoes: int = 0
    cliques_whatsapp: int = 0
    contatos: int = 0


class AlterarImoveis(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=500)
    site_status: Literal["inativo", "ativo", "reservado"] | None = None
    site_destaque: bool | None = None


class ContatoSite(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=8, max_length=30)
    email: str | None = Field(default=None, max_length=120)
    mensagem: str | None = Field(default=None, max_length=1500)
    imovel_id: str | None = Field(default=None, max_length=64)
    site: str | None = None  # isca para robôs: pessoas não veem este campo


class EventoSite(BaseModel):
    tipo: Literal["visualizacao", "whatsapp"]
    imovel_id: str | None = Field(default=None, max_length=64)


# --------------------------------------------------------------------------- utilidades


def slugificar(texto: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:40].strip("-") or "imobiliaria"


def so_digitos(v: str | None) -> str:
    return re.sub(r"\D", "", v or "")


async def _empresa_nome() -> str:
    nome = empresa_atual_db()
    empresa = await controle.empresas.find_one({"db_name": nome}, {"nome": 1}) if nome else None
    return (empresa or {}).get("nome") or "Imobiliária"


async def carregar_config() -> tuple[SiteConfig, bool]:
    """Configuração salva ou, se ainda não existe, sugestão a partir dos dados da empresa."""
    doc = await db.site_imobiliaria.find_one({"id": DOC_ID})
    if doc:
        return SiteConfig(**{k: v for k, v in doc.items() if k in SiteConfig.model_fields}), True
    geral = await db.configuracoes.find_one({"id": "singleton"}, {"cor_primaria": 1, "whatsapp_numero": 1, "logo_base64": 1}) or {}
    from routers.assinaturas import _cor

    return SiteConfig(nome=await _empresa_nome(), cor_primaria=_cor(geral), whatsapp=geral.get("whatsapp_numero") or "",
                      tem_logo=bool(geral.get("logo_base64"))), False


def _url(slug: str | None) -> str | None:
    import os

    return f"{os.environ.get('APP_URL', '').rstrip('/')}/s/{slug}" if slug else None


async def _metricas() -> dict[str, dict]:
    return {d["id"]: d async for d in db.site_metricas.find({})}


# Cache curto da página pública por slug: cada leitura no Firestore é cobrada.
_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_SEGUNDOS = 60


def limpar_cache() -> None:
    _CACHE.clear()


def _exigir_editor(principal: Principal) -> None:
    if not principal.pode_site:
        raise HTTPException(403, "Só o gestor ou quem ele liberou pode alterar o site")


# --------------------------------------------------------------------------- gestão (CRM)


@router.get("", response_model=PainelSite)
async def painel(principal: Principal = Depends(require("imovel:read"))):
    config, configurado = await carregar_config()
    met = await _metricas()
    return PainelSite(
        liberado=await recurso_liberado("site"), pode_editar=principal.pode_site, configurado=configurado, config=config,
        url=_url(config.slug) if configurado else None, sugestao_slug=config.slug or slugificar(config.nome),
        visualizacoes=sum(m.get("visualizacoes", 0) for m in met.values()),
        cliques_whatsapp=sum(m.get("whatsapp", 0) for m in met.values()),
        contatos=sum(m.get("contatos", 0) for m in met.values()),
    )


@router.put("", response_model=PainelSite)
async def salvar(input: SiteConfigInput, principal: Principal = Depends(require("imovel:read"))):
    _exigir_editor(principal)
    await exigir_recurso("site")
    slug = input.slug.strip().lower()
    if not _SLUG.match(slug) or "--" in slug or slug in RESERVADOS:
        raise HTTPException(422, "Endereço inválido: use de 3 a 40 letras minúsculas, números e hífen, sem acento.")
    for campo in ("cor_primaria", "cor_destaque"):
        if not _COR.match(getattr(input, campo)):
            raise HTTPException(422, "Cor inválida: use o formato #RRGGBB.")
    if input.ativo and len(so_digitos(input.whatsapp)) < 10:
        raise HTTPException(422, "Informe o WhatsApp com DDD para publicar o site.")
    base = empresa_atual_db()
    dono = await controle.sites_index.find_one({"_id": slug})
    if dono and dono.get("db_name") != base:
        raise HTTPException(409, "Este endereço já está em uso por outra imobiliária. Escolha outro.")
    atual, _ = await carregar_config()
    if not dono:
        await controle.sites_index.delete_many({"db_name": base})
        await controle.sites_index.insert_one({"_id": slug, "db_name": base, "em": now_utc()})
    dados = input.model_dump()
    dados.update(slug=slug, whatsapp=so_digitos(input.whatsapp), id=DOC_ID, tem_logo=atual.tem_logo, tem_capa=atual.tem_capa,
                 midia_v=atual.midia_v, atualizado_em=now_utc(), atualizado_por=principal.nome)
    for campo in ("instagram", "facebook"):
        dados[campo] = dados[campo].strip().lstrip("@")
    await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": dados}, upsert=True)
    limpar_cache()
    return await painel(principal)


@router.put("/midia/{tipo}", response_model=PainelSite)
async def enviar_midia(tipo: Literal["logo", "capa"], input: MidiaInput, principal: Principal = Depends(require("imovel:read"))):
    _exigir_editor(principal)
    await exigir_recurso("site")
    try:
        bruto = base64.b64decode(input.base64, validate=True)
    except Exception:
        raise HTTPException(422, "Imagem inválida")
    if len(bruto) > LIMITE_MIDIA:
        raise HTTPException(422, "A imagem deve ter no máximo 900 KB. Reduza o tamanho e envie de novo.")
    from routers.fotos_imovel import _mime

    if _mime(bruto) is None:
        raise HTTPException(422, "Envie a imagem em JPG, PNG ou WEBP.")
    await db.site_midia.update_one({"id": tipo}, {"$set": {"id": tipo, "base64": input.base64, "mime": _mime(bruto)}}, upsert=True)
    config, configurado = await carregar_config()
    if not configurado:
        await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": {**config.model_dump(), "id": DOC_ID}}, upsert=True)
    await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": {f"tem_{tipo}": True}, "$inc": {"midia_v": 1}})
    limpar_cache()
    return await painel(principal)


@router.delete("/midia/{tipo}", response_model=PainelSite)
async def remover_midia(tipo: Literal["logo", "capa"], principal: Principal = Depends(require("imovel:read"))):
    _exigir_editor(principal)
    await db.site_midia.delete_one({"id": tipo})
    await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": {f"tem_{tipo}": False}, "$inc": {"midia_v": 1}})
    limpar_cache()
    return await painel(principal)


@router.get("/imoveis", response_model=List[ImovelNoSite])
async def imoveis(principal: Principal = Depends(require("imovel:read"))):
    met = await _metricas()
    campos = {k: 1 for k in ImovelNoSite.model_fields if k not in ("visualizacoes", "cliques_whatsapp", "contatos")}
    saida = []
    async for d in db.imoveis.find({}, campos).sort("created_at", -1):
        m = met.get(d["id"], {})
        saida.append(ImovelNoSite(**{k: v for k, v in d.items() if k in ImovelNoSite.model_fields},
                                  visualizacoes=m.get("visualizacoes", 0), cliques_whatsapp=m.get("whatsapp", 0), contatos=m.get("contatos", 0)))
    return saida


@router.put("/imoveis", status_code=204)
async def alterar_imoveis(input: AlterarImoveis, principal: Principal = Depends(require("imovel:update"))):
    _exigir_editor(principal)
    dados: dict = {}
    if input.site_status is not None:
        dados["site_status"] = input.site_status
    if input.site_destaque is not None:
        dados["site_destaque"] = input.site_destaque
    if not dados:
        raise HTTPException(422, "Nada para alterar")
    if dados.get("site_status") in ("ativo", "reservado"):
        await exigir_recurso("site")
    dados["updated_at"] = now_utc()
    await db.imoveis.update_many({"id": {"$in": input.ids}}, {"$set": dados})
    limpar_cache()
    return Response(status_code=204)


# --------------------------------------------------------------------------- página pública


async def _entrar(slug: str) -> None:
    slug = (slug or "").lower()
    if not _SLUG.match(slug):
        raise HTTPException(404, "Site não encontrado")
    indice = await controle.sites_index.find_one({"_id": slug})
    if not indice:
        raise HTTPException(404, "Site não encontrado")
    empresa = await controle.empresas.find_one({"db_name": indice.get("db_name")}, {"ativo": 1})
    if indice.get("db_name") and (not empresa or not empresa.get("ativo", True)):
        raise HTTPException(404, "Site não encontrado")
    definir_empresa(indice.get("db_name"))


async def _site_ativo(slug: str) -> SiteConfig:
    await _entrar(slug)
    config, configurado = await carregar_config()
    if not configurado or not config.ativo or not await recurso_liberado("site"):
        raise HTTPException(404, "Site fora do ar")
    return config


_CAMPOS_CARD = ("id", "codigo", "titulo", "tipo", "finalidade", "bairro", "cidade", "estado", "quartos", "suites", "banheiros",
                "vagas", "area_util", "area_total", "valor_venda", "valor_aluguel", "condominio", "iptu", "foto_url",
                "site_status", "site_destaque", "created_at")
_FILTRO_SITE = {"site_status": {"$in": ["ativo", "reservado"]}, "status": {"$nin": ["vendido", "alugado"]}}


def _card(d: dict) -> dict:
    out = {k: d.get(k) for k in _CAMPOS_CARD if k not in ("site_status", "site_destaque", "created_at")}
    out["reservado"] = d.get("site_status") == "reservado"
    out["destaque"] = bool(d.get("site_destaque"))
    return out


def _marca(config: SiteConfig, slug: str) -> dict:
    v = config.midia_v
    m = config.model_dump(exclude={"ativo", "atualizado_em", "atualizado_por"})
    m["logo_url"] = f"/api/publico/site/{slug}/midia/logo?v={v}" if config.tem_logo else None
    m["capa_url"] = f"/api/publico/site/{slug}/midia/capa?v={v}" if config.tem_capa else None
    return m


@publico_router.get("/{slug}")
async def pagina(slug: str):
    slug = slug.lower()
    cache = _CACHE.get(slug)
    if cache and time.monotonic() - cache[0] < CACHE_SEGUNDOS:
        return cache[1]
    config = await _site_ativo(slug)
    docs = await db.imoveis.find(_FILTRO_SITE, {k: 1 for k in _CAMPOS_CARD}).sort("created_at", -1).to_list(1000)
    docs.sort(key=lambda d: (not d.get("site_destaque"), d.get("site_status") == "reservado"))
    dados = {"marca": _marca(config, slug), "imoveis": [_card(d) for d in docs]}
    _CACHE[slug] = (time.monotonic(), dados)
    return dados


@publico_router.get("/{slug}/imovel/{codigo}")
async def imovel_publico(slug: str, codigo: str):
    config = await _site_ativo(slug)
    d = await db.imoveis.find_one({**_FILTRO_SITE, "$or": [{"codigo": codigo.upper()}, {"id": codigo}]})
    if not d:
        raise HTTPException(404, "Imóvel indisponível")
    from routers.fotos_imovel import listar, url_publica

    fotos = [url_publica(f["id"]) for f in await listar(d["id"])]
    if not fotos and d.get("foto_url"):
        fotos = [d["foto_url"]]
    return {"marca": _marca(config, slug.lower()), "imovel": {**_card(d), "descricao": d.get("descricao"), "fotos": fotos}}


@publico_router.get("/{slug}/midia/{tipo}")
async def midia(slug: str, tipo: Literal["logo", "capa"]):
    await _entrar(slug)
    doc = await db.site_midia.find_one({"id": tipo})
    if not doc and tipo == "logo":
        from routers.match import logo_empresa

        return await logo_empresa()
    if not doc:
        raise HTTPException(404, "Sem imagem")
    return Response(base64.b64decode(doc["base64"]), media_type=doc.get("mime", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"})


# Limites simples por instância: contatos por IP e eventos repetidos não viram escrita no banco.
_CONTATOS: dict[str, list[float]] = {}
_EVENTOS: dict[str, float] = {}


def _ip(request: Request) -> str:
    encaminhado = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    return encaminhado or (request.client.host if request.client else "?")


@publico_router.post("/{slug}/contato", status_code=201)
async def contato(slug: str, input: ContatoSite, request: Request):
    config = await _site_ativo(slug)
    if input.site:  # robô preencheu o campo escondido: responde ok e não grava
        return {"ok": True}
    agora = time.monotonic()
    chave = f"{slug}:{_ip(request)}"
    recentes = [t for t in _CONTATOS.get(chave, []) if agora - t < 600]
    if len(recentes) >= 5:
        raise HTTPException(429, "Muitas mensagens seguidas. Tente de novo em alguns minutos ou chame no WhatsApp.")
    _CONTATOS[chave] = [*recentes, agora]
    imovel = await db.imoveis.find_one({**_FILTRO_SITE, "id": input.imovel_id}, {"id": 1, "codigo": 1, "titulo": 1, "finalidade": 1,
                                                                                    "valor_venda": 1, "valor_aluguel": 1}) if input.imovel_id else None
    from lib.automacoes import lead_novo
    from lib.crm import carregar_crm_config
    from models.crm import Entrada
    from routers.crm import _proximo_rodizio

    corretor_id = await _proximo_rodizio() if (await carregar_crm_config()).distribuicao == "rodizio" else None
    partes = [(input.mensagem or "").strip()]
    if imovel:
        partes.append(f"Interesse no imóvel {imovel.get('codigo')}: {imovel.get('titulo')}")
    fin = (imovel or {}).get("finalidade")
    entrada = Entrada(
        nome=input.nome.strip(), telefone=input.telefone.strip(), email=(input.email or "").strip().lower() or None,
        origem="Site", interesse="locacao" if fin == "locacao" else "compra",
        mensagem="\n".join(p for p in partes if p)[:2000] or None, imovel_id=(imovel or {}).get("id"), corretor_id=corretor_id,
        valor_estimado=((imovel or {}).get("valor_aluguel") if fin == "locacao" else (imovel or {}).get("valor_venda")),
    )
    await db.entradas.insert_one(entrada.model_dump())
    await lead_novo(entrada.model_dump())
    await db.site_metricas.update_one({"id": (imovel or {}).get("id") or "_site"}, {"$inc": {"contatos": 1}}, upsert=True)
    return {"ok": True, "whatsapp": config.whatsapp}


@publico_router.post("/{slug}/evento", status_code=204)
async def evento(slug: str, input: EventoSite, request: Request):
    await _entrar(slug)
    agora = time.monotonic()
    chave = f"{slug}:{_ip(request)}:{input.tipo}:{input.imovel_id}"
    if chave in _EVENTOS and agora - _EVENTOS[chave] < 1800:
        return Response(status_code=204)
    if len(_EVENTOS) > 50_000:
        _EVENTOS.clear()
    _EVENTOS[chave] = agora
    if input.imovel_id and not await db.imoveis.find_one({**_FILTRO_SITE, "id": input.imovel_id}, {"id": 1}):
        return Response(status_code=204)
    campo = "visualizacoes" if input.tipo == "visualizacao" else "whatsapp"
    await db.site_metricas.update_one({"id": input.imovel_id or "_site"}, {"$inc": {campo: 1}}, upsert=True)
    return Response(status_code=204)
