"""Site próprio em todos os segmentos: catálogo de serviços, tratamentos e produtos, cor da barra do
topo e página pública. Ponta a ponta, precisa da API local como test_segmentos.py."""

import base64
import io
import os
import uuid

import httpx

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)


def _plano_inicial(segmento: str) -> str:
    return httpx.get(f"{API}/publico/cadastro/opcoes").json()["planos"][segmento][0]["chave"]


def _png() -> str:
    # 1x1 PNG
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def test_barbearia_no_plano_inicial_cria_site_com_catalogo(cartao_demo):
    c, _ = _cadastrar("barbearia", cartao_demo, plano=_plano_inicial("barbearia"))
    p = c.get("/site-imobiliaria").json()
    assert p["liberado"] is True and p["segmento"] == "barbearia" and p["tem_estoque"] is False
    assert p["config"]["titulo"] != "Encontre o imóvel certo para você" and p["titulo_catalogo_padrao"] == "Serviços"

    # Serviços da agenda entram no catálogo uma vez só.
    r1 = c.post("/site-imobiliaria/itens/importar").json()
    assert r1["importados"] >= 1
    assert c.post("/site-imobiliaria/itens/importar").json()["importados"] == 0

    prod = c.post("/site-imobiliaria/itens", json={"tipo": "produto", "nome": "Pomada modeladora", "preco": 49.9, "categoria": "Produtos"})
    assert prod.status_code == 201, prod.text
    assert c.post("/site-imobiliaria/itens", json={"tipo": "produto", "nome": "X", "preco": -1}).status_code == 422
    foto = c.put(f"/site-imobiliaria/itens/{prod.json()['id']}/foto", json={"base64": _png(), "mime": "image/png"})
    assert foto.status_code == 200 and foto.json()["tem_foto"] is True
    oculto = c.post("/site-imobiliaria/itens", json={"tipo": "servico", "nome": "Serviço escondido", "ativo": False}).json()

    slug = f"barb-{uuid.uuid4().hex[:6]}"
    base = {**{k: v for k, v in p["config"].items() if k not in ("tem_logo", "tem_capa", "midia_v", "atualizado_em", "atualizado_por")},
            "slug": slug, "nome": "Barbearia Teste", "whatsapp": "41999998888", "ativo": True}
    assert c.put("/site-imobiliaria", json={**base, "cor_cabecalho": "preto"}).status_code == 422
    ok = c.put("/site-imobiliaria", json={**base, "cor_cabecalho": "#111111", "cor_texto_cabecalho": "#ffffff", "layout_catalogo": "lista"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["config"]["cor_cabecalho"] == "#111111"

    pub = httpx.get(f"{API}/publico/site/{slug}").json()
    assert pub["marca"]["cor_cabecalho"] == "#111111" and pub["marca"]["cor_texto_cabecalho"] == "#ffffff"
    assert pub["marca"]["segmento"] == "barbearia" and pub["marca"]["formulario"] is False and pub["imoveis"] == []
    nomes = {i["nome"] for i in pub["itens"]}
    assert "Pomada modeladora" in nomes and "Serviço escondido" not in nomes
    pomada = next(i for i in pub["itens"] if i["nome"] == "Pomada modeladora")
    assert pomada["foto_url"] and httpx.get(API.replace("/api", "") + pomada["foto_url"]).status_code == 200
    # Barbearia não tem caixa de leads: contato é pelo WhatsApp.
    assert httpx.post(f"{API}/publico/site/{slug}/contato", json={"nome": "Cliente", "telefone": "41988887777"}).status_code == 409

    assert c.delete(f"/site-imobiliaria/itens/{oculto['id']}").status_code == 204


def test_odonto_contato_pelo_tratamento_vira_lead(cartao_demo):
    c, _ = _cadastrar("odontologia", cartao_demo, plano=_plano_inicial("odontologia"))
    p = c.get("/site-imobiliaria").json()
    assert p["tipo_padrao"] == "tratamento" and p["titulo_catalogo_padrao"] == "Tratamentos"
    item = c.post("/site-imobiliaria/itens", json={"tipo": "tratamento", "nome": "Clareamento dental", "preco": 900, "preco_a_partir": True}).json()
    slug = f"odo-{uuid.uuid4().hex[:6]}"
    base = {**{k: v for k, v in p["config"].items() if k not in ("tem_logo", "tem_capa", "midia_v", "atualizado_em", "atualizado_por")},
            "slug": slug, "nome": "Clínica Teste", "whatsapp": "41999998888", "ativo": True, "mostrar_precos": False}
    assert c.put("/site-imobiliaria", json=base).status_code == 200
    pub = httpx.get(f"{API}/publico/site/{slug}").json()
    assert pub["itens"][0]["preco"] is None  # preços escondidos
    r = httpx.post(f"{API}/publico/site/{slug}/contato", json={"nome": "Paciente Site", "telefone": "41988887777", "item_id": item["id"]})
    assert r.status_code == 201, r.text
    entradas = c.get("/entradas").json()
    assert any("Clareamento dental" in (e.get("mensagem") or "") and e["origem"] == "Site" for e in entradas)


def test_corretor_nao_edita_catalogo():
    c = httpx.Client(base_url=API, timeout=30)
    assert c.post("/auth/login", json={"email": os.environ["CRM_CORRETOR"], "senha": os.environ["CRM_CORRETOR_SENHA"]}).status_code == 200
    assert c.post("/site-imobiliaria/itens", json={"tipo": "servico", "nome": "Avaliação de imóvel"}).status_code == 403
