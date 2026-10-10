"""Ponta a ponta dos segmentos: cadastro com cartão de demonstração, agenda online sem conflito,
prontuário restrito, plano de tratamento no funil, estoque de veículos no site, painel por segmento,
webhook do Asaas e bloqueio por atraso.

Precisa da API local (dev) e de CRM_SYSADMIN/CRM_SYSADMIN_SENHA. Cria empresas de teste.
"""

import os
import uuid
from datetime import date, timedelta

import httpx
import pytest

API = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
SYSADMIN = (os.environ.get("CRM_SYSADMIN"), os.environ.get("CRM_SYSADMIN_SENHA"))


def _cpf() -> str:
    import random

    n = [random.randint(0, 9) for _ in range(9)]
    for k in (10, 11):
        s = sum(d * (k - i) for i, d in enumerate(n)) % 11
        n.append(0 if s < 2 else 11 - s)
    return "".join(map(str, n))


@pytest.fixture(scope="module")
def sysadmin():
    if not all(SYSADMIN):
        pytest.skip("credenciais de teste não informadas")
    c = httpx.Client(base_url=API, timeout=60)
    try:
        r = c.post("/auth/login", json={"email": SYSADMIN[0], "senha": SYSADMIN[1]})
    except httpx.HTTPError:
        pytest.skip("API indisponível")
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="module")
def cartao_demo(sysadmin):
    r = sysadmin.post("/plataforma/cartao-demo")
    assert r.status_code == 200, r.text
    return r.json()["cartao_demo"]


def _cadastrar(segmento: str, cartao: str, plano: str | None = None, periodicidade: str = "mensal") -> tuple[httpx.Client, dict]:
    opcoes = httpx.get(f"{API}/publico/cadastro/opcoes").json()
    plano = plano or ("enterprise" if segmento == "imobiliaria" else f"{segmento}_enterprise")
    assert any(p["chave"] == plano for p in opcoes["planos"][segmento])
    c = httpx.Client(base_url=API, timeout=60)
    email = f"teste.{segmento}.{uuid.uuid4().hex[:6]}@exemplo.com"
    corpo = {"chave": uuid.uuid4().hex, "segmento": segmento, "plano": plano, "periodicidade": periodicidade,
             "empresa_nome": f"Teste {segmento} {uuid.uuid4().hex[:4]}", "documento": _cpf(), "nome": "Dona Teste",
             "email": email, "telefone": "41999998888", "senha": "senha-muito-forte-1", "cep": "80000000",
             "numero_endereco": "100", "aceite": True,
             "cartao": {"numero": cartao, "nome": "DONA TESTE", "validade": "12/30", "cvv": "123"}}
    r = c.post("/publico/cadastro", json=corpo)
    assert r.status_code == 201, r.text
    return c, {**corpo, "email": email}


def test_opcoes_tem_seis_segmentos_e_planos():
    o = httpx.get(f"{API}/publico/cadastro/opcoes").json()
    chaves = {s["chave"] for s in o["segmentos"]}
    assert chaves == {"imobiliaria", "veiculos", "odontologia", "terapia", "barbearia", "estetica"}
    assert all(len(o["planos"][k]) >= 4 for k in chaves)
    assert o["planos"]["barbearia"][0]["preco_mensal"] < o["planos"]["imobiliaria"][0]["preco_mensal"]


def test_cartao_invalido_nao_cobra_nem_ecoa_numero():
    corpo = {"chave": uuid.uuid4().hex, "segmento": "barbearia", "plano": "barbearia_essencial", "empresa_nome": "X Barbearia",
             "documento": _cpf(), "nome": "Fulano Teste", "email": f"x{uuid.uuid4().hex[:5]}@exemplo.com", "telefone": "41999998888",
             "senha": "senha-muito-forte-1", "cep": "80000000", "numero_endereco": "1", "aceite": True,
             "cartao": {"numero": "4111111111111112", "nome": "FULANO", "validade": "12/30", "cvv": "123"}}
    r = httpx.post(f"{API}/publico/cadastro", json=corpo)
    assert r.status_code == 422 and "4111" not in r.text
    corpo["cartao"]["numero"] = "abc"
    corpo["chave"] = uuid.uuid4().hex
    r = httpx.post(f"{API}/publico/cadastro", json={**corpo, "email": "invalido"})
    assert r.status_code == 422 and "abc" not in r.text


def test_cadastro_demo_cada_segmento_entra_logado(cartao_demo):
    for seg in ("barbearia", "terapia", "odontologia", "estetica", "veiculos", "imobiliaria"):
        c, _ = _cadastrar(seg, cartao_demo)
        me = c.get("/auth/me").json()
        assert me["segmento"] == seg and me["assinatura"]["demo"] is True and me["bloqueio"] is None
        cfg = c.get("/configuracoes/publica").json()
        assert cfg["segmento"]["chave"] == seg


