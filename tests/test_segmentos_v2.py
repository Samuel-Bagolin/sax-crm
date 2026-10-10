"""Ponta a ponta das melhorias por segmento: ocupação das cadeiras, clube de assinantes da barbearia,
orçamento direto da odontologia (cria lead quando a pessoa não existe), negócio de veículo e fila
livre de leads com disputa pelo mesmo lead. Precisa da API local, como test_segmentos.py."""

import uuid
from datetime import date, timedelta

import httpx

from test_segmentos import API, _cadastrar, _cpf, cartao_demo, sysadmin  # noqa: F401  (fixtures)


def _barbeiro_atendendo(c: httpx.Client) -> dict:
    me = c.get("/auth/me").json()
    jornada = {str(d): [["07:00", "22:00"]] for d in range(7)}
    assert c.put(f"/atendimentos/profissionais/{me['usuario_id']}", json={"atende": True, "jornada": jornada, "comissao_pct": 0}).status_code == 200
    return me


def test_ocupacao_e_clube_de_assinantes(cartao_demo):
    c, _ = _cadastrar("barbearia", cartao_demo)
    me = _barbeiro_atendendo(c)
    uni = c.get("/unidades").json()[0]
    assert c.put(f"/unidades/{uni['id']}", json={"nome": uni["nome"], "cadeiras": 3, "ativa": True}).status_code == 200
    oc = c.get("/atendimentos/ocupacao").json()
    u = oc["unidades"][0]
    assert u["cadeiras"] == 3 and len(u["postos"]) == 3 and u["cadeiras_definidas"]

    corte = next(s for s in c.get("/atendimentos/servicos").json() if s["nome"] == "Corte")
    plano = c.post("/clube/planos", json={"nome": "Corte ilimitado", "valor_mensal": 99.9, "servico_ids": [corte["id"]]})
    assert plano.status_code == 201, plano.text
    cli = c.post("/pacientes", json={"nome": "Assinante Teste", "telefone": "41912345678"}).json()
    a = c.post("/clube/assinantes", json={"cliente_id": cli["id"], "plano_id": plano.json()["id"]})
    assert a.status_code == 201, a.text
    assert c.post("/clube/assinantes", json={"cliente_id": cli["id"], "plano_id": plano.json()["id"]}).status_code == 409

    hoje = date.today().isoformat()
    ag = c.post("/atendimentos", json={"profissional_id": me["usuario_id"], "servico_ids": [corte["id"]], "data": hoje, "inicio": "07:30",
                                       "cliente_id": cli["id"]}).json()["criados"][0]
    info = c.get(f"/clube/cliente/{cli['id']}").json()
    assert info and info["usos_mes"] == 0
    fim = c.post(f"/atendimentos/{ag['id']}/concluir", json={"valor": 45, "forma_pagamento": "assinatura"})
    assert fim.status_code == 200, fim.text
    assert fim.json()["valor_cobrado"] == 0 and fim.json()["pelo_clube"] is True
    assert c.get(f"/clube/cliente/{cli['id']}").json()["usos_mes"] == 1

    painel = c.get("/clube/painel").json()
    linha = next(x for x in painel["assinantes"] if x["cliente_id"] == cli["id"])
    assert linha["visitas_mes"] == 1 and linha["consumido_tabela"] == corte["preco"]
    assert painel["resumo"]["ativos"] == 1 and painel["resumo"]["receita_mensal"] == 99.9

    m1 = c.post("/clube/mensalidades", json={}).json()
    m2 = c.post("/clube/mensalidades", json={}).json()
    assert m1["lancadas"] == 1 and m2["lancadas"] == 0 and m2["ja_existiam"] == 1

    # Quem não é assinante não conclui como assinatura.
    outro = c.post("/pacientes", json={"nome": "Avulso Teste", "telefone": "41912340000"}).json()
    ag2 = c.post("/atendimentos", json={"profissional_id": me["usuario_id"], "servico_ids": [corte["id"]], "data": hoje, "inicio": "08:30",
                                        "cliente_id": outro["id"]}).json()["criados"][0]
    assert c.post(f"/atendimentos/{ag2['id']}/concluir", json={"valor": 45, "forma_pagamento": "assinatura"}).status_code == 409


