"""Integração com a OLX para a loja de veículos (anúncios de carros e leads).

Como funciona (documentação pública em developers.olx.com.br):
- A SAX tem UM aplicativo cadastrado na OLX (client_id e client_secret, pedidos ao suporte de integração da OLX).
  O administrador da plataforma guarda os dois em Empresas > Pagamentos (ou OLX_CLIENT_ID/OLX_CLIENT_SECRET).
- Cada loja liga a própria conta profissional da OLX por OAuth (scopes autoupload, autoservice e basic_user_info).
  O access_token fica no banco da empresa e nunca volta para a tela.
- Publicar: PUT /autoupload/import com a lista de anúncios (insert insere ou edita; delete despublica).
  Carros vão na categoria 2020 com marca, modelo e versão do catálogo da OLX.
- Leads: a OLX manda cada lead para a nossa URL (configurada em /autoservice/v1/lead) com o token da loja
  no cabeçalho Authorization.

O endereço da OLX pode ser trocado por OLX_AUTH_URL e OLX_API_URL (testes usam um simulador local).
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import time

import httpx

from lib.db import controle

logger = logging.getLogger(__name__)

DOC = "olx"
SCOPES = "autoupload autoservice basic_user_info"
CATEGORIA_CARROS = 2020
TAM_LOTE = 40  # anúncios por envio (a OLX aceita até 1 MB por requisição)


class ErroOlx(Exception):
    def __init__(self, mensagem: str, status: int = 502):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


def auth_url() -> str:
    return (os.environ.get("OLX_AUTH_URL") or "https://auth.olx.com.br").rstrip("/")


def api_url() -> str:
    return (os.environ.get("OLX_API_URL") or "https://apps.olx.com.br").rstrip("/")


def base_app() -> str:
    return os.environ.get("APP_URL", "").rstrip("/")


def redirect_uri() -> str:
    return f"{base_app()}/api/publico/olx/retorno"


async def app_config() -> dict:
    doc = await controle.plataforma.find_one({"_id": DOC}) or {}
    cid = os.environ.get("OLX_CLIENT_ID") or doc.get("client_id") or ""
    segredo = os.environ.get("OLX_CLIENT_SECRET") or doc.get("client_secret") or ""
    return {"client_id": cid, "client_secret": segredo, "por_env": bool(os.environ.get("OLX_CLIENT_ID"))}


def app_pronto(cfg: dict) -> bool:
    return bool(cfg.get("client_id") and cfg.get("client_secret"))


# ------------------------------------------------------------------ OAuth


async def url_autorizacao(estado: str) -> str:
    cfg = await app_config()
    if not app_pronto(cfg):
        raise ErroOlx("A integração com a OLX ainda não foi ativada pela SAX.", 409)
    from urllib.parse import urlencode

    q = urlencode({"response_type": "code", "client_id": cfg["client_id"], "redirect_uri": redirect_uri(), "scope": SCOPES, "state": estado})
    return f"{auth_url()}/oauth?{q}"


async def trocar_codigo(code: str) -> str:
    cfg = await app_config()
    if not app_pronto(cfg):
        raise ErroOlx("A integração com a OLX ainda não foi ativada pela SAX.", 409)
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{auth_url()}/oauth/token", data={
                "code": code, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                "redirect_uri": redirect_uri(), "grant_type": "authorization_code"})
    except httpx.HTTPError as e:
        raise ErroOlx(f"Não consegui falar com a OLX ({type(e).__name__}).")
    if r.status_code != 200 or not (r.json() or {}).get("access_token"):
        logger.warning("olx token: %s %s", r.status_code, r.text[:200])
        raise ErroOlx("A OLX não liberou o acesso. Tente conectar de novo.", 400)
    return r.json()["access_token"]


async def _post(caminho: str, corpo: dict, *, token: str | None = None, metodo: str = "POST", bearer: bool = False) -> dict:
    headers = {"Content-Type": "application/json"}
    if bearer and token:
        headers["Authorization"] = f"Bearer {token}"
    elif token:
        corpo = {"access_token": token, **corpo}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.request(metodo, api_url() + caminho, json=corpo, headers=headers)
    except httpx.HTTPError as e:
        raise ErroOlx(f"Não consegui falar com a OLX ({type(e).__name__}).")
    if r.status_code == 401:
        raise ErroOlx("A OLX recusou o acesso da loja. Conecte a conta da OLX de novo.", 401)
    try:
        dados = r.json()
    except ValueError:
        dados = {}
    if r.status_code >= 400:
        logger.warning("olx %s %s: %s %s", metodo, caminho, r.status_code, r.text[:300])
        raise ErroOlx(f"A OLX respondeu com erro ({r.status_code}).")
    return dados if isinstance(dados, dict) else {"data": dados}


async def conta(token: str) -> dict:
    d = await _post("/oauth_api/basic_user_info", {}, token=token)
    return {"nome": d.get("user_name"), "email": d.get("user_email")}


async def configurar_leads(token: str, url: str, segredo: str) -> str | None:
    d = await _post("/autoservice/v1/lead", {"url": url, "token": segredo}, token=token, bearer=True)
    return str(d.get("id")) if d.get("id") is not None else None


# ------------------------------------------------------------------ catálogo de marcas, modelos e versões

_cache: dict[str, tuple[float, dict]] = {}


async def catalogo(token: str, marca: str | None = None, modelo: str | None = None) -> list[dict]:
    """[{id, nome}] em ordem alfabética. Guarda 12 h em memória (a lista muda pouco)."""
    caminho = "/autoupload/car_info" + (f"/{marca}" if marca else "") + (f"/{modelo}" if marca and modelo else "")
    agora = time.monotonic()
    if caminho in _cache and agora - _cache[caminho][0] < 12 * 3600:
        dados = _cache[caminho][1]
    else:
        d = await _post(caminho, {}, token=token)
        dados = d.get("data") if isinstance(d.get("data"), dict) else {}
        _cache[caminho] = (agora, dados)
    return sorted(({"id": str(v), "nome": str(k)} for k, v in dados.items()), key=lambda x: x["nome"].lower())


# ------------------------------------------------------------------ anúncio de carro

CAMBIO = {"manual": "1", "automatico": "2", "cvt": "2", "automatizado": "4"}
COMBUSTIVEL = {"gasolina": "1", "etanol": "2", "flex": "3", "diesel": "5", "hibrido": "6", "eletrico": "7"}
CARROCERIA = {"hatch": "9", "sedan": "8", "suv": "5", "picape": "3", "utilitario": "7", "esportivo": "11"}
PORTAS = {2: "1", 4: "2", 3: "3"}
CORES = {"preto": "1", "branco": "2", "prata": "3", "vermelho": "4", "cinza": "5", "azul": "6", "amarelo": "7", "verde": "8", "laranja": "9"}
OPCIONAIS = [  # (palavra no opcional do CRM, código car_features da OLX)
    ("ar", "1"), ("vidro", "3"), ("trava", "4"), ("airbag", "5"), ("air bag", "5"), ("alarme", "6"), ("som", "7"),
    ("multimídia", "7"), ("sensor", "8"), ("câmera", "9"), ("camera", "9"), ("blindado", "10"), ("couro", "11"),
    ("computador", "12"), ("usb", "13"), ("volante", "14"), ("bluetooth", "15"), ("gps", "16"), ("navegador", "16"),
    ("piloto", "17"), ("velocidade", "17"), ("liga", "18"), ("teto", "19"), ("4x4", "20"), ("tração", "20"),
]


def id_anuncio(v: dict) -> str:
    """O código do veículo no CRM (VE-0001) é o id do anúncio na OLX (até 19 caracteres)."""
    return re.sub(r"[^A-Za-z0-9_-]", "", v.get("codigo") or v["id"])[:19]


def _ano(ano: int) -> str:
    if ano >= 1980:
        return str(ano)
    for limite in (1975, 1970, 1965, 1960, 1955):
        if ano >= limite:
            return str(limite)
    return "1950"


def _cor(nome: str | None) -> str | None:
    n = (nome or "").lower()
    return next((c for k, c in CORES.items() if k in n), "10" if n else None)


def _features(opcionais: list[str]) -> list[str]:
    saida: list[str] = []
    for o in opcionais or []:
        t = o.lower()
        for chave, codigo in OPCIONAIS:
            if (chave == "ar" and re.search(r"\bar\b|ar[- ]condicionado", t)) or (chave != "ar" and chave in t):
                if codigo not in saida:
                    saida.append(codigo)
                break
    return saida


def pendencias(v: dict, cfg_loja: dict, fotos: list[str]) -> list[str]:
    """O que impede o anúncio de ir para a OLX."""
    falta = []
    o = v.get("olx") or {}
    if v.get("categoria") == "moto":
        falta.append("Motos ainda não vão para a OLX por aqui")
    if not v.get("preco_venda"):
        falta.append("Preço de venda")
    if not fotos:
        falta.append("Pelo menos uma foto")
    if not (o.get("marca") and o.get("modelo") and o.get("versao")):
        falta.append("Marca, modelo e versão do catálogo da OLX")
    if (v.get("km") or 0) > 0 and not v.get("placa"):
        falta.append("Placa (a OLX pede para usado; não aparece no anúncio)")
    if not re.sub(r"\D", "", cfg_loja.get("cep") or ""):
        falta.append("CEP da loja (em OLX, Configurar)")
    if len(re.sub(r"\D", "", cfg_loja.get("telefone") or "")) not in (10, 11):
        falta.append("Telefone da loja com DDD (em OLX, Configurar)")
    return falta


def anuncio(v: dict, cfg_loja: dict, fotos: list[str]) -> dict:
    """Monta o anúncio de carro (categoria 2020) no formato do /autoupload/import."""
    from routers.veiculos import titulo

    o = v.get("olx") or {}
    params: dict = {
        "regdate": _ano(int(v.get("ano_modelo") or v.get("ano_fabricacao"))), "mileage": int(v.get("km") or 0),
        "vehicle_brand": str(o["marca"]), "vehicle_model": str(o["modelo"]), "vehicle_version": str(o["versao"]),
    }
    if v.get("placa"):
        params["vehicle_tag"] = v["placa"].upper()
    extra = {
        "gearbox": CAMBIO.get(v.get("cambio") or ""), "fuel": COMBUSTIVEL.get(v.get("combustivel") or ""),
        "cartype": CARROCERIA.get(v.get("categoria") or ""), "doors": PORTAS.get(v.get("portas") or 0), "carcolor": _cor(v.get("cor")),
        "exchange": "1" if v.get("aceita_troca") else "2", "owner": "1" if v.get("unico_dono") else None,
        "gnv_kit": "1" if v.get("combustivel") == "gnv" else None,
    }
    params.update({k: val for k, val in extra.items() if val})
    if v.get("ipva_pago"):
        params["financial"] = ["2"]
    feats = _features(v.get("opcionais") or [])
    if feats:
        params["car_features"] = feats
    if int(v.get("km") or 0) == 0:
        params["zero_km"] = "1"
    corpo = (v.get("descricao") or "").strip() or f"{titulo(v)}. {int(v.get('km') or 0):,} km.".replace(",", ".")
    return {
        "id": id_anuncio(v), "operation": "insert", "category": CATEGORIA_CARROS,
        "Subject": titulo(v)[:90], "Body": corpo[:6000], "Phone": int(re.sub(r"\D", "", cfg_loja["telefone"])),
        "type": "s", "price": int(float(v["preco_venda"]) + 0.5), "zipcode": re.sub(r"\D", "", cfg_loja["cep"]),
        "images": list(dict.fromkeys(fotos))[:20], "params": params,
    }


async def importar(token: str, lista: list[dict]) -> dict:
    """Manda os anúncios em lotes. Devolve {ok, token, status, mensagem, erros: {id: [motivos]}}."""
    saida = {"ok": True, "tokens": [], "status": 0, "mensagem": "", "erros": {}}
    for i in range(0, len(lista), TAM_LOTE):
        d = await _post("/autoupload/import", {"ad_list": lista[i:i + TAM_LOTE]}, token=token, metodo="PUT")
        status = d.get("statusCode")
        saida["status"] = status
        saida["mensagem"] = d.get("statusMessage") or ""
        if d.get("token"):
            saida["tokens"].append(d["token"])
        for e in d.get("errors") or []:
            saida["erros"][str(e.get("id"))] = [m.get("category") or str(m) for m in e.get("messages") or []]
        if status not in (0, None):
            saida["ok"] = False
            if status in (-5, -6, -2, -1):  # serviço fora, sem permissão, bloqueio: não adianta seguir
                break
    return saida


MENSAGENS = {
    -1: "Erro inesperado na OLX. Tente de novo em alguns minutos.",
    -2: "A OLX bloqueou por excesso de envios. Espere um pouco e tente de novo.",
    -3: "Nenhum anúncio para enviar.",
    -4: "Algum anúncio voltou com problema. Veja os avisos de cada veículo.",
    -5: "O envio de anúncios da OLX está fora do ar agora.",
    -6: "A conta da OLX não tem permissão. Ela precisa de um plano profissional para empresas.",
    -7: "A conta da OLX não tem vagas para todos os anúncios.",
    -8: "A OLX publicou só parte dos anúncios por falta de vagas.",
}

ERROS = {
    "NO_IMAGE": "Sem foto", "NO_REGION": "CEP inválido", "UNDEFINED_AD_ID": "Código do anúncio inválido",
    "ERROR_VEHICLE_TAG_INVALID": "Placa inválida", "INVALID_PLATE": "Placa inválida",
    "ERROR_VEHICLE_BRAND_INVALID": "Marca não existe no catálogo da OLX", "ERROR_VEHICLE_MODEL_INVALID": "Modelo não existe no catálogo da OLX",
    "ERROR_VEHICLE_VERSION_INVALID": "Versão não existe no catálogo da OLX",
    "ERROR_VEHICLE_BRAND_MODEL_VERSION_INVALID": "Marca, modelo e versão não combinam no catálogo da OLX",
}


def novo_segredo() -> str:
    return secrets.token_urlsafe(24)
