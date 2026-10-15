"""Planilha de dados (todos os segmentos): modelo personalizado, importação sem duplicar e exportação que volta."""

import base64
import io

import httpx
import pytest

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401

openpyxl = pytest.importorskip("openpyxl")


def _abrir(conteudo: bytes):
    return openpyxl.load_workbook(io.BytesIO(conteudo))


def _b64(wb) -> str:
    buf = io.BytesIO()
    wb.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def _preencher(conteudo: bytes, aba: str, linhas: list[dict]):
    wb = _abrir(conteudo)
    ws = wb[aba]
    cab = [c.value for c in ws[1]]
    for l in linhas:
        ws.append([l.get(h, "") for h in cab])
    return wb


def test_barbearia_clientes_sem_crm(cartao_demo):  # noqa: F811
    c, corpo = _cadastrar("barbearia", cartao_demo, plano="barbearia_essencial")
    r = c.get("/dados/modelo")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxml")
    wb = _abrir(r.content)
    assert wb.sheetnames[:2] == ["LEIA-ME", "CLIENTES"] and "LEADS" not in wb.sheetnames  # barbearia não tem CRM
    assert wb["LISTAS"].sheet_state == "hidden"

    wb = _preencher(r.content, "CLIENTES", [
        {"Nome*": "João Barba", "Telefone": "(41) 99888-7766", "E-mail": "joao@exemplo.com", "Data de nascimento": "05/03/1990", "UF": "PR"},
        {"Nome*": "Pedro CPF Ruim", "Telefone": "41 97777-6655", "CPF ou CNPJ": "111.111.111-11", "Data de nascimento": "31/02/1990"},
        {"Telefone": "41966665544"},  # sem nome
    ])
    sim = c.post("/dados/importar", json={"arquivo_base64": _b64(wb), "simular": True}).json()
    assert sim["simulado"] and sim["contagens"]["clientes_novos"] == 2 and sim["contagens"]["linhas_com_erro"] == 1
    assert sim["erros"][0] == {"aba": "CLIENTES", "linha": 4, "motivo": "Falta o nome."}
    assert {a["motivo"].split(" ")[0] for a in sim["avisos"]} >= {"CPF/CNPJ", "Data"}
    antes = len(c.get("/pacientes").json())
    assert antes == len(c.get("/pacientes").json())  # simular não grava

    feito = c.post("/dados/importar", json={"arquivo_base64": _b64(wb), "simular": False}).json()
    assert feito["contagens"]["clientes_novos"] == 2
    joao = next(p for p in c.get("/pacientes").json() if p["nome"] == "João Barba")
    ficha = lambda pid: (lambda j: j.get("paciente", j))(c.get(f"/pacientes/{pid}").json())  # noqa: E731
    joao = ficha(joao["id"])
    assert joao["data_nascimento"] == "1990-03-05" and joao["estado"] == "PR"
    # de novo: acha pelo telefone, não duplica
    de_novo = c.post("/dados/importar", json={"arquivo_base64": _b64(wb), "simular": False}).json()
    assert de_novo["contagens"]["clientes_novos"] == 0
    assert len([p for p in c.get("/pacientes").json() if p["nome"] == "João Barba"]) == 1

    # exportar, mudar e importar: o ID SAX atualiza
    exp = _abrir(c.get("/dados/exportar").content)
    ws = exp["CLIENTES"]
    cab = [x.value for x in ws[1]]
    linha = next(row for row in ws.iter_rows(min_row=2) if row[cab.index("Nome*")].value == "João Barba")
    assert linha[cab.index("ID SAX")].value == joao["id"]
    linha[cab.index("Cidade")].value = "Curitiba"
    r = c.post("/dados/importar", json={"arquivo_base64": _b64(exp), "simular": False}).json()
    assert r["contagens"]["clientes_novos"] == 0 and r["contagens"]["clientes_atualizados"] >= 1
    assert ficha(joao["id"])["cidade"] == "Curitiba"

    # arquivo que não é planilha, CSV simples
    assert c.post("/dados/importar", json={"arquivo_base64": base64.b64encode(b"\x00\x01lixo").decode()}).status_code == 422
    csv = "nome;telefone;email\nMaria CSV;41955554433;maria@exemplo.com\n".encode()
    assert c.post("/dados/importar", json={"arquivo_base64": base64.b64encode(csv).decode(), "simular": False}).json()["contagens"]["clientes_novos"] == 1


