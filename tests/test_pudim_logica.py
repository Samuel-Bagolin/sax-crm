"""Lógica do CRM Revendas (O Pudim Perfeito) no SAX, com dados fictícios:
praças e supervisões (quem vê o quê), lead roteado pelo pixel, etapa com cadeado e comissão nos 2 primeiros pedidos."""

import base64
import io
import json
import uuid
from datetime import date, timedelta

import httpx
import pytest

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401

openpyxl = pytest.importorskip("openpyxl")


def _planilha(s: str) -> str:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    def aba(nome, linhas):
        ws = wb.create_sheet(nome)
        for l in linhas:
            ws.append(l)

    etapas = [{"id": "E1", "nome": "Novo lead", "requisito": "", "dias": 1}, {"id": "E2", "nome": "Primeiro contato", "requisito": "Contato", "dias": 3},
              {"id": "E3", "nome": "Reunião com proprietário", "requisito": "Reunião com proprietário", "dias": 5}, {"id": "E4", "nome": "Proposta enviada", "requisito": "", "dias": 7}]
    aba("LOJAS", [["Loja", "Praça"], ["O Pudim Perfeito - Batel", "CURITIBA"], ["O Pudim Perfeito - Uberaba", "CURITIBA"], ["O Pudim Perfeito - Moema", "SÃO PAULO"]])
    aba("SUPERVISOES", [["ID", "Supervisão", "Praça", "Pixels (separe por vírgula)", "Ativa"],
                        ["SUP-N", "CWB Norte", "CURITIBA", "pixel-norte", "SIM"], ["SUP-S", "CWB Sul", "CURITIBA", "pixel-sul", "SIM"]])
    cab = ["ID", "Nome", "E-mail", "Senha (hash)", "Salt", "Perfil", "Praça", "Loja", "Ativo", "Telefone", "Trocar senha", "Criado em", "Último acesso", "Supervisões"]
    aba("USUARIOS", [cab,
                     ["U-D", "Diretora", f"dir.{s}@exemplo.com", "", "", "diretoria", "", "", "SIM", "", "", "", "", ""],
                     ["U-SN", "Sup Norte", f"supn.{s}@exemplo.com", "", "", "supervisor", "CURITIBA", "", "SIM", "", "", "", "", "SUP-N"],
                     ["U-LB", "Lider Batel", f"lb.{s}@exemplo.com", "", "", "lider", "CURITIBA", "O Pudim Perfeito - Batel", "SIM", "", "", "", "", "SUP-N"],
                     ["U-LU", "Lider Uberaba", f"lu.{s}@exemplo.com", "", "", "lider", "CURITIBA", "O Pudim Perfeito - Uberaba", "SIM", "", "", "", "", "SUP-S"]])
    aba("FUNIS", [["ID", "Nome", "Etapas (JSON)", "Recebe leads da aba", "Ativo", "Ordem"], ["F-REVENDA", "Revenda", json.dumps(etapas), "LEADS REVENDA", "SIM", 1]])
    lcab = ["Data de entrada", "Nome do Responsável", "Nome do Restaurante", "Telefone", "CNPJ", "Localidade do pedido", "ID Lead", "Origem", "E-mail", "Endereço / bairro", "Observações", "Pixel"]
    aba("LEADS REVENDA", [lcab,
                          ["06/10/2026", "Ana", "Café Norte", "(41) 97777-0001", "", "Curitiba", "L-1", "Meta", "", "", "", "pixel-norte"],
                          ["06/10/2026", "Bia", "Bar Sul", "(41) 97777-0002", "", "Curitiba", "L-2", "Meta", "", "", "", "pixel-sul"],
                          ["06/10/2026", "Caio", "Lanche Sem Sup", "(41) 97777-0003", "", "Curitiba", "L-3", "Meta", "", "", "", ""]])
    aba("LEADS EVENTOS", [lcab])
    ncab = ["ID", "ID Lead", "Funil", "Etapa", "Status", "Responsável ID", "Responsável", "Loja", "Praça", "Valor", "Motivo da perda", "Criado em", "Na etapa desde",
            "Ganho em", "Perdido em", "Atualizado em", "Atualizado por", "Supervisão"]
    aba("NEGOCIOS", [ncab,
                     ["N-1", "L-1", "F-REVENDA", "E1", "aberto", "U-LB", "Lider Batel", "O Pudim Perfeito - Batel", "CURITIBA", "0", "", "06/10/2026", "06/10/2026", "", "", "", "", "SUP-N"],
                     ["N-2", "L-2", "F-REVENDA", "E1", "aberto", "U-LU", "Lider Uberaba", "O Pudim Perfeito - Uberaba", "CURITIBA", "0", "", "06/10/2026", "06/10/2026", "", "", "", "", "SUP-S"],
                     ["N-3", "L-3", "F-REVENDA", "E1", "aberto", "", "", "", "CURITIBA", "0", "", "06/10/2026", "06/10/2026", "", "", "", "", ""]])
    for nome, cab_ in (("ATIVIDADES", ["ID Atividade"]), ("HISTORICO", ["Data"]), ("PEDIDOS", ["ID"])):
        aba(nome, [cab_])
    buf = io.BytesIO()
    wb.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def _entrar(link: str, email: str) -> httpx.Client:
    token = link.split("#token=")[1]
    assert httpx.post(f"{API}/auth/ativar", json={"token": token, "senha": "Senha-forte-123"}).status_code in (200, 204)
    c = httpx.Client(base_url=API, timeout=60)
    assert c.post("/auth/login", json={"email": email, "senha": "Senha-forte-123"}).status_code == 200
    return c


