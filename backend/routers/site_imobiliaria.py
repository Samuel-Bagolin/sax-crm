"""Site de cada empresa: vitrine pública com a marca, o WhatsApp, o estoque (imóveis ou veículos) e o
catálogo de serviços, tratamentos e produtos (todos os segmentos).

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

from lib.auth import Principal, require, require_module
from lib.db import controle, db, definir_empresa, empresa_atual_db
from lib.planos import exigir_recurso, recurso_liberado
from models.common import now_utc

router = APIRouter(prefix="/site-imobiliaria", tags=["site"])
publico_router = APIRouter(prefix="/publico/site", tags=["publico"])

DOC_ID = "singleton"
COR_PADRAO = "#4a03a2"
DESTAQUE_PADRAO = "#ff7a00"
MSG_PADRAO = "Olá! Vi o imóvel {codigo} ({titulo}) no site e quero mais informações."
RESERVADOS = {"admin", "api", "app", "login", "site", "www", "sax", "suporte", "s", "novo", "teste-sax", "dominio"}
LIMITE_MIDIA = 900 * 1024  # bytes da imagem; o documento do Firestore tem 1 MiB
_SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
_COR = re.compile(r"^#[0-9a-fA-F]{6}$")
TITULO_IMOB = "Encontre o imóvel certo para você"
SUBTITULO_IMOB = "Casas, apartamentos e terrenos selecionados pela nossa equipe."
VENDAS = ("imobiliaria", "veiculos")
COM_FORMULARIO = ("imobiliaria", "veiculos", "odontologia", "estetica", "comercio")  # segmentos com caixa de leads
LIMITE_ITENS = 300
LIMITE_FOTO_ITEM = 600 * 1024

# Textos de partida do site em cada segmento (o gestor muda tudo na tela).
TEXTOS_SEGMENTO = {
    "imobiliaria": {"titulo": TITULO_IMOB, "subtitulo": SUBTITULO_IMOB, "catalogo": "Serviços",
                    "msg": "Olá! Vi o imóvel {codigo} ({titulo}) no site e quero mais informações.", "tipo": "servico"},
    "veiculos": {"titulo": "Encontre o seu próximo carro", "subtitulo": "Seminovos revisados, com procedência e as melhores condições.",
                 "catalogo": "Serviços da loja", "msg": "Olá! Vi o veículo {codigo} ({titulo}) no site e quero mais informações.", "tipo": "servico"},
    "odontologia": {"titulo": "Cuide do seu sorriso com quem entende", "subtitulo": "Tratamentos para toda a família, do check-up à reabilitação.",
                    "catalogo": "Tratamentos", "msg": "Olá! Vi no site o tratamento {titulo} e quero agendar uma avaliação.", "tipo": "tratamento"},
    "estetica": {"titulo": "Realce a sua beleza natural", "subtitulo": "Procedimentos faciais e corporais com avaliação personalizada.",
                 "catalogo": "Procedimentos e produtos", "msg": "Olá! Vi no site {titulo} e quero saber mais.", "tipo": "tratamento"},
    "barbearia": {"titulo": "Seu estilo, do jeito certo", "subtitulo": "Corte, barba e cuidado com hora marcada.",
                  "catalogo": "Serviços", "msg": "Olá! Vi no site o serviço {titulo} e quero marcar um horário.", "tipo": "servico"},
    "terapia": {"titulo": "Um espaço para cuidar de você", "subtitulo": "Atendimento acolhedor, presencial e online.",
                "catalogo": "Atendimentos", "msg": "Olá! Vi no site {titulo} e quero agendar.", "tipo": "servico"},
    "comercio": {"titulo": "Feito com carinho, todos os dias", "subtitulo": "Peça pelo WhatsApp, retire na loja ou encomende para o seu evento.",
                 "catalogo": "Cardápio", "msg": "Olá! Vi no cardápio {titulo} e quero fazer um pedido.", "tipo": "produto"},
}


def textos(segmento: str | None) -> dict:
    return TEXTOS_SEGMENTO.get(segmento or "imobiliaria", TEXTOS_SEGMENTO["imobiliaria"])


# --------------------------------------------------------------------------- modelos


class SiteConfig(BaseModel):
    ativo: bool = False
    slug: str | None = None
    nome: str = ""
    titulo: str = TITULO_IMOB
    subtitulo: str = SUBTITULO_IMOB
    sobre: str = ""
    cor_primaria: str = COR_PADRAO
    cor_destaque: str = DESTAQUE_PADRAO
    cor_cabecalho: str = "#ffffff"  # barra do topo, onde fica o nome da empresa
    cor_texto_cabecalho: str = "#111827"
    cor_fundo: str = "#f8fafc"
    fonte: Literal["moderna", "elegante", "classica"] = "moderna"
    titulo_catalogo: str = ""  # vazio = nome padrão do segmento (Serviços, Tratamentos...)
    layout_catalogo: Literal["grade", "lista"] = "grade"
    mostrar_precos: bool = True
    mostrar_agendamento: bool = True
    mostrar_sobre: bool = True
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
    dominio: str | None = None  # domínio próprio sem www (lib/dominios.py)
    atualizado_em: datetime | None = None
    atualizado_por: str | None = None


class SiteConfigInput(BaseModel):
    ativo: bool = False
    slug: str = Field(min_length=3, max_length=40)
    nome: str = Field(min_length=2, max_length=80)
    titulo: str = Field(default=TITULO_IMOB, max_length=90)
    subtitulo: str = Field(default=SUBTITULO_IMOB, max_length=200)
    sobre: str = Field(default="", max_length=1500)
    cor_primaria: str = COR_PADRAO
    cor_destaque: str = DESTAQUE_PADRAO
    cor_cabecalho: str = "#ffffff"
    cor_texto_cabecalho: str = "#111827"
    cor_fundo: str = "#f8fafc"
    fonte: Literal["moderna", "elegante", "classica"] = "moderna"
    titulo_catalogo: str = Field(default="", max_length=60)
    layout_catalogo: Literal["grade", "lista"] = "grade"
    mostrar_precos: bool = True
    mostrar_agendamento: bool = True
    mostrar_sobre: bool = True
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
    segmento: str = "imobiliaria"
    titulo_catalogo_padrao: str = "Serviços"
    tipo_padrao: str = "servico"
    tem_estoque: bool = True  # imobiliária e loja de veículos mostram o estoque além do catálogo
    agendar_url: str | None = None
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
    item_id: str | None = Field(default=None, max_length=64)
    site: str | None = None  # isca para robôs: pessoas não veem este campo


class EventoSite(BaseModel):
    tipo: Literal["visualizacao", "whatsapp"]
    imovel_id: str | None = Field(default=None, max_length=64)


TipoItem = Literal["servico", "tratamento", "produto"]


class ItemSiteIn(BaseModel):
    tipo: TipoItem = "servico"
    nome: str = Field(min_length=2, max_length=80)
    descricao: str = Field(default="", max_length=600)
    categoria: str = Field(default="", max_length=40)
    preco: float | None = Field(default=None, ge=0, le=10_000_000)
    preco_a_partir: bool = False
    duracao_min: int | None = Field(default=None, ge=5, le=1440)
    ativo: bool = True
    destaque: bool = False
    ordem: int = Field(default=50, ge=0, le=999)


class ItemSite(ItemSiteIn):
    id: str
    tem_foto: bool = False
    foto_v: int = 0
    servico_id: str | None = None  # veio de um serviço da agenda: o botão Agendar abre direto nele


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
    seg = await _segmento()
    t = textos(seg)
    doc = await db.site_imobiliaria.find_one({"id": DOC_ID})
    if doc:
        c = SiteConfig(**{k: v for k, v in doc.items() if k in SiteConfig.model_fields})
        if seg != "imobiliaria":  # site salvo antes dos textos por segmento: troca só o que ficou no padrão de imóveis
            if c.titulo == TITULO_IMOB:
                c.titulo = t["titulo"]
            if c.subtitulo == SUBTITULO_IMOB:
                c.subtitulo = t["subtitulo"]
            if c.mensagem_whatsapp == MSG_PADRAO:
                c.mensagem_whatsapp = t["msg"]
        return c, True
    geral = await db.configuracoes.find_one({"id": "singleton"}, {"cor_primaria": 1, "whatsapp_numero": 1, "logo_base64": 1}) or {}
    from routers.assinaturas import _cor

    return SiteConfig(nome=await _empresa_nome(), cor_primaria=_cor(geral), whatsapp=geral.get("whatsapp_numero") or "",
                      tem_logo=bool(geral.get("logo_base64")), titulo=t["titulo"], subtitulo=t["subtitulo"],
                      mensagem_whatsapp=t["msg"]), False


def _url(slug: str | None) -> str | None:
    import os

    return f"{os.environ.get('APP_URL', '').rstrip('/')}/s/{slug}" if slug else None


async def _metricas() -> dict[str, dict]:
    return {d["id"]: d async for d in db.site_metricas.find({})}


# Cache curto da página pública por slug: cada leitura no Firestore é cobrada.
_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_SEGUNDOS = 60


async def _segmento() -> str:
    nome = empresa_atual_db()
    e = await controle.empresas.find_one({"db_name": nome}, {"segmento": 1}) if nome else None
    return (e or {}).get("segmento") or "imobiliaria"


async def _eh_veiculos() -> bool:
    """O site mostra o estoque do segmento: imóveis (imobiliária) ou veículos (loja de veículos)."""
    return await _segmento() == "veiculos"


async def _agendar_url(config: "SiteConfig") -> str | None:
    """Link da agenda online, quando a empresa tem e está ligada."""
    if not config.mostrar_agendamento or not await recurso_liberado("agenda_online"):
        return None
    from lib.agenda_online import config as cfg_agenda

    cfg = await cfg_agenda()
    return f"/agendar/{cfg['slug']}" if cfg.get("ativo") and cfg.get("slug") else None


_CAMPOS_VEICULO = ("id", "codigo", "marca", "modelo", "versao", "ano_fabricacao", "ano_modelo", "km", "cor", "cambio", "combustivel",
                   "categoria", "portas", "opcionais", "preco_venda", "foto_url", "site_status", "site_destaque", "created_at",
                   "aceita_troca", "unico_dono", "ipva_pago", "garantia", "status", "unidade_id")


def _veiculo_card(d: dict) -> dict:
    from routers.veiculos import titulo

    out = {k: d.get(k) for k in _CAMPOS_VEICULO if k not in ("site_status", "site_destaque", "created_at", "status")}
    out.update(titulo=titulo(d), tipo=d.get("categoria"), finalidade="venda", valor_venda=d.get("preco_venda"),
               reservado=d.get("site_status") == "reservado" or d.get("status") == "reservado", destaque=bool(d.get("site_destaque")),
               cidade="", bairro=None)
    return out


def limpar_cache() -> None:
    _CACHE.clear()


async def _acesso_site(principal: Principal = Depends(require("unidade:read"))) -> Principal:
    """Quem usa o CRM pode ver o painel do site, desde que o módulo do estoque do segmento esteja ativo."""
    if principal.segmento in VENDAS:
        await require_module(principal, "veiculo:read" if principal.segmento == "veiculos" else "imovel:read")
    return principal


def _exigir_editor(principal: Principal) -> None:
    if not principal.pode_site:
        raise HTTPException(403, "Só o gestor ou quem ele liberou pode alterar o site")


# --------------------------------------------------------------------------- gestão (CRM)


@router.get("", response_model=PainelSite)
async def painel(principal: Principal = Depends(_acesso_site)):
    config, configurado = await carregar_config()
    met = await _metricas()
    seg = await _segmento()
    return PainelSite(
        segmento=seg, titulo_catalogo_padrao=textos(seg)["catalogo"], tipo_padrao=textos(seg)["tipo"], tem_estoque=seg in VENDAS,
        agendar_url=await _agendar_url(config),
        liberado=await recurso_liberado("site"), pode_editar=principal.pode_site, configurado=configurado, config=config,
        url=_url(config.slug) if configurado else None, sugestao_slug=config.slug or slugificar(config.nome),
        visualizacoes=sum(m.get("visualizacoes", 0) for m in met.values()),
        cliques_whatsapp=sum(m.get("whatsapp", 0) for m in met.values()),
        contatos=sum(m.get("contatos", 0) for m in met.values()),
    )


@router.put("", response_model=PainelSite)
async def salvar(input: SiteConfigInput, principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    await exigir_recurso("site")
    slug = input.slug.strip().lower()
    if not _SLUG.match(slug) or "--" in slug or slug in RESERVADOS:
        raise HTTPException(422, "Endereço inválido: use de 3 a 40 letras minúsculas, números e hífen, sem acento.")
    for campo in ("cor_primaria", "cor_destaque", "cor_cabecalho", "cor_texto_cabecalho", "cor_fundo"):
        if not _COR.match(getattr(input, campo)):
            raise HTTPException(422, "Cor inválida: use o formato #RRGGBB.")
    if input.ativo and len(so_digitos(input.whatsapp)) < 10:
        raise HTTPException(422, "Informe o WhatsApp com DDD para publicar o site.")
    base = empresa_atual_db()
    dono = await controle.sites_index.find_one({"_id": slug})
    if dono and dono.get("db_name") != base:
        raise HTTPException(409, "Este endereço já está em uso por outra empresa. Escolha outro.")
    atual, _ = await carregar_config()
    if not dono:
        await controle.sites_index.delete_many({"db_name": base})
        await controle.sites_index.insert_one({"_id": slug, "db_name": base, "em": now_utc()})
    dados = input.model_dump()
    dados.update(slug=slug, whatsapp=so_digitos(input.whatsapp), id=DOC_ID, tem_logo=atual.tem_logo, tem_capa=atual.tem_capa,
                 midia_v=atual.midia_v, dominio=atual.dominio, atualizado_em=now_utc(), atualizado_por=principal.nome)
    for campo in ("instagram", "facebook"):
        dados[campo] = dados[campo].strip().lstrip("@")
    await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": dados}, upsert=True)
    limpar_cache()
    return await painel(principal)


@router.put("/midia/{tipo}", response_model=PainelSite)
async def enviar_midia(tipo: Literal["logo", "capa"], input: MidiaInput, principal: Principal = Depends(_acesso_site)):
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


@router.get("/midia/{tipo}")
async def ver_midia(tipo: Literal["logo", "capa"], principal: Principal = Depends(_acesso_site)):
    """Prévia no painel: funciona antes de escolher o endereço do site (a rota pública precisa do slug)."""
    doc = await db.site_midia.find_one({"id": tipo})
    if not doc:
        raise HTTPException(404, "Sem imagem")
    return Response(base64.b64decode(doc["base64"]), media_type=doc.get("mime", "image/jpeg"), headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/midia/{tipo}", response_model=PainelSite)
async def remover_midia(tipo: Literal["logo", "capa"], principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    await db.site_midia.delete_one({"id": tipo})
    await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": {f"tem_{tipo}": False}, "$inc": {"midia_v": 1}})
    limpar_cache()
    return await painel(principal)


@router.get("/imoveis", response_model=List[ImovelNoSite])
async def imoveis(principal: Principal = Depends(_acesso_site)):
    met = await _metricas()
    campos = {k: 1 for k in ImovelNoSite.model_fields if k not in ("visualizacoes", "cliques_whatsapp", "contatos")}
    saida = []
    if await _eh_veiculos():
        from routers.veiculos import titulo

        async for d in db.veiculos.find({}).sort("created_at", -1):
            m = met.get(d["id"], {})
            saida.append(ImovelNoSite(id=d["id"], codigo=d.get("codigo", ""), titulo=titulo(d), tipo=d.get("categoria") or "outro",
                                      finalidade="venda", status=d.get("status") or "disponivel", cidade="", valor_venda=d.get("preco_venda"),
                                      foto_url=d.get("foto_url"), site_status=d.get("site_status") or "inativo", site_destaque=bool(d.get("site_destaque")),
                                      visualizacoes=m.get("visualizacoes", 0), cliques_whatsapp=m.get("whatsapp", 0), contatos=m.get("contatos", 0)))
        return saida
    async for d in db.imoveis.find({}, campos).sort("created_at", -1):
        m = met.get(d["id"], {})
        saida.append(ImovelNoSite(**{k: v for k, v in d.items() if k in ImovelNoSite.model_fields},
                                  visualizacoes=m.get("visualizacoes", 0), cliques_whatsapp=m.get("whatsapp", 0), contatos=m.get("contatos", 0)))
    return saida


@router.put("/imoveis", status_code=204)
async def alterar_imoveis(input: AlterarImoveis, principal: Principal = Depends(_acesso_site)):
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
    await (db.veiculos if await _eh_veiculos() else db.imoveis).update_many({"id": {"$in": input.ids}}, {"$set": dados})
    limpar_cache()
    return Response(status_code=204)


# --------------------------------------------------------------------------- catálogo (serviços, tratamentos, produtos)


def _item(d: dict) -> ItemSite:
    return ItemSite(**{k: v for k, v in d.items() if k in ItemSite.model_fields})


async def _itens_ordenados(filtro: dict | None = None) -> list[dict]:
    docs = await db.site_itens.find(filtro or {}).to_list(LIMITE_ITENS)
    docs.sort(key=lambda d: (not d.get("destaque"), d.get("ordem", 50), (d.get("categoria") or "").lower(), d.get("nome", "").lower()))
    return docs


@router.get("/itens", response_model=List[ItemSite])
async def listar_itens(principal: Principal = Depends(_acesso_site)):
    return [_item(d) for d in await _itens_ordenados()]


@router.post("/itens", response_model=ItemSite, status_code=201)
async def criar_item(input: ItemSiteIn, principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    await exigir_recurso("site")
    if await db.site_itens.count_documents({}) >= LIMITE_ITENS:
        raise HTTPException(409, f"O site aceita até {LIMITE_ITENS} itens. Desative ou exclua alguns antes.")
    from models.common import new_id

    doc = {"id": new_id(), **input.model_dump(), "nome": input.nome.strip(), "categoria": input.categoria.strip(),
           "tem_foto": False, "foto_v": 0, "created_at": now_utc()}
    await db.site_itens.insert_one(doc)
    limpar_cache()
    return _item(doc)


@router.put("/itens/{item_id}", response_model=ItemSite)
async def editar_item(item_id: str, input: ItemSiteIn, principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    r = await db.site_itens.update_one({"id": item_id}, {"$set": {**input.model_dump(), "nome": input.nome.strip(),
                                                                  "categoria": input.categoria.strip(), "updated_at": now_utc()}})
    if not r.matched_count:
        raise HTTPException(404, "Item não encontrado")
    limpar_cache()
    return _item(await db.site_itens.find_one({"id": item_id}))


@router.delete("/itens/{item_id}", status_code=204)
async def excluir_item(item_id: str, principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    await db.site_itens.delete_one({"id": item_id})
    await db.site_item_midia.delete_one({"id": item_id})
    limpar_cache()
    return Response(status_code=204)


@router.put("/itens/{item_id}/foto", response_model=ItemSite)
async def foto_item(item_id: str, input: MidiaInput, principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    if not await db.site_itens.find_one({"id": item_id}, {"id": 1}):
        raise HTTPException(404, "Item não encontrado")
    try:
        bruto = base64.b64decode(input.base64, validate=True)
    except Exception:
        raise HTTPException(422, "Imagem inválida")
    if len(bruto) > LIMITE_FOTO_ITEM:
        raise HTTPException(422, "A foto deve ter no máximo 600 KB.")
    from routers.fotos_imovel import _mime

    if _mime(bruto) is None:
        raise HTTPException(422, "Envie a foto em JPG, PNG ou WEBP.")
    await db.site_item_midia.update_one({"id": item_id}, {"$set": {"id": item_id, "base64": input.base64, "mime": _mime(bruto)}}, upsert=True)
    await db.site_itens.update_one({"id": item_id}, {"$set": {"tem_foto": True}, "$inc": {"foto_v": 1}})
    limpar_cache()
    return _item(await db.site_itens.find_one({"id": item_id}))


@router.delete("/itens/{item_id}/foto", response_model=ItemSite)
async def remover_foto_item(item_id: str, principal: Principal = Depends(_acesso_site)):
    _exigir_editor(principal)
    await db.site_item_midia.delete_one({"id": item_id})
    await db.site_itens.update_one({"id": item_id}, {"$set": {"tem_foto": False}, "$inc": {"foto_v": 1}})
    limpar_cache()
    d = await db.site_itens.find_one({"id": item_id})
    if not d:
        raise HTTPException(404, "Item não encontrado")
    return _item(d)


@router.get("/itens/{item_id}/foto")
async def ver_foto_item(item_id: str, principal: Principal = Depends(_acesso_site)):
    doc = await db.site_item_midia.find_one({"id": item_id})
    if not doc:
        raise HTTPException(404, "Sem foto")
    return Response(base64.b64decode(doc["base64"]), media_type=doc.get("mime", "image/jpeg"))


def _preco_importado(sv: dict) -> float | None:
    """Preço por unidade (toxina por U, por ml) não é o preço do atendimento: vira sob consulta. Zero também."""
    return None if sv.get("unidade") or not sv.get("preco") else sv.get("preco")


def _descricao_importada(sv: dict) -> str:
    desc = (sv.get("descricao") or "").strip()
    if sv.get("unidade") and sv.get("preco"):
        valor = f"R$ {sv['preco']:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
        desc = f"{desc} Valor de {valor} por {sv['unidade']}, conforme a quantidade indicada na avaliação.".strip()
    return desc[:600]


@router.post("/itens/importar")
async def importar_servicos(principal: Principal = Depends(_acesso_site)):
    """Traz os serviços ativos da agenda para o catálogo do site. Quem já veio não duplica."""
    _exigir_editor(principal)
    await exigir_recurso("site")
    seg = await _segmento()
    tipo = textos(seg)["tipo"]
    ja = {d.get("servico_id") async for d in db.site_itens.find({"servico_id": {"$ne": None}}, {"servico_id": 1})}
    total = await db.site_itens.count_documents({})
    novos = 0
    from models.common import new_id

    for sv in await db.servicos.find({"ativo": {"$ne": False}}).to_list(500):
        if sv["id"] in ja or total + novos >= LIMITE_ITENS:
            continue
        await db.site_itens.insert_one({
            "id": new_id(), "tipo": tipo, "nome": (sv.get("nome") or "Serviço")[:80], "descricao": _descricao_importada(sv),
            "categoria": (sv.get("categoria") or "")[:40], "preco": _preco_importado(sv), "preco_a_partir": False,
            "duracao_min": sv.get("duracao_min"), "ativo": True, "destaque": False, "ordem": 50, "tem_foto": False, "foto_v": 0,
            "servico_id": sv["id"], "created_at": now_utc()})
        novos += 1
    limpar_cache()
    return {"importados": novos}


# --------------------------------------------------------------------------- domínio próprio


class DominioIn(BaseModel):
    dominio: str = Field(min_length=4, max_length=200)


async def _situacao_dominio(config: SiteConfig) -> dict:
    from lib import dominios

    if not config.dominio:
        return {"dominio": None, "status": "sem_dominio"}
    principal, raiz = dominios.hosts(config.dominio)
    cfg = await dominios.config()
    if dominios.ativo_vercel(cfg):
        sit = await dominios.situacao_vercel(config.dominio, cfg)
    else:
        sit = {"status": "aguardando_ativacao", "registros": [{"tipo": "CNAME", "nome": "www", "valor": dominios.CNAME_PADRAO},
                                                              {"tipo": "A", "nome": "@", "valor": dominios.IP_PADRAO}]}
    await controle[dominios.COLECAO].update_many({"base": config.dominio}, {"$set": {"status": sit["status"], "checado_em": now_utc()}})
    return {"dominio": config.dominio, "principal": principal, "raiz": raiz, **sit}


@router.get("/dominio")
async def ver_dominio(principal: Principal = Depends(_acesso_site)):
    config, _ = await carregar_config()
    return await _situacao_dominio(config)


@router.put("/dominio")
async def salvar_dominio(input: DominioIn, principal: Principal = Depends(_acesso_site)):
    from lib import dominios

    _exigir_editor(principal)
    await exigir_recurso("site")
    config, configurado = await carregar_config()
    if not configurado or not config.slug:
        raise HTTPException(409, "Salve o site primeiro (endereço e WhatsApp) e depois ligue o domínio.")
    base = dominios.normalizar(input.dominio)
    banco = empresa_atual_db()
    for h in dominios.hosts(base):
        dono = await controle[dominios.COLECAO].find_one({"_id": h})
        if dono and dono.get("db_name") != banco:
            raise HTTPException(409, "Este domínio já está ligado ao site de outra empresa.")
    cfg = await dominios.config()
    if dominios.ativo_vercel(cfg):
        erro = await dominios.cadastrar_no_vercel(base, cfg)
        if erro:
            raise HTTPException(409, erro)
    if config.dominio and config.dominio != base:  # trocou de domínio: libera o antigo
        await dominios.desindexar(config.dominio)
        if dominios.ativo_vercel(cfg):
            await dominios.remover_do_vercel(config.dominio, cfg)
    empresa = await controle.empresas.find_one({"db_name": banco}, {"id": 1})
    await dominios.indexar(base, banco, (empresa or {}).get("id"))
    await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": {"dominio": base, "atualizado_em": now_utc(), "atualizado_por": principal.nome}})
    limpar_cache()
    config.dominio = base
    return await _situacao_dominio(config)


@router.delete("/dominio")
async def remover_dominio(principal: Principal = Depends(_acesso_site)):
    from lib import dominios

    _exigir_editor(principal)
    config, _ = await carregar_config()
    if config.dominio:
        cfg = await dominios.config()
        if dominios.ativo_vercel(cfg):
            await dominios.remover_do_vercel(config.dominio, cfg)
        await dominios.desindexar(config.dominio)
        await db.site_imobiliaria.update_one({"id": DOC_ID}, {"$set": {"dominio": None}})
        limpar_cache()
    return {"dominio": None, "status": "sem_dominio"}


@publico_router.get("/dominio/{host}")
async def site_do_dominio(host: str):
    """O navegador abriu o app num domínio próprio: diz de qual site ele é."""
    from lib import dominios

    indice = await dominios.resolver(host)
    if not indice:
        raise HTTPException(404, "Domínio sem site")
    definir_empresa(indice["db_name"])
    config, configurado = await carregar_config()
    if not configurado or not config.ativo or not config.slug or not await recurso_liberado("site"):
        raise HTTPException(404, "Site fora do ar")
    return {"slug": config.slug, "principal": dominios.hosts(indice["base"])[0]}


# --------------------------------------------------------------------------- domínios: configuração do plano de controle


class VercelIn(BaseModel):
    token: str | None = Field(default=None, max_length=200)
    projeto: str = Field(min_length=1, max_length=100)
    time: str = Field(default="", max_length=100)


admin_router = APIRouter(prefix="/plataforma/dominios", tags=["plataforma"])


@admin_router.get("")
async def painel_dominios(principal: Principal = Depends(require("empresa:manage"))):
    from lib import dominios

    cfg = await dominios.config()
    lista = await controle[dominios.COLECAO].find({}).to_list(500)
    empresas = {e["id"]: e.get("nome") for e in await controle.empresas.find({}, {"id": 1, "nome": 1}).to_list(None)}
    itens = {}
    for d in lista:
        if d["_id"].startswith("www."):
            itens[d["base"]] = {"dominio": d["_id"], "empresa": empresas.get(d.get("empresa_id"), "?"), "status": d.get("status") or "aguardando"}
    token = cfg.get("token") or ""
    return {"configurado": dominios.ativo_vercel(cfg), "por_env": cfg["por_env"], "projeto": cfg["projeto"], "time": cfg["time"],
            "token_mascarado": (token[:4] + "..." + token[-4:]) if len(token) > 10 else None, "dominios": sorted(itens.values(), key=lambda x: x["dominio"])}


@admin_router.put("")
async def salvar_vercel(input: VercelIn, principal: Principal = Depends(require("empresa:manage"))):
    from lib import dominios

    dados = {"projeto": input.projeto.strip(), "time": input.time.strip()}
    if input.token and input.token.strip():
        dados["token"] = input.token.strip()
    cfg = {**(await dominios.config()), **dados}
    if cfg.get("token"):
        st, _ = await dominios._vercel("GET", f"/v9/projects/{cfg['projeto']}", cfg)
        if st == 401 or st == 403:
            raise HTTPException(422, "O Vercel recusou o token. Gere um token novo e cole de novo.")
        if st == 404:
            raise HTTPException(422, "Projeto não encontrado no Vercel. Confira o nome do projeto e o time.")
    await controle.plataforma.update_one({"_id": dominios.DOC}, {"$set": {**dados, "atualizado_em": now_utc(), "atualizado_por": principal.email}}, upsert=True)
    return await painel_dominios(principal)


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
_FILTRO_VEICULO = {"site_status": {"$in": ["ativo", "reservado"]}, "status": {"$in": ["disponivel", "reservado"]}}


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


async def _marca_publica(config: SiteConfig, slug: str, seg: str) -> dict:
    return {**_marca(config, slug), "segmento": seg, "titulo_catalogo": config.titulo_catalogo or textos(seg)["catalogo"],
            "formulario": seg in COM_FORMULARIO, "agendar_url": await _agendar_url(config)}


def _item_publico(d: dict, slug: str, config: SiteConfig) -> dict:
    return {"id": d["id"], "tipo": d.get("tipo", "servico"), "nome": d.get("nome"), "descricao": d.get("descricao") or "",
            "categoria": d.get("categoria") or "", "destaque": bool(d.get("destaque")), "duracao_min": d.get("duracao_min"),
            "preco": d.get("preco") if config.mostrar_precos else None, "preco_a_partir": bool(d.get("preco_a_partir")),
            "servico_id": d.get("servico_id"),
            "foto_url": f"/api/publico/site/{slug}/item/{d['id']}/foto?v={d.get('foto_v', 0)}" if d.get("tem_foto") else None}


@publico_router.get("/{slug}/item/{item_id}/foto")
async def foto_publica_item(slug: str, item_id: str):
    await _entrar(slug)
    doc = await db.site_item_midia.find_one({"id": item_id})
    if not doc:
        raise HTTPException(404, "Sem foto")
    return Response(base64.b64decode(doc["base64"]), media_type=doc.get("mime", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"})


@publico_router.get("/{slug}")
async def pagina(slug: str):
    slug = slug.lower()
    cache = _CACHE.get(slug)
    if cache and time.monotonic() - cache[0] < CACHE_SEGUNDOS:
        return cache[1]
    config = await _site_ativo(slug)
    seg = await _segmento()
    veiculos = seg == "veiculos"
    if veiculos:
        docs = await db.veiculos.find(_FILTRO_VEICULO, {k: 1 for k in _CAMPOS_VEICULO}).sort("created_at", -1).to_list(1000)
    elif seg == "imobiliaria":
        docs = await db.imoveis.find(_FILTRO_SITE, {k: 1 for k in _CAMPOS_CARD}).sort("created_at", -1).to_list(1000)
    else:
        docs = []
    docs.sort(key=lambda d: (not d.get("site_destaque"), d.get("site_status") == "reservado"))
    itens = [_item_publico(d, slug, config) for d in await _itens_ordenados({"ativo": {"$ne": False}})]
    dados = {"marca": await _marca_publica(config, slug, seg), "itens": itens,
             "imoveis": [_veiculo_card(d) if veiculos else _card(d) for d in docs]}
    _CACHE[slug] = (time.monotonic(), dados)
    return dados


@publico_router.get("/{slug}/imovel/{codigo}")
async def imovel_publico(slug: str, codigo: str):
    config = await _site_ativo(slug)
    veiculos = await _eh_veiculos()
    colecao, filtro = (db.veiculos, _FILTRO_VEICULO) if veiculos else (db.imoveis, _FILTRO_SITE)
    d = await colecao.find_one({**filtro, "$or": [{"codigo": codigo.upper()}, {"id": codigo}]})
    if not d:
        raise HTTPException(404, "Item indisponível")
    from routers.fotos_imovel import listar, url_publica

    fotos = [url_publica(f["id"]) for f in await listar(d["id"])]
    if not fotos and d.get("foto_url"):
        fotos = [d["foto_url"]]
    card = _veiculo_card(d) if veiculos else _card(d)
    return {"marca": await _marca_publica(config, slug.lower(), "veiculos" if veiculos else "imobiliaria"),
            "imovel": {**card, "descricao": d.get("descricao"), "fotos": fotos}}


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
    seg = await _segmento()
    if seg not in COM_FORMULARIO:
        raise HTTPException(409, "Este site recebe contato pelo WhatsApp.")
    veiculos = seg == "veiculos"
    item = await db.site_itens.find_one({"id": input.item_id, "ativo": {"$ne": False}}, {"nome": 1, "tipo": 1, "preco": 1}) if input.item_id else None
    imovel = None
    if input.imovel_id and veiculos:
        v = await db.veiculos.find_one({**_FILTRO_VEICULO, "id": input.imovel_id})
        imovel = {**_veiculo_card(v), "veiculo": True} if v else None
    elif input.imovel_id:
        imovel = await db.imoveis.find_one({**_FILTRO_SITE, "id": input.imovel_id}, {"id": 1, "codigo": 1, "titulo": 1, "finalidade": 1,
                                                                                     "valor_venda": 1, "valor_aluguel": 1})
    from lib.automacoes import lead_novo
    from lib.crm import carregar_crm_config
    from models.crm import Entrada
    from routers.crm import _proximo_rodizio

    corretor_id = await _proximo_rodizio() if (await carregar_crm_config()).distribuicao == "rodizio" else None
    partes = [(input.mensagem or "").strip()]
    if imovel:
        partes.append(f"Interesse no {'veículo' if veiculos else 'imóvel'} {imovel.get('codigo')}: {imovel.get('titulo')}")
    if item:
        partes.append(f"Interesse em {item.get('nome')} (pelo site)")
    fin = (imovel or {}).get("finalidade")
    entrada = Entrada(
        nome=input.nome.strip(), telefone=input.telefone.strip(), email=(input.email or "").strip().lower() or None,
        origem="Site", interesse="locacao" if fin == "locacao" else ("compra" if seg in VENDAS else "outro"),
        mensagem="\n".join(p for p in partes if p)[:2000] or None, corretor_id=corretor_id,
        imovel_id=None if veiculos else (imovel or {}).get("id"), veiculo_id=(imovel or {}).get("id") if veiculos else None,
        valor_estimado=((imovel or {}).get("valor_aluguel") if fin == "locacao" else (imovel or {}).get("valor_venda")) or (item or {}).get("preco"),
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
    veiculos = await _eh_veiculos()
    colecao, filtro = (db.veiculos, _FILTRO_VEICULO) if veiculos else (db.imoveis, _FILTRO_SITE)
    if input.imovel_id and not await colecao.find_one({**filtro, "id": input.imovel_id}, {"id": 1}) \
            and not await db.site_itens.find_one({"id": input.imovel_id}, {"id": 1}):
        return Response(status_code=204)
    campo = "visualizacoes" if input.tipo == "visualizacao" else "whatsapp"
    await db.site_metricas.update_one({"id": input.imovel_id or "_site"}, {"$inc": {campo: 1}}, upsert=True)
    return Response(status_code=204)
