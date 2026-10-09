"""Portais imobiliários: feed XML (padrão VRSync do Grupo OLX: ZAP Imóveis, VivaReal e OLX) e
recebimento dos leads que os portais enviam.

- O gestor marca no imóvel "Publicar nos portais" e o nível de destaque.
- O feed é uma URL com token (a mesma para todos os portais do grupo) cadastrada uma vez no painel
  do anunciante. O código do imóvel no CRM (ex.: AP-0007) é o ListingID.
- Os leads chegam por webhook na URL de leads, caem na caixa de entrada já ligados ao imóvel
  (pelo `clientListingId`) e seguem a distribuição configurada. Reenvios não duplicam
  (`originLeadId`).
"""

import os
from datetime import timedelta
from typing import List
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from lib import automacoes, links
from lib.auth import Principal, require
from lib.crm import carregar_crm_config
from lib.db import controle, db, empresa_atual_db
from lib.planos import exigir_recurso, recurso_liberado
from models.common import now_utc
from models.crm import Entrada

router = APIRouter(prefix="/portais", tags=["portais"])
publico_router = APIRouter(prefix="/publico/portais", tags=["publico"])

TIPO_VRSYNC = {
    "apartamento": ("Residential", "Residential / Apartment"),
    "casa": ("Residential", "Residential / Home"),
    "terreno": ("Residential", "Residential / Land Lot"),
    "comercial": ("Commercial", "Commercial / Business"),
}
TRANSACAO = {"venda": "For Sale", "locacao": "For Rent", "ambos": "Sale/Rent"}
ESTADOS = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
    "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins",
}
UFS = set(ESTADOS)


class Pendencia(BaseModel):
    imovel_id: str
    codigo: str
    titulo: str
    faltando: List[str]
    bloqueia: bool  # True = o portal recusa o anúncio; False = só reduz a qualidade


class PortaisConfig(BaseModel):
    liberado: bool
    feed_url: str | None = None
    leads_url: str | None = None
    publicados: int = 0
    prontos: int = 0
    carteira: int = 0
    pendencias: List[Pendencia] = []
    feed_acessado_em: str | None = None
    leads_30d: int = 0
    aviso: str | None = None


def _base() -> str:
    return os.environ.get("APP_URL", "").rstrip("/")


async def _fotos(imovel: dict) -> list[str]:
    from routers.fotos_imovel import listar, url_publica

    fotos = [url_publica(f["id"], absoluta=True) for f in await listar(imovel["id"])]
    if not fotos and imovel.get("foto_url", "") and imovel["foto_url"].startswith("http"):
        fotos = [imovel["foto_url"]]
    return fotos


async def pendencias(imovel: dict) -> tuple[list[str], bool]:
    """O que falta para o anúncio ser aceito (bloqueia) ou ficar bom (qualidade)."""
    faltando, bloqueia = [], False
    fin = imovel.get("finalidade")
    if fin in ("venda", "ambos") and not imovel.get("valor_venda"):
        faltando.append("valor de venda"); bloqueia = True
    if fin in ("locacao", "ambos") and not imovel.get("valor_aluguel"):
        faltando.append("valor do aluguel"); bloqueia = True
    if not (imovel.get("area_util") or imovel.get("area_total")):
        faltando.append("área"); bloqueia = True
    if not (imovel.get("estado") or "").upper() in UFS:
        faltando.append("UF"); bloqueia = True
    fotos = len(await _fotos(imovel))
    if fotos == 0:
        faltando.append("fotos"); bloqueia = True
    elif fotos < 5:
        faltando.append(f"mais fotos ({fotos}/5)")
    if len((imovel.get("descricao") or "").strip()) < 50:
        faltando.append("descrição com 50+ caracteres")
    if not imovel.get("bairro"):
        faltando.append("bairro")
    if not imovel.get("cep"):
        faltando.append("CEP")
    if imovel.get("tipo") != "terreno" and not imovel.get("banheiros"):
        faltando.append("banheiros")
    return faltando, bloqueia


async def _token_atual() -> str | None:
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"portais": 1}) or {}
    return (cfg.get("portais") or {}).get("token")


async def _garantir_token() -> str:
    token = await _token_atual()
    if token and await links.existe("portais", "feed"):
        return token
    token = await links.criar("portais", "feed", substituir=True)
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"portais.token": token}}, upsert=True)
    return token


