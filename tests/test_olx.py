"""OLX na loja de veículos: aplicativo da SAX, conta da loja por OAuth, catálogo, envio do estoque, venda tirando
o anúncio e leads chegando no CRM. Precisa da API local com OLX_AUTH_URL/OLX_API_URL apontando para o simulador
(tests/fake_olx.py: uvicorn fake_olx:app --port 8099 --app-dir tests)."""

import base64
import os
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)

OLX = os.environ.get("OLX_TESTE_URL", "http://localhost:8099")
JPG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A"
    "f//Z")


def _olx_no_ar() -> bool:
    try:
        return httpx.get(f"{OLX}/_teste/estado", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _olx_no_ar(), reason="simulador da OLX fora do ar")


def _estado() -> dict:
    return httpx.get(f"{OLX}/_teste/estado").json()


@pytest.fixture(scope="module")
def loja(sysadmin, cartao_demo):  # noqa: F811
    assert sysadmin.put("/plataforma/olx", json={"client_id": "app-teste"}).status_code in (200, 422)
    r = sysadmin.put("/plataforma/olx", json={"client_id": "app-teste", "client_secret": "segredo-teste"})
    assert r.status_code == 200 and r.json()["configurado"] and "segredo-teste" not in r.text
    assert r.json()["redirect_uri"].endswith("/api/publico/olx/retorno")
    c, _ = _cadastrar("veiculos", cartao_demo, plano="veiculos_essencial")
    assert c.get("/olx").json()["conectado"] is False
    # o gestor autoriza na OLX e volta para o CRM
    url = c.post("/olx/conectar").json()["url"]
    volta = httpx.get(url, follow_redirects=False)
    assert volta.status_code in (302, 307)
    q = parse_qs(urlparse(volta.headers["location"]).query)
    r = httpx.get(f"{API}/publico/olx/retorno", params={"code": q["code"][0], "state": q["state"][0]}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("/veiculos?olx=conectado")
    # o mesmo state não serve duas vezes
    r2 = httpx.get(f"{API}/publico/olx/retorno", params={"code": "x", "state": q["state"][0]}, follow_redirects=False)
    assert r2.headers["location"].endswith("olx=expirou")
    return c


def test_conta_conectada_e_leads_ligados(loja):
    s = loja.get("/olx").json()
    assert s["conectado"] and s["conta"]["nome"] == "Loja Teste OLX" and s["leads_ligados"]
    assert "access_token" not in str(s) and "token-olx-teste" not in str(s)
    assert _estado()["leads"][-1]["url"].startswith("http") and "/api/publico/olx/leads/" in _estado()["leads"][-1]["url"]


def test_catalogo_envio_venda_e_lead(loja):
    marcas = loja.get("/olx/catalogo").json()
    assert {"id": "30", "nome": "FIAT"} in marcas
    assert [m["nome"] for m in loja.get("/olx/catalogo", params={"marca": "30"}).json()] == ["ARGO", "MOBI"]
    versoes = loja.get("/olx/catalogo", params={"marca": "30", "modelo": "301"}).json()
    assert len(versoes) == 2
    assert loja.put("/olx/config", json={"cep": "123", "telefone": "41999998888"}).status_code == 422
    assert loja.put("/olx/config", json={"cep": "80.420-090", "telefone": "(41) 99999-8888"}).json()["cep"] == "80420090"

    olx = {"publicar": True, "marca": "30", "modelo": "301", "versao": versoes[0]["id"], "marca_nome": "FIAT", "modelo_nome": "ARGO",
           "versao_nome": versoes[0]["nome"]}
    v = loja.post("/veiculos", json={"marca": "Fiat", "modelo": "Argo", "versao": "Drive 1.0", "ano_fabricacao": 2021, "ano_modelo": 2022,
                                     "km": 31000, "cor": "Branco", "cambio": "manual", "combustivel": "flex", "categoria": "hatch",
                                     "portas": 4, "placa": "ABC1D23", "preco_venda": 72990.50, "ipva_pago": True,
                                     "opcionais": ["Ar-condicionado", "Câmera de ré", "Multimídia"], "olx": olx}).json()
    s = loja.get("/olx").json()
    assert s["marcados"] == 1 and s["prontos"] == 0 and "Pelo menos uma foto" in s["pendencias"][0]["faltando"]
    assert loja.post(f"/veiculos/{v['id']}/fotos", files={"arquivos": ("a.jpg", JPG, "image/jpeg")}).status_code == 201
    antes = len(_estado()["importados"])
    r = loja.post("/olx/sincronizar").json()
    assert r["status"] == 0 and r["enviados"] == 1, r
    ad = _estado()["importados"][antes]
    assert ad["id"] == v["codigo"] and ad["category"] == 2020 and ad["price"] == 72991 and ad["zipcode"] == "80420090"
    assert ad["Phone"] == 41999998888 and ad["type"] == "s" and ad["images"][0].startswith("http")
    p = ad["params"]
    assert p["regdate"] == "2022" and p["mileage"] == 31000 and p["vehicle_tag"] == "ABC1D23" and p["gearbox"] == "1"
    assert p["fuel"] == "3" and p["cartype"] == "9" and p["doors"] == "2" and p["carcolor"] == "2" and p["financial"] == ["2"]
    assert set(p["car_features"]) >= {"1", "9", "7"}
    assert loja.get(f"/veiculos/{v['id']}").json()["olx"]["situacao"] == "enviado"

    # editar sem mexer na OLX não desmarca nem apaga a situação
    corpo = {k: v[k] for k in ("marca", "modelo", "versao", "ano_fabricacao", "ano_modelo", "km", "cor", "cambio", "combustivel",
                               "categoria", "portas", "placa", "preco_venda", "ipva_pago", "opcionais")}
    assert loja.put(f"/veiculos/{v['id']}", json={**corpo, "preco_venda": 70000}).status_code == 200
    assert loja.get(f"/veiculos/{v['id']}").json()["olx"]["situacao"] == "enviado"

    # versão errada volta com o motivo
    ruim = loja.post("/veiculos", json={**corpo, "placa": "XYZ9A88", "olx": {**olx, "versao": "999"}}).json()
    loja.post(f"/veiculos/{ruim['id']}/fotos", files={"arquivos": ("b.jpg", JPG, "image/jpeg")})
    r = loja.post("/olx/sincronizar").json()
    assert r["status"] == -4 and any("Versão" in m for m in r["erros"][ruim["codigo"]])
    assert loja.get(f"/veiculos/{ruim['id']}").json()["olx"]["erros"]
    loja.put(f"/veiculos/{ruim['id']}", json={**corpo, "placa": "XYZ9A88", "olx": {**olx, "publicar": False}})

    # vendido sai da OLX na hora
    antes = len(_estado()["importados"])
    assert loja.post(f"/veiculos/{v['id']}/vender", json={"valor": 70000}).status_code == 200
    apagados = [a for a in _estado()["importados"][antes:] if a["operation"] == "delete"]
    assert apagados and apagados[0]["id"] == v["codigo"]

    # lead da OLX cai na caixa de entrada ligado ao carro, sem duplicar
    url = _estado()["leads"][-1]["url"]
    caminho = "/publico/olx/leads/" + url.rsplit("/", 1)[-1]
    segredo = _estado()["leads"][-1]["token"]
    lead = {"source": "chat", "adId": v["codigo"], "listId": "123", "linkAd": "https://www.olx.com.br/vi/123", "name": "Comprador Teste",
            "email": "comprador@exemplo.com", "phone": "41988887777", "message": "Ainda está disponível?", "createdAt": "2026-10-17T10:00:00Z",
            "externalId": "lead-olx-1"}
    assert httpx.post(f"{API}{caminho}", json=lead, headers={"Authorization": "errado"}).status_code == 401
    r = httpx.post(f"{API}{caminho}", json=lead, headers={"Authorization": segredo})
    assert r.status_code == 200 and r.json()["responseId"]
    assert httpx.post(f"{API}{caminho}", json=lead, headers={"Authorization": segredo}).json()["duplicado"] is True
    e = next(x for x in loja.get("/entradas").json() if x["nome"] == "Comprador Teste")
    assert e["origem"] == "OLX" and e["veiculo_id"] == v["id"] and "Ainda está disponível?" in e["mensagem"]
    assert httpx.post(f"{API}/publico/olx/leads/token-que-nao-existe-com-mais-de-vinte", json=lead).status_code == 404


def test_so_loja_de_veiculos_e_so_gestor(loja, cartao_demo):  # noqa: F811
    imob, _ = _cadastrar("imobiliaria", cartao_demo)
    assert imob.get("/olx").status_code in (403, 404)  # sem módulo de veículos
    loja.post("/olx/desconectar")
    s = loja.get("/olx").json()
    assert s["conectado"] is False and s["leads_ligados"] is False
    assert loja.post("/olx/sincronizar").status_code == 409