@pytest.fixture(scope="module")
def rede(sysadmin, cartao_demo):  # noqa: F811
    gestor, _ = _cadastrar("comercio", cartao_demo)
    eid = gestor.get("/auth/me").json()["empresa_id"]
    s = uuid.uuid4().hex[:6]
    r = sysadmin.post(f"/plataforma/empresas/{eid}/importar-revendas", json={"arquivo_base64": _planilha(s), "simular": False})
    assert r.status_code == 200, r.text
    assert r.json()["contagens"]["supervisoes"] == 2
    links = {a["email"].split(".")[0]: (a["link"], a["email"]) for a in r.json()["acessos"]}
    return gestor, {k: _entrar(*v) for k, v in links.items() if k in ("supn", "lb", "lu")}, sysadmin, eid


def test_quem_ve_o_que(rede):
    gestor, c, _, _ = rede
    nomes = lambda cli: sorted(n["nome"] for n in cli.get("/leads").json())  # noqa: E731
    assert nomes(gestor) == ["Bar Sul", "Café Norte", "Lanche Sem Sup"]
    assert nomes(c["supn"]) == ["Café Norte", "Lanche Sem Sup"]  # a supervisão dele e o lead da praça sem supervisão
    assert nomes(c["lb"]) == ["Café Norte"]
    assert nomes(c["lu"]) == ["Bar Sul"]
    sul = next(n for n in gestor.get("/leads").json() if n["nome"] == "Bar Sul")
    assert c["supn"].get(f"/leads/{sul['id']}").status_code == 404
    assert c["lb"].get(f"/leads/{sul['id']}").status_code == 404


def test_supervisor_define_o_responsavel(rede):
    gestor, c, _, _ = rede
    sem = next(n for n in gestor.get("/leads").json() if n["nome"] == "Lanche Sem Sup")
    lider = c["lb"].get("/auth/me").json()["pessoa_id"]
    r = c["supn"].patch(f"/leads/{sem['id']}", json={"corretor_id": lider})
    assert r.status_code == 200 and r.json()["corretor_id"] == lider
    assert "Lanche Sem Sup" in [n["nome"] for n in c["lb"].get("/leads").json()]