def test_agenda_online_sem_conflito_e_conclusao_no_caixa(cartao_demo):
    c, _ = _cadastrar("barbearia", cartao_demo)
    me = c.get("/auth/me").json()
    servicos = c.get("/atendimentos/servicos").json()
    corte = next(s for s in servicos if s["nome"] == "Corte")
    jornada = {str(d): [["08:00", "20:00"]] for d in range(7)}
    assert c.put(f"/atendimentos/profissionais/{me['usuario_id']}", json={"atende": True, "jornada": jornada, "comissao_pct": 0}).status_code == 200
    slug = f"barb-{uuid.uuid4().hex[:6]}"
    r = c.put("/atendimentos/config", json={"ativo": True, "slug": slug, "antecedencia_min": 0, "intervalo_min": 30})
    assert r.status_code == 200, r.text
    pagina = httpx.get(f"{API}/publico/agenda/{slug}").json()
    assert any(s["id"] == corte["id"] for s in pagina["servicos"])
    amanha = (date.today() + timedelta(days=1)).isoformat()
    hs = httpx.get(f"{API}/publico/agenda/{slug}/horarios", params={"servico_id": corte["id"], "data": amanha}).json()["horarios"]
    hora = hs[2]["hora"]
    reserva = {"servico_id": corte["id"], "data": amanha, "inicio": hora, "nome": "Cliente Online", "telefone": "41988887777"}
    r1 = httpx.post(f"{API}/publico/agenda/{slug}/reservar", json=reserva)
    assert r1.status_code == 201, r1.text
    r2 = httpx.post(f"{API}/publico/agenda/{slug}/reservar", json={**reserva, "nome": "Outro", "telefone": "41977776666"})
    assert r2.status_code == 409  # mesmo profissional, mesmo horário
    hs2 = [h["hora"] for h in httpx.get(f"{API}/publico/agenda/{slug}/horarios", params={"servico_id": corte["id"], "data": amanha}).json()["horarios"]]
    assert hora not in hs2
    ags = c.get("/atendimentos", params={"inicio": amanha, "fim": amanha}).json()
    assert len(ags) == 1 and ags[0]["origem"] == "online"
    fim = c.post(f"/atendimentos/{ags[0]['id']}/concluir", json={"valor": 45, "forma_pagamento": "pix"})
    assert fim.status_code == 200, fim.text
    tx = [t for t in c.get("/transacoes").json() if t.get("descricao", "").startswith("Corte")]
    assert tx and tx[0]["status"] == "pago" and tx[0]["valor"] == 45
    # cancelar pelo link libera o horário (antes de concluir; aqui nova reserva)
    r3 = httpx.post(f"{API}/publico/agenda/{slug}/reservar", json={**reserva, "inicio": hs[5]["hora"], "telefone": "41966665555", "nome": "Cancela"})
    tok = r3.json()["token"]
    assert httpx.post(f"{API}/publico/agenda/{slug}/reserva/{tok}/cancelar").status_code == 200
    hs3 = [h["hora"] for h in httpx.get(f"{API}/publico/agenda/{slug}/horarios", params={"servico_id": corte["id"], "data": amanha}).json()["horarios"]]
    assert hs[5]["hora"] in hs3


def test_prontuario_restrito_e_tratamento_no_funil(cartao_demo):
    c, _ = _cadastrar("odontologia", cartao_demo)
    p = c.post("/pacientes", json={"nome": "Paciente Teste", "telefone": "41955554444", "cpf_cnpj": _cpf()})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]
    assert c.post(f"/pacientes/{pid}/prontuario", json={"texto": "Queixa: dor no 36"}).status_code == 201
    assert len(c.get(f"/pacientes/{pid}/prontuario").json()) == 1
    assert c.put(f"/pacientes/{pid}/odontograma/36", json={"estado": "carie", "faces": {"O": "carie"}}).status_code == 200
    assert c.put(f"/pacientes/{pid}/odontograma/99", json={"estado": "carie"}).status_code == 422
    t = c.post(f"/pacientes/{pid}/tratamentos", json={"tipo": "odonto", "titulo": "Plano inicial", "parcelas": 3, "itens": [
        {"descricao": "Restauração em resina", "dente": "36", "faces": ["O"], "valor_unitario": 250},
        {"descricao": "Tratamento de canal", "dente": "46", "valor_unitario": 900}]})
    assert t.status_code == 201, t.text
    tid = t.json()["id"]
    assert t.json()["total"] == 1150
    ap = c.post(f"/pacientes/{pid}/tratamentos/{tid}/acao", json={"acao": "apresentar"}).json()
    assert ap["status"] == "apresentado" and ap["negocio_id"]
    ok = c.post(f"/pacientes/{pid}/tratamentos/{tid}/acao", json={"acao": "aprovar"}).json()
    assert ok["status"] == "aprovado"
    parcelas = [x for x in c.get("/transacoes").json() if x.get("pessoa_id") == pid]
    assert len(parcelas) == 3 and round(sum(x["valor"] for x in parcelas), 2) == 1150
    negocio = c.get(f"/leads/{ap['negocio_id']}").json()
    assert negocio["negocio"]["status"] == "ganho"
    item = ok["itens"][0]["id"]
    assert c.post(f"/pacientes/{pid}/tratamentos/{tid}/itens/{item}/realizar").status_code == 200
    ficha = c.get(f"/pacientes/{pid}").json()
    assert ficha["odontograma"]["36"]["estado"] == "restaurado"