@router.get("/config", response_model=PortaisConfig)
async def config(principal: Principal = Depends(require("portal:manage"))):
    if not await recurso_liberado("portais"):
        return PortaisConfig(liberado=False)
    token = await _garantir_token()
    cfg = (await db.configuracoes.find_one({"id": "singleton"}, {"portais": 1}) or {}).get("portais") or {}
    lista, prontos, publicados = [], 0, 0
    carteira = await db.imoveis.count_documents({"status": {"$nin": ["vendido", "alugado"]}})
    async for im in db.imoveis.find({"publicar_portais": True, "status": {"$nin": ["vendido", "alugado"]}}):
        publicados += 1
        faltando, bloqueia = await pendencias(im)
        if not bloqueia:
            prontos += 1
        if faltando:
            lista.append(Pendencia(imovel_id=im["id"], codigo=im.get("codigo") or "", titulo=im["titulo"], faltando=faltando, bloqueia=bloqueia))
    lista.sort(key=lambda p: (not p.bloqueia, p.codigo))
    acesso = cfg.get("feed_acessado_em")
    return PortaisConfig(
        liberado=True, feed_url=f"{_base()}/api/publico/portais/{token}/vrsync.xml", leads_url=f"{_base()}/api/publico/portais/{token}/leads",
        publicados=publicados, prontos=prontos, carteira=carteira, pendencias=lista,
        feed_acessado_em=acesso.isoformat() if acesso else None,
        aviso=None if _base().startswith("https://") else "Defina APP_URL (https) no servidor: os portais precisam de endereços completos para baixar as fotos.",
        leads_30d=await db.entradas.count_documents({"portal_lead_id": {"$ne": None}, "created_at": {"$gte": now_utc() - timedelta(days=30)}}),
    )


@router.post("/novo-token", response_model=PortaisConfig)
async def novo_token(principal: Principal = Depends(require("portal:manage"))):
    """Troca as URLs (ex.: suspeita de vazamento). É preciso recadastrar no painel dos portais."""
    await exigir_recurso("portais")
    token = await links.criar("portais", "feed", substituir=True)
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"portais.token": token}}, upsert=True)
    return await config(principal)


# ------------------------------------------------------------------ feed público


def _tag(nome: str, valor, **attrs) -> str:
    if valor is None or valor == "":
        return ""
    a = "".join(f' {k}="{escape(str(v), {chr(34): "&quot;"})}"' for k, v in attrs.items())
    return f"<{nome}{a}>{escape(str(valor))}</{nome}>"


def _inteiro(v) -> int | None:
    return int(round(v)) if v else None


async def _listing(im: dict, contato: dict) -> str | None:
    faltando, bloqueia = await pendencias(im)
    if bloqueia:
        return None
    uso, tipo = TIPO_VRSYNC.get(im["tipo"], ("Residential", "Residential / Apartment"))
    fotos = await _fotos(im)
    legenda = escape(im["titulo"][:60], {'"': "&quot;"})
    primaria = ' primary="true"'
    midia = "".join(f'<Item medium="image" caption="{legenda}"{primaria if i == 0 else ""}>{escape(u)}</Item>'
                    for i, u in enumerate(fotos[:50]))
    fin = im["finalidade"]
    detalhes = [
        _tag("UsageType", uso), _tag("PropertyType", tipo),
        f"<Description><![CDATA[{(im.get('descricao') or im['titulo']).replace(']]>', ']] >')}]]></Description>",
        _tag("ListPrice", _inteiro(im.get("valor_venda")), currency="BRL") if fin in ("venda", "ambos") else "",
        _tag("RentalPrice", _inteiro(im.get("valor_aluguel")), currency="BRL", period="Monthly") if fin in ("locacao", "ambos") else "",
        _tag("PropertyAdministrationFee", _inteiro(im.get("condominio")), currency="BRL") if im.get("condominio") else "",
        _tag("Iptu", _inteiro(im.get("iptu")), currency="BRL", period="Monthly") if im.get("iptu") else "",
        _tag("LivingArea", _inteiro(im.get("area_util") or im.get("area_total")), unit="square metres"),
        _tag("LotArea", _inteiro(im.get("area_total")), unit="square metres") if im.get("area_total") else "",
        _tag("Bedrooms", im.get("quartos") or 0) if im["tipo"] != "terreno" else "",
        _tag("Bathrooms", im.get("banheiros") or 0) if im["tipo"] != "terreno" else "",
        _tag("Suites", im.get("suites") or 0) if im.get("suites") else "",
        _tag("Garage", im.get("vagas") or 0, type="Parking Space") if im.get("vagas") else "",
    ]
    uf = (im.get("estado") or "").upper()
    local = (
        '<Location displayAddress="Neighborhood">'
        + _tag("Country", "Brasil", abbreviation="BR") + _tag("State", ESTADOS.get(uf, uf), abbreviation=uf) + _tag("City", im.get("cidade"))
        + _tag("Neighborhood", im.get("bairro")) + _tag("Address", im.get("endereco")) + _tag("PostalCode", im.get("cep"))
        + "</Location>"
    )
    return (
        "<Listing>" + _tag("ListingID", im.get("codigo") or im["id"]) + _tag("Title", im["titulo"][:100])
        + _tag("TransactionType", TRANSACAO[fin]) + _tag("PublicationType", im.get("destaque_portal") or "STANDARD")
        + f"<Media>{midia}</Media><Details>{''.join(detalhes)}</Details>{local}"
        + "<ContactInfo>" + _tag("Name", contato["nome"]) + _tag("Email", contato.get("email")) + _tag("Telephone", contato.get("telefone"))
        + "</ContactInfo></Listing>"
    )


