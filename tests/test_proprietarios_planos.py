"""Ponta a ponta: proprietários (PF/PJ, vínculo, ficha financeira) e catálogo comercial (planos/adicionais).

Mesmas variáveis de test_crm_pipedrive.py, mais CRM_SYSADMIN/CRM_SYSADMIN_SENHA para o catálogo.
Cria registros de teste: não rode em produção.
"""

import os
import uuid
from datetime import date

import httpx
import pytest

API = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
ADMIN = (os.environ.get("CRM_ADMIN"), os.environ.get("CRM_ADMIN_SENHA"))
CORRETOR = (os.environ.get("CRM_CORRETOR"), os.environ.get("CRM_CORRETOR_SENHA"))
SYSADMIN = (os.environ.get("CRM_SYSADMIN"), os.environ.get("CRM_SYSADMIN_SENHA"))


def _login(cred):
    if not all(cred):
        pytest.skip("credenciais de teste não informadas")
    c = httpx.Client(base_url=API, timeout=30)
    try:
        r = c.post("/auth/login", json={"email": cred[0], "senha": cred[1]})
    except httpx.HTTPError:
        pytest.skip("API indisponível")
    assert r.status_code == 200, r.text
    return c


def _cpf() -> str:
    import random

    n = [random.randint(0, 9) for _ in range(9)]
    for k in (10, 11):
        s = sum(d * (k - i) for i, d in enumerate(n)) % 11
        n.append(0 if s < 2 else 11 - s)
    return "".join(map(str, n))


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def corretor():
    return _login(CORRETOR)


def test_proprietario_pf_pj_documento_e_duplicidade(admin):
    assert admin.post("/proprietarios", json={"nome": "CPF errado", "cpf_cnpj": "123.456.789-00"}).status_code == 422
    cpf = _cpf()
    pf = admin.post("/proprietarios", json={"nome": "Dona Teste PF", "tipo_pessoa": "pf", "cpf_cnpj": cpf, "estado": "pr", "pix": "chave@pix"})
    assert pf.status_code == 201, pf.text
    assert pf.json()["papeis"] == ["proprietario"] and pf.json()["estado"] == "PR" and "." in pf.json()["cpf_cnpj"]
    assert admin.post("/proprietarios", json={"nome": "Mesmo CPF", "cpf_cnpj": cpf}).status_code == 409
    pj = admin.post("/proprietarios", json={"nome": "Alfa Teste LTDA", "tipo_pessoa": "pj", "cpf_cnpj": "11.222.333/0001-81"})
    assert pj.status_code in (201, 409)  # 409 se outro teste já criou este CNPJ
    assert admin.post("/proprietarios", json={"nome": "PJ com CPF", "tipo_pessoa": "pj", "cpf_cnpj": cpf}).status_code == 422


def test_ficha_do_proprietario_com_locacao(admin, corretor):
    dono = admin.post("/proprietarios", json={"nome": f"Dono Locação {uuid.uuid4().hex[:5]}"}).json()
    im = admin.post("/imoveis", json={"titulo": "Apto locação teste", "tipo": "apartamento", "finalidade": "locacao", "status": "alugado",
                                      "endereco": "Rua X, 1", "cidade": "Curitiba", "valor_aluguel": 2000, "proprietario_id": dono["id"]})
    assert im.status_code == 201, im.text
    inquilino = admin.post("/pessoas", json={"nome": "Inquilino Teste", "papeis": ["cliente"]}).json()
    hoje = date.today()
    ct = admin.post("/contratos", json={"tipo": "locacao", "imovel_id": im.json()["id"], "cliente_id": inquilino["id"], "valor": 2000,
                                        "taxa_admin_pct": 10, "comissao_pct": 50, "inicio": hoje.isoformat(),
                                        "fim": date(hoje.year + 1, hoje.month, min(hoje.day, 28)).isoformat()})
    assert ct.status_code == 201, ct.text
    parcelas = [t for t in admin.get("/transacoes").json() if t.get("contrato_id") == ct.json()["id"]]
    taxa = next(t for t in parcelas if "administração" in t["descricao"])
    assert admin.patch(f"/transacoes/{taxa['id']}", json={"status": "pago", "pagamento": hoje.isoformat()}).status_code == 200
    f = admin.get(f"/proprietarios/{dono['id']}").json()
    item = f["imoveis"][0]
    assert item["locacao"]["meses_pagos"] == 1 and item["locacao"]["inquilino"] == "Inquilino Teste"
    assert item["aluguel_recebido"] == 2000 and item["lucro_imobiliaria"] == 200
    assert f["totais"]["aluguel_recebido"] == 2000 and f["totais"]["lucro_imobiliaria"] == 200
    # corretor vê os imóveis do proprietário, mas não os números da imobiliária
    fc = corretor.get(f"/proprietarios/{dono['id']}").json()
    assert fc["totais"] is None and fc["imoveis"][0]["lucro_imobiliaria"] is None
    # corretor consegue usar o proprietário ao cadastrar imóvel
    r = corretor.post("/imoveis", json={"titulo": "Casa do mesmo dono", "tipo": "casa", "finalidade": "venda", "endereco": "Rua Y",
                                        "cidade": "Curitiba", "proprietario_id": dono["id"]})
    assert r.status_code == 201, r.text


def test_vincular_e_desvincular_imovel(admin):
    dono = admin.post("/proprietarios", json={"nome": f"Dono Vínculo {uuid.uuid4().hex[:5]}"}).json()
    im = admin.post("/imoveis", json={"titulo": "Sem dono", "tipo": "terreno", "finalidade": "venda", "endereco": "Rua Z", "cidade": "Curitiba"}).json()
    assert admin.put(f"/proprietarios/{dono['id']}/imoveis/{im['id']}").status_code == 204
    lista = {p["id"]: p for p in admin.get("/proprietarios").json()}
    assert lista[dono["id"]]["qtd_imoveis"] == 1
    assert admin.delete(f"/proprietarios/{dono['id']}/imoveis/{im['id']}").status_code == 204
    assert admin.get(f"/proprietarios/{dono['id']}").json()["imoveis"] == []


