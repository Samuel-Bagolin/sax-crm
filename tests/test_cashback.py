"""Afiliados e cashback (vale em todas as lojas) e o balão de WhatsApp do site com os números de cada loja."""

import uuid

import httpx
import pytest

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401


@pytest.fixture(scope="module")
def loja(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("comercio", cartao_demo)
    lojas = [c.post("/unidades", json={"nome": n, "cidade": cid, "whatsapp": w, "ativa": True}).json()
             for n, cid, w in [("Loja Batel", "Curitiba", "41988880001"), ("Loja Asa Sul", "Brasília", "61988880002")]]
    return c, lojas


def test_programa_desligado_nao_registra(loja):
    c, _ = loja
    r = c.post("/cashback/compras", json={"nome": "Ana Teste", "telefone": "41977770000", "valor": 100})
    assert r.status_code == 409


def test_indicacao_cashback_em_outra_loja_e_estorno(loja):
    c, lojas = loja
    cfg = {"ativo": True, "pct_indicacao": 10, "compras_indicacao": 2, "pct_compra": 5, "validade_dias": 90, "max_pct_uso": 50,
           "autocadastro_site": True}
    assert c.put("/cashback/config", json=cfg).status_code == 200
    af = c.post("/cashback/afiliados", json={"nome": "Juliana Afiliada", "telefone": "41966660001"}).json()
    assert af["codigo"] and af["saldo"] == 0

    # 1ª compra do indicado em Curitiba: indicado ganha 5%, afiliada ganha 10%
    r = c.post("/cashback/compras", json={"nome": "Bruno Indicado", "telefone": "41955550001", "valor": 200,
                                         "unidade_id": lojas[0]["id"], "codigo_indicacao": af["codigo"].lower()})
    assert r.status_code == 201, r.text
    compra1 = r.json()
    assert compra1["cliente"]["saldo"] == 10 and compra1["afiliado_id"] == af["id"]
    assert c.get(f"/cashback/clientes/{af['id']}").json()["saldo"] == 20

    # código próprio é recusado; cliente antigo não troca de afiliado
    assert c.post("/cashback/compras", json={"cliente_id": af["id"], "valor": 10, "codigo_indicacao": af["codigo"]}).status_code == 422
    outro = c.post("/cashback/afiliados", json={"nome": "Outro Afiliado", "telefone": "41966660002"}).json()
    r2 = c.post("/cashback/compras", json={"cliente_id": compra1["cliente_id"], "valor": 100, "unidade_id": lojas[1]["id"],
                                          "codigo_indicacao": outro["codigo"]})
    assert r2.status_code == 201 and r2.json()["avisos"] and r2.json()["afiliado_id"] == af["id"]

    # 3ª compra do indicado não gera mais cashback para a afiliada (limite de 2)
    r3 = c.post("/cashback/compras", json={"cliente_id": compra1["cliente_id"], "valor": 100}).json()
    assert r3["afiliado_id"] is None
    assert c.get(f"/cashback/clientes/{af['id']}").json()["saldo"] == 30

    # afiliada usa o saldo em Brasília (outra loja): até 50% da compra e nunca mais que o saldo
    assert c.post("/cashback/compras", json={"cliente_id": af["id"], "valor": 40, "usar_cashback": 25,
                                             "unidade_id": lojas[1]["id"]}).status_code == 422
    assert c.post("/cashback/compras", json={"cliente_id": af["id"], "valor": 100, "usar_cashback": 31}).status_code == 422
    uso = c.post("/cashback/compras", json={"cliente_id": af["id"], "valor": 60, "usar_cashback": 30, "unidade_id": lojas[1]["id"]})
    assert uso.status_code == 201, uso.text
    assert uso.json()["valor_pago"] == 30 and uso.json()["cliente"]["saldo"] == 1.5  # 5% de 30 pagos

    # estorno devolve o que foi usado e cancela o gerado
    assert c.post(f"/cashback/compras/{uso.json()['id']}/estornar").status_code == 200
    assert c.get(f"/cashback/clientes/{af['id']}").json()["saldo"] == 30
    assert c.post(f"/cashback/compras/{uso.json()['id']}/estornar").status_code == 409
    res = c.get("/cashback/resumo").json()
    assert res["afiliados"] == 2 and res["top"][0]["codigo"] == af["codigo"]


def test_site_lojas_no_balao_e_indique_e_ganhe(loja):
    c, _ = loja
    p = c.get("/site-imobiliaria").json()
    slug = f"doce-{uuid.uuid4().hex[:6]}"
    base = {**{k: v for k, v in p["config"].items() if k not in ("tem_logo", "tem_capa", "midia_v", "atualizado_em", "atualizado_por", "dominio")},
            "slug": slug, "nome": "Doceria Teste", "whatsapp": "41999998888", "ativo": True}
    assert c.put("/site-imobiliaria", json=base).status_code == 200
    pub = httpx.get(f"{API}/publico/site/{slug}").json()["marca"]
    nomes = [x["nome"] for x in pub["contatos_whatsapp"]]
    assert "Loja Batel" in nomes and "Loja Asa Sul" in nomes
    assert pub["cashback"]["pct_indicacao"] == 10

    gerado = httpx.post(f"{API}/publico/site/{slug}/indicacao", json={"nome": "Carla Site", "telefone": "(41) 94444-0001"})
    assert gerado.status_code == 201 and gerado.json()["link"].endswith(f"?ref={gerado.json()['codigo']}")
    # o mesmo WhatsApp devolve o mesmo código, sem expor saldo
    de_novo = httpx.post(f"{API}/publico/site/{slug}/indicacao", json={"nome": "Carla", "telefone": "41944440001"}).json()
    assert de_novo["codigo"] == gerado.json()["codigo"] and "saldo" not in de_novo
    v = httpx.get(f"{API}/publico/site/{slug}/indicacao/{gerado.json()['codigo']}").json()
    assert v == {"valido": True, "codigo": gerado.json()["codigo"], "nome": "Carla"}
    assert httpx.get(f"{API}/publico/site/{slug}/indicacao/NADA-000").json() == {"valido": False}


def test_afiliados_so_no_restaurante(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("barbearia", cartao_demo)
    assert c.get("/cashback/config").status_code == 404
    assert c.get("/cashback/resumo").status_code == 404