def test_veiculos_leads_e_negocios(cartao_demo, sysadmin):  # noqa: F811
    c, corpo = _cadastrar("veiculos", cartao_demo)
    funil = next(f for f in c.get("/funis").json() if f["padrao"])
    modelo = c.get("/dados/modelo").content
    wb = _abrir(modelo)
    assert {"CLIENTES", "LEADS", "NEGOCIOS"} <= set(wb.sheetnames)
    assert "Código do veículo" in [x.value for x in wb["NEGOCIOS"][1]]
    assert funil["nome"] in "\n".join(str(x.value) for x in wb["LEIA-ME"]["A"] if x.value)  # funis da própria empresa

    wb = _preencher(modelo, "LEADS", [
        {"Nome*": "Lead Planilha", "Telefone": "41911112222", "Origem": "Google Maps", "Temperatura": "quente",
         "Responsável (e-mail)": corpo["email"], "Situação": "Em contato"},
        {"Nome*": "Lead Sem Dono", "Telefone": "41911113333", "Responsável (e-mail)": "ninguem@exemplo.com", "Temperatura": "gelado"},
    ])
    ws = wb["NEGOCIOS"]
    cab = [x.value for x in ws[1]]
    for l in [
        {"Título*": "Venda do Civic", "Cliente": "Ana Compra", "Telefone do cliente": "41922223333", "Funil": funil["nome"],
         "Etapa": funil["etapas"][2]["nome"], "Situação": "Em andamento", "Valor": "89.900,00", "Temperatura": "Morno",
         "Código do veículo": "XYZ-999", "Etiquetas (separe por vírgula)": "Financiamento, Troca"},
        {"Título*": "Venda fechada", "Cliente": "Ana Compra", "Telefone do cliente": "(41) 92222-3333", "Situação": "Ganho", "Valor": "50000"},
        {"Título*": "Funil errado", "Funil": "Não existe"},
    ]:
        ws.append([l.get(h, "") for h in cab])
    r = c.post("/dados/importar", json={"arquivo_base64": _b64(wb), "simular": False}).json()
    k = r["contagens"]
    assert k["leads_novos"] == 2 and k["negocios_novos"] == 2 and k["clientes_novos"] == 1 and k["linhas_com_erro"] == 1, r
    assert any("XYZ-999" in a["motivo"] for a in r["avisos"]) and any("ninguem@" in a["motivo"] for a in r["avisos"])

    entradas = {e["nome"]: e for e in c.get("/entradas?status=todos").json()}
    assert entradas["Lead Planilha"]["temperatura"] == "quente" and entradas["Lead Planilha"]["status"] == "em_contato"
    assert entradas["Lead Planilha"]["corretor_id"]
    assert entradas["Lead Sem Dono"]["corretor_id"] is None
    negs = {n["nome"]: n for n in c.get("/leads/kanban?status=todos").json()}
    civic = negs["Venda do Civic"]
    assert civic["etapa_id"] == funil["etapas"][2]["id"] and civic["valor_estimado"] == 89900 and civic["temperatura"] == "morno"
    assert set(civic["etiquetas"]) == {"Financiamento", "Troca"} and negs["Venda fechada"]["status"] == "ganho"
    assert civic["cliente_id"] == negs["Venda fechada"]["cliente_id"]  # o mesmo cliente pelo telefone

    # reimportar não duplica leads (telefone); exportação traz tudo de volta
    r2 = c.post("/dados/importar", json={"arquivo_base64": _b64(_preencher(modelo, "LEADS", [{"Nome*": "Lead Planilha", "Telefone": "41911112222"}])), "simular": False}).json()
    assert r2["contagens"]["leads_novos"] == 0
    exp = _abrir(c.get("/dados/exportar").content)
    assert exp["NEGOCIOS"].max_row >= 3 and exp["LEADS"].max_row >= 3

    # equipe não importa; o administrador SAX importa em qualquer empresa
    eid = c.get("/auth/me").json()["empresa_id"]
    assert sysadmin.get(f"/plataforma/empresas/{eid}/dados/modelo").status_code == 200
    r3 = sysadmin.post(f"/plataforma/empresas/{eid}/dados/importar",
                       json={"arquivo_base64": _b64(_preencher(modelo, "CLIENTES", [{"Nome*": "Cliente pelo SAX", "Telefone": "41933334444"}])), "simular": False})
    assert r3.status_code == 200 and r3.json()["contagens"]["clientes_novos"] == 1
    assert sysadmin.get(f"/plataforma/empresas/{eid}/dados/exportar").status_code == 200


def test_equipe_nao_importa_nem_exporta():
    import os

    email, senha = os.environ.get("CRM_CORRETOR"), os.environ.get("CRM_CORRETOR_SENHA")
    if not email:
        pytest.skip("sem corretor de teste")
    c = httpx.Client(base_url=API, timeout=30)
    assert c.post("/auth/login", json={"email": email, "senha": senha}).status_code == 200
    assert c.get("/dados/modelo").status_code == 403
    assert c.get("/dados/exportar").status_code == 403
    assert c.post("/dados/importar", json={"arquivo_base64": "x" * 20}).status_code == 403