@publico_router.get("/{token}/vrsync.xml")
async def feed(token: str):
    await links.resolver(token, "portais")
    if not await recurso_liberado("portais"):
        raise HTTPException(404, "Feed indisponível")
    cfg = await db.configuracoes.find_one({"id": "singleton"}, {"nome_software": 1, "email_resposta": 1, "whatsapp_numero": 1}) or {}
    empresa = await controle.empresas.find_one({"db_name": empresa_atual_db()}, {"nome": 1}) or {}
    contato = {"nome": empresa.get("nome") or cfg.get("nome_software") or "Imobiliária", "email": cfg.get("email_resposta"),
               "telefone": cfg.get("whatsapp_numero")}
    itens = []
    async for im in db.imoveis.find({"publicar_portais": True, "status": {"$nin": ["vendido", "alugado"]}}):
        bloco = await _listing(im, contato)
        if bloco:
            itens.append(bloco)
    await db.configuracoes.update_one({"id": "singleton"}, {"$set": {"portais.feed_acessado_em": now_utc()}})
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd">'
        "<Header>" + _tag("Provider", contato["nome"]) + _tag("Email", contato.get("email")) + _tag("ContactName", contato["nome"])
        + _tag("PublishDate", now_utc().strftime("%Y-%m-%dT%H:%M:%S")) + _tag("Telephone", contato.get("telefone")) + "</Header>"
        f"<Listings>{''.join(itens)}</Listings></ListingDataFeed>"
    )
    return Response(xml, media_type="application/xml; charset=utf-8", headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------ leads dos portais


ORIGEM_PORTAL = {"grupo olx": "Portal ZAP", "zap": "Portal ZAP", "vivareal": "VivaReal", "olx": "OLX", "mcmv_olx": "OLX"}


@publico_router.post("/{token}/leads", status_code=201)
async def receber_lead(token: str, request: Request):
    await links.resolver(token, "portais")
    if not await recurso_liberado("portais"):
        raise HTTPException(404, "Integração indisponível")
    try:
        p = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")
    if not isinstance(p, dict):
        raise HTTPException(400, "JSON inválido")
    nome = str(p.get("name") or "").strip()[:200]
    if not nome:
        raise HTTPException(400, "name é obrigatório")
    origem_bruta = str(p.get("leadOrigin") or "").strip()
    lead_id = str(p.get("originLeadId") or "").strip()[:120] or None
    codigo = str(p.get("clientListingId") or "").strip()[:60]
    if not codigo and origem_bruta.upper() != "MCMV_OLX":
        # Recomendação do Grupo OLX: lead de anúncio sem código volta com 4xx para revisão.
        raise HTTPException(422, "clientListingId ausente")
    if lead_id:
        existente = await db.entradas.find_one({"portal_lead_id": lead_id}, {"id": 1})
        if existente:
            return {"lead_id": existente["id"], "duplicado": True}
    imovel = await db.imoveis.find_one({"codigo": codigo}, {"id": 1, "titulo": 1, "finalidade": 1}) if codigo else None
    telefone = f"({p['ddd']}) {p['phone']}" if p.get("ddd") and p.get("phone") else (str(p.get("phoneNumber") or p.get("phone") or "").strip() or None)
    transacao = str(p.get("transactionType") or "").upper()
    interesse = "locacao" if transacao == "RENT" else "compra"
    extra = p.get("extraData") if isinstance(p.get("extraData"), dict) else {}
    partes = [str(p.get("message") or "").strip()]
    if p.get("temperature"):
        partes.append(f"Temperatura informada pelo portal: {p['temperature']}")
    if extra.get("leadType"):
        partes.append(f"Canal: {extra['leadType']}")
    if not imovel and codigo:
        partes.append(f"Código do anúncio não encontrado no CRM: {codigo}")
    corretor_id = None
    if (await carregar_crm_config()).distribuicao == "rodizio":
        from routers.crm import _proximo_rodizio
        corretor_id = await _proximo_rodizio()
    entrada = Entrada(
        nome=nome, telefone=telefone, email=(str(p.get("email") or "").strip().lower() or None),
        origem=ORIGEM_PORTAL.get(origem_bruta.lower(), origem_bruta[:40] or "Portal"), interesse=interesse,
        mensagem="\n".join(x for x in partes if x)[:2000] or None, imovel_id=(imovel or {}).get("id"), corretor_id=corretor_id,
        etiquetas=["Quente"] if str(p.get("temperature") or "").lower() == "alta" else [], portal_lead_id=lead_id,
    )
    await db.entradas.insert_one(entrada.model_dump())
    await automacoes.lead_novo(entrada.model_dump())
    return {"lead_id": entrada.id, "imovel_vinculado": imovel is not None}