def test_relatorio_proprietario_mostra_publicado(admin):
    im = admin.post("/imoveis", json={"titulo": "Publicado sem portal", "tipo": "casa", "finalidade": "venda", "status": "publicado",
                                      "endereco": "Rua P", "cidade": "Curitiba", "publicar_portais": False}).json()
    link = admin.post(f"/imoveis/{im['id']}/relatorio-proprietario")
    if link.status_code == 402:
        pytest.skip("plano da empresa de teste sem relatório do proprietário")
    token = link.json()["url"].rstrip("/").split("/")[-1]
    rel = httpx.get(f"{API}/publico/proprietario/{token}").json()
    assert rel["situacao_anuncio"] == "publicado"


def test_catalogo_planos_adicionais_e_condicoes():
    s = _login(SYSADMIN)
    nome = f"Plano Teste {uuid.uuid4().hex[:4]}"
    p = s.post("/planos", json={"nome": nome, "preco_mensal": 150, "preco_anual": 1500, "usuarios": 2, "imoveis": 50,
                                "modulos": ["imoveis", "crm"], "recursos": ["chat"]})
    assert p.status_code == 201, p.text
    chave = p.json()["chave"]
    assert "dashboard" in p.json()["modulos"]
    ad = s.post("/adicionais", json={"nome": f"Usuários extra {uuid.uuid4().hex[:4]}", "tipo": "usuarios", "quantidade_por_unidade": 3, "preco_mensal": 30})
    assert ad.status_code == 201, ad.text
    assert s.post("/adicionais", json={"nome": "Sem recurso", "tipo": "recurso", "preco_mensal": 1}).status_code == 422
    empresas = s.get("/empresas").json()
    alvo = next((e for e in empresas if e["slug"].startswith("teste")), None) or s.post(
        "/empresas", json={"nome": f"Teste Comercial {uuid.uuid4().hex[:4]}", "admin_nome": "Gestor", "admin_email": f"g{uuid.uuid4().hex[:6]}@teste.com",
                           "admin_senha": "senha-forte-123", "enviar_convite": False}).json()
    assert s.patch(f"/empresas/{alvo['id']}", json={"plano": chave}).status_code == 200
    r = s.put(f"/empresas/{alvo['id']}/comercial", json={"periodicidade": "anual", "adicionais": [{"chave": ad.json()["chave"], "quantidade": 2}],
                                                         "desconto_tipo": "valor", "desconto_valor": 100, "taxa_instalacao": 0})
    assert r.status_code == 200, r.text
    v = r.json()["valores"]
    assert v["subtotal"] == 1500 + 2 * 30 * 12 and v["total"] == v["subtotal"] - 100 and v["taxa_instalacao"] == 0
    assert r.json()["limite_usuarios"] == 2 + 6
    assert s.delete(f"/planos/{chave}").status_code == 409  # em uso: desativar, não excluir
    assert _login(ADMIN).post("/planos", json={"nome": "Hacker", "preco_mensal": 0}).status_code == 403


def test_site_da_imobiliaria(admin, corretor):
    slug = f"teste-{uuid.uuid4().hex[:6]}"
    r = admin.put("/site-imobiliaria", json={"ativo": True, "slug": slug, "nome": "Imobiliária Teste", "whatsapp": "(41) 99999-0000"})
    if r.status_code == 402:
        pytest.skip("plano da empresa de teste sem site")
    assert r.status_code == 200, r.text
    assert admin.put("/site-imobiliaria", json={"slug": "Com Espaço", "nome": "X"}).status_code == 422
    im = admin.post("/imoveis", json={"titulo": "Casa do site", "tipo": "casa", "finalidade": "venda", "endereco": "Rua S, 10",
                                      "cidade": "Curitiba", "valor_venda": 500000}).json()
    # só gestor ou quem ele liberou mexe no site
    assert corretor.put("/site-imobiliaria/imoveis", json={"ids": [im["id"]], "site_status": "ativo"}).status_code == 403
    assert corretor.put(f"/imoveis/{im['id']}", json={"site_status": "ativo"}).status_code == 403
    assert admin.put("/site-imobiliaria/imoveis", json={"ids": [im["id"]], "site_status": "reservado"}).status_code == 204
    pub = httpx.get(f"{API}/publico/site/{slug}").json()
    item = next(i for i in pub["imoveis"] if i["id"] == im["id"])
    assert item["reservado"] is True and "endereco" not in item
    det = httpx.get(f"{API}/publico/site/{slug}/imovel/{im['codigo']}")
    assert det.status_code == 200
    ct = httpx.post(f"{API}/publico/site/{slug}/contato", json={"nome": "Visitante", "telefone": "41988887777", "imovel_id": im["id"]})
    assert ct.status_code == 201
    assert any(e["origem"] == "Site" and e["imovel_id"] == im["id"] for e in admin.get("/entradas").json())
    # inativo some do site; site fora do ar responde 404
    admin.put("/site-imobiliaria/imoveis", json={"ids": [im["id"]], "site_status": "inativo"})
    assert httpx.get(f"{API}/publico/site/{slug}/imovel/{im['codigo']}").status_code == 404
    admin.put("/site-imobiliaria", json={"ativo": False, "slug": slug, "nome": "Imobiliária Teste"})
    assert httpx.get(f"{API}/publico/site/{slug}").status_code == 404