def test_orcamento_direto_cria_paciente_e_lead(cartao_demo):
    c, _ = _cadastrar("odontologia", cartao_demo)
    cpf = _cpf()
    r = c.post("/pacientes/orcamentos/paciente", json={"nome": "Pessoa Nova Orcamento", "telefone": "41987654321", "cpf_cnpj": cpf})
    assert r.status_code == 201, r.text
    assert r.json()["lead_criado"] is True
    pid = r.json()["paciente"]["id"]
    lead = next(e for e in c.get("/entradas").json() if e.get("cliente_id") == pid)
    assert lead["origem"] == "Orçamento"
    # Mesmo CPF de novo: usa o cadastro existente, sem duplicar.
    de_novo = c.post("/pacientes/orcamentos/paciente", json={"nome": "Outro Nome", "cpf_cnpj": cpf}).json()
    assert de_novo["ja_existia"] is True and de_novo["paciente"]["id"] == pid
    achados = c.get("/pacientes/orcamentos/buscar", params={"q": cpf[:6]}).json()
    assert any(a["id"] == pid for a in achados)

    t = c.post(f"/pacientes/{pid}/tratamentos", json={"tipo": "odonto", "titulo": "Plano", "itens": [{"descricao": "Restauração", "dente": "11", "valor_unitario": 300}]})
    assert t.status_code == 201, t.text
    assert any(o["id"] == t.json()["id"] for o in c.get("/pacientes/orcamentos/lista").json())
    ap = c.post(f"/pacientes/{pid}/tratamentos/{t.json()['id']}/acao", json={"acao": "apresentar"}).json()
    conv = next(e for e in c.get("/entradas?status=todos").json() if e["id"] == lead["id"])
    assert conv["status"] == "convertido" and conv["negocio_id"] == ap["negocio_id"]

    # Lead que já estava na caixa de entrada vira paciente ao receber o orçamento.
    e = c.post("/entradas", json={"nome": "Lead Do Instagram", "telefone": "41955551111", "origem": "Instagram / Facebook Ads"}).json()
    r2 = c.post("/pacientes/orcamentos/paciente", json={"entrada_id": e["id"]}).json()
    assert r2["lead_criado"] is False
    assert next(x for x in c.get("/entradas").json() if x["id"] == e["id"])["cliente_id"] == r2["paciente"]["id"]


def test_negocio_de_veiculo_e_fila_livre(cartao_demo):
    c, _ = _cadastrar("veiculos", cartao_demo)
    v = c.post("/veiculos", json={"marca": "Fiat", "modelo": "Pulse", "ano_fabricacao": 2023, "ano_modelo": 2023, "preco_venda": 110000}).json()
    cli = c.post("/pessoas", json={"nome": "Comprador Pulse", "papeis": ["cliente"], "telefone": "41933332222"}).json()
    n = c.post("/leads", json={"nome": "Pulse do João", "cliente_id": cli["id"], "veiculo_id": v["id"], "valor_estimado": 110000})
    assert n.status_code == 201, n.text
    assert n.json()["veiculo_id"] == v["id"]
    kanban = c.get("/leads/kanban", params={"status": "aberto"}).json()
    cards = [x for col in (kanban.get("colunas") or kanban.get("etapas") or []) for x in (col.get("negocios") or col.get("itens") or [])] if isinstance(kanban, dict) else []
    if cards:
        assert any(x.get("imovel_titulo", "").startswith("Fiat Pulse") for x in cards)
    assert c.post("/leads", json={"nome": "X", "veiculo_id": "nao-existe"}).status_code == 422

    # Fila livre: o gestor manda o lead para a fila; dois vendedores disputam e só um fica.
    vendedores = []
    for i in (1, 2):
        email = f"vend{i}.{uuid.uuid4().hex[:5]}@exemplo.com"
        r = c.post("/usuarios", json={"nome": f"Vendedor {i}", "email": email, "senha": "SenhaForte#123", "papel": "corretor"})
        assert r.status_code == 201, r.text
        s = httpx.Client(base_url=API, timeout=60)
        assert s.post("/auth/login", json={"email": email, "senha": "SenhaForte#123"}).status_code == 200
        vendedores.append(s)
    e = c.post("/entradas", json={"nome": "Lead Disputado", "telefone": "41911110000"}).json()
    assert c.patch(f"/entradas/{e['id']}", json={"na_fila": True}).json()["na_fila"] is True
    assert any(x["id"] == e["id"] for x in vendedores[0].get("/entradas", params={"status": "fila"}).json())
    assert vendedores[0].get("/entradas/contagem").json()["fila"] >= 1
    p1 = vendedores[0].post(f"/entradas/{e['id']}/pegar")
    p2 = vendedores[1].post(f"/entradas/{e['id']}/pegar")
    assert p1.status_code == 200 and p2.status_code == 409
    assert not any(x["id"] == e["id"] for x in vendedores[1].get("/entradas").json())
    assert any(x["id"] == e["id"] for x in vendedores[0].get("/entradas").json())
    # Vendedor não manda lead para a fila sozinho.
    assert vendedores[0].patch(f"/entradas/{e['id']}", json={"na_fila": True}).json()["na_fila"] is False
    _ = timedelta  # noqa