def test_veiculos_estoque_site_e_venda(cartao_demo):
    c, _ = _cadastrar("veiculos", cartao_demo)
    v = c.post("/veiculos", json={"marca": "Volkswagen", "modelo": "Polo", "versao": "Highline 1.0 TSI", "ano_fabricacao": 2022,
                                  "ano_modelo": 2023, "km": 32000, "placa": "abc1d23", "preco_venda": 98900, "custo_aquisicao": 82000,
                                  "despesas": [{"descricao": "Polimento", "valor": 600}], "site_status": "ativo"})
    assert v.status_code == 201, v.text
    vid = v.json()["id"]
    assert v.json()["margem"] == 98900 - 82600 and v.json()["placa"] == "ABC1D23"
    assert c.post("/veiculos", json={"marca": "VW", "modelo": "Gol", "ano_fabricacao": 2020, "ano_modelo": 2020, "placa": "ABC1D23"}).status_code == 409
    slug = f"loja-{uuid.uuid4().hex[:6]}"
    assert c.put("/site-imobiliaria", json={"ativo": True, "slug": slug, "nome": "Loja Teste", "whatsapp": "41999990000"}).status_code == 200
    pub = httpx.get(f"{API}/publico/site/{slug}").json()
    assert pub["marca"]["segmento"] == "veiculos" and pub["imoveis"][0]["titulo"].startswith("Volkswagen Polo")
    assert "placa" not in pub["imoveis"][0] and "custo_aquisicao" not in pub["imoveis"][0]
    ct = httpx.post(f"{API}/publico/site/{slug}/contato", json={"nome": "Comprador", "telefone": "41988887777", "imovel_id": vid})
    assert ct.status_code == 201
    entrada = next(e for e in c.get("/entradas").json() if e["origem"] == "Site")
    assert entrada["veiculo_id"] == vid
    venda = c.post(f"/veiculos/{vid}/vender", json={"valor": 97000})
    assert venda.status_code == 200 and venda.json()["status"] == "vendido"
    assert httpx.get(f"{API}/publico/site/{slug}/imovel/{v.json()['codigo']}").status_code == 404


def test_painel_por_segmento_e_isolamento(sysadmin, cartao_demo):
    a, _ = _cadastrar("estetica", cartao_demo)
    b, _ = _cadastrar("estetica", cartao_demo)
    pa = a.post("/pacientes", json={"nome": "Cliente A"}).json()
    assert b.get(f"/pacientes/{pa['id']}").status_code == 404  # outra empresa não enxerga
    painel = sysadmin.get("/plataforma/painel").json()
    beleza = next(c for c in painel["categorias"] if c["categoria"] == "beleza")
    est = next(s for s in beleza["segmentos"] if s["segmento"] == "estetica")
    assert est["ativas"] >= 2 and est["demonstracao"] >= 2


def test_webhook_asaas_exige_token_e_e_idempotente(sysadmin):
    pag = sysadmin.get("/plataforma/pagamentos").json()
    assert httpx.post(f"{API}/webhooks/asaas", json={"id": "evt_x", "event": "PAYMENT_CONFIRMED"}).status_code == 401
    h = {"asaas-access-token": pag["webhook_token"]}
    corpo = {"id": f"evt_{uuid.uuid4().hex}", "event": "PAYMENT_OVERDUE", "payment": {"id": "pay_1", "subscription": "sub_inexistente"}}
    assert httpx.post(f"{API}/webhooks/asaas", json=corpo, headers=h).json()["ignorado"] is True
    assert httpx.post(f"{API}/webhooks/asaas", json=corpo, headers=h).json()["duplicado"] is True


def test_planos_do_segmento_e_troca(cartao_demo):
    c, dados = _cadastrar("terapia", cartao_demo, plano="terapia_essencial")
    a = c.get("/assinatura").json()
    assert a["plano"]["chave"] == "terapia_essencial" and all(p["chave"].startswith("terapia_") for p in a["planos"])
    assert c.post("/assinatura/plano", json={"plano": "barbearia_business"}).status_code == 422
    assert c.post("/assinatura/plano", json={"plano": "terapia_profissional", "periodicidade": "anual"}).status_code == 200
    assert c.get("/plano").json()["chave"] == "terapia_profissional"
    # limite de unidades do Essencial/Profissional = 1
    assert c.post("/unidades", json={"nome": "Filial"}).status_code == 402