def test_etapa_com_cadeado_e_avanco_pela_atividade(rede):
    gestor, c, _, _ = rede
    neg = next(n for n in c["lb"].get("/leads").json() if n["nome"] == "Café Norte")
    funil = next(f for f in gestor.get("/funis").json() if f["id"] == neg["funil_id"])
    e2, e3 = funil["etapas"][1], funil["etapas"][2]
    assert e2["requisito"] == "contato" and e3["requisito"] == "reuniao"
    r = c["lb"].post(f"/leads/{neg['id']}/mover", json={"etapa_id": e2["id"]})
    assert r.status_code == 409 and "Primeiro contato" in r.json()["detail"]
    hoje = date.today().isoformat()
    # contato sem sucesso não destrava
    c["lb"].post("/atividades", json={"tipo": "ligacao", "assunto": "Liguei", "data": hoje, "negocio_id": neg["id"], "concluida": True, "resultado": "negativo"})
    assert c["lb"].post(f"/leads/{neg['id']}/mover", json={"etapa_id": e2["id"]}).status_code == 409
    a = c["lb"].post("/atividades", json={"tipo": "whatsapp", "assunto": "Falei no WhatsApp", "data": hoje, "negocio_id": neg["id"]}).json()
    assert c["lb"].patch(f"/atividades/{a['id']}", json={"concluida": True, "resultado": "positivo"}).status_code == 200
    assert c["lb"].get(f"/leads/{neg['id']}").json()["negocio"]["etapa_id"] == e2["id"]  # avançou sozinho
    # pular a reunião não pode
    assert c["lb"].post(f"/leads/{neg['id']}/mover", json={"etapa_id": funil["etapas"][3]["id"]}).status_code == 409
    # voltar sempre pode
    assert c["lb"].post(f"/leads/{neg['id']}/mover", json={"etapa_id": funil["etapas"][0]["id"]}).status_code == 200


def test_lead_novo_do_meta_cai_na_supervisao_pelo_pixel(rede):
    gestor, c, sysadmin, eid = rede
    chave = sysadmin.post("/configuracoes/api-key", headers={"X-Sax-Empresa": eid}).json()["site_api_key"]
    r = httpx.post(f"{API}/site/leads", headers={"X-API-Key": chave},
                   json={"nome": "Restaurante Novo", "telefone": "41966665555", "origem": "Formulário do Meta", "pixel": "pixel-sul", "localidade": "Curitiba"})
    assert r.status_code == 201, r.text
    entradas = {e["nome"]: e for e in gestor.get("/entradas").json()}
    assert entradas["Restaurante Novo"]["praca"] == "Curitiba"
    assert "Restaurante Novo" not in [e["nome"] for e in c["supn"].get("/entradas").json()]


def test_comissao_dois_primeiros_pedidos_e_aprovacao(rede):
    gestor, c, _, _ = rede
    neg = next(n for n in c["lu"].get("/leads").json() if n["nome"] == "Bar Sul")
    ontem = (date.today() - timedelta(days=1)).isoformat()
    futuro = (date.today() + timedelta(days=2)).isoformat()
    assert c["lu"].post("/pedidos", json={"negocio_id": neg["id"], "numero": "X", "data": futuro, "valor": 100}).status_code == 422
    p1 = c["lu"].post("/pedidos", json={"negocio_id": neg["id"], "numero": "1001", "data": ontem, "valor": 1000})
    assert p1.status_code == 201, p1.text
    assert p1.json()["comissao"] == 70 and p1.json()["ordem"] == 1
    assert c["lu"].get(f"/leads/{neg['id']}").json()["negocio"]["status"] == "ganho"
    c["lu"].post("/pedidos", json={"negocio_id": neg["id"], "numero": "1002", "data": ontem, "valor": 500})
    p3 = c["lu"].post("/pedidos", json={"negocio_id": neg["id"], "numero": "1003", "data": ontem, "valor": 800}).json()
    assert p3["comissao"] == 0 and p3["status"] == "sem_comissao"
    lista = c["lu"].get("/pedidos").json()
    assert lista["resumo"]["comissao"] == 105 and all(p["minha"] for p in lista["pedidos"])
    # o líder não aprova a própria; o supervisor de outra supervisão nem vê
    ids = [p["id"] for p in lista["pedidos"] if p["status"] == "pendente"]
    assert c["lu"].post("/pedidos/aprovar", json={"ids": ids}).json()["ok"] == 0
    assert c["supn"].get("/pedidos").json()["pedidos"] == []
    assert gestor.post("/pedidos/aprovar", json={"ids": ids}).json()["ok"] == 2
    assert gestor.post("/pedidos/pagar", json={"ids": ids}).json()["ok"] == 2
    # cancelar o 1º não mexe em comissão já paga; o 3º continua sem comissão (paga fica congelada)
    assert gestor.post(f"/pedidos/{ids[0]}/cancelar").status_code == 409
