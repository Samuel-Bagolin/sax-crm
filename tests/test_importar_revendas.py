"""Importação do CRM Revendas & Eventos (planilha) com dados fictícios: lojas, equipe sem senha, leads, negócios e atividades."""

import base64
import io
import json
import uuid

import httpx
import pytest

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401

openpyxl = pytest.importorskip("openpyxl")


def _xlsx(sufixo: str) -> str:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    def aba(nome, linhas):
        ws = wb.create_sheet(nome)
        for l in linhas:
            ws.append(l)

    etapas = [{"id": "E1", "nome": "Novo lead", "dias": 1}, {"id": "E2", "nome": "Primeiro contato", "dias": 3}, {"id": "E3", "nome": "Proposta", "dias": 5}]
    aba("LOJAS", [["Loja", "Praça"], ["O Pudim Perfeito - Batel", "CURITIBA"], ["O Pudim Perfeito - Moema", "SÃO PAULO"]])
    aba("SUPERVISOES", [["ID", "Supervisão", "Praça"], ["SUP-X", "Curitiba Norte", "CURITIBA"]])
    aba("USUARIOS", [["ID", "Nome", "E-mail", "Senha (hash)", "Salt", "Perfil", "Praça", "Loja", "Ativo", "Telefone", "Trocar senha", "Criado em", "Último acesso", "Supervisões"],
                     ["U-1", "Diretora Teste", f"dir.{sufixo}@exemplo.com", "HASHQUENAOENTRA", "SALT", "diretoria", "", "", "SIM", "", "NÃO", "", "", ""],
                     ["U-2", "Lider Teste", f"lider.{sufixo}@exemplo.com", "HASHQUENAOENTRA", "SALT", "lider", "CURITIBA", "O Pudim Perfeito - Batel", "SIM", "(41) 99999-0001", "NÃO", "", "", "SUP-X"]])
    aba("FUNIS", [["ID", "Nome", "Etapas (JSON)", "Recebe leads da aba", "Ativo", "Ordem"],
                  ["F-REVENDA", "Revenda", json.dumps(etapas), "LEADS REVENDA", "SIM", 1]])
    cab = ["Data de entrada", "Nome do Responsável", "Nome do Restaurante", "Telefone", "CNPJ", "Localidade do pedido", "ID Lead", "Origem", "E-mail", "Endereço / bairro", "Observações", "Pixel"]
    aba("LEADS REVENDA", [cab, ["06/10/2026 11:00:00", "Diego", "Restaurante Fictício", "(41) 98888-1111", "", "Curitiba", "L-1", "Prospecção Google Maps", "", "Rua X, 1", "Obs", ""],
                          ["07/10/2026", "Sem nome", "Bar Sem Negócio", "(41) 98888-2222", "", "Curitiba", "L-2", "Formulário do Meta", "", "", "", ""]])
    aba("LEADS EVENTOS", [cab])
    aba("NEGOCIOS", [["ID", "ID Lead", "Funil", "Etapa", "Status", "Responsável ID", "Responsável", "Loja", "Praça", "Valor", "Motivo da perda", "Criado em",
                      "Na etapa desde", "Ganho em", "Perdido em", "Atualizado em", "Atualizado por", "Supervisão"],
                     ["N-1", "L-1", "F-REVENDA", "E2", "aberto", "U-2", "Lider Teste", "O Pudim Perfeito - Batel", "CURITIBA", "0", "", "06/10/2026", "07/10/2026", "", "", "08/10/2026", "Lider Teste", "SUP-X", "Frio"]])
    aba("ATIVIDADES", [["ID Atividade", "ID Negócio", "Tipo", "Título", "Observação", "Prazo", "Status", "Anexo (ID arquivo)", "Feito por", "Criada em", "Concluída em", "Criada por"],
                       ["A-1", "N-1", "Contato", "Primeiro contato", "Liguei e mandei WhatsApp", "07/10/2026", "Sucesso", "", "Lider Teste", "06/10/2026", "07/10/2026", "Sistema"]])
    aba("HISTORICO", [["Data", "ID Negócio", "Negócio", "Usuário", "Ação", "Detalhe"], ["07/10/2026", "N-1", "Restaurante Fictício", "Lider Teste", "Etapa alterada", "Novo lead → Primeiro contato"]])
    aba("PEDIDOS", [["ID", "ID Negócio"]])
    buf = io.BytesIO()
    wb.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def test_importa_planilha_sem_senhas_e_sem_duplicar(sysadmin, cartao_demo):  # noqa: F811
    c, _ = _cadastrar("comercio", cartao_demo)
    empresa_id = c.get("/auth/me").json()["empresa_id"]
    sufixo = uuid.uuid4().hex[:6]
    arquivo = _xlsx(sufixo)
    sim = sysadmin.post(f"/plataforma/empresas/{empresa_id}/importar-revendas", json={"arquivo_base64": arquivo, "simular": True})
    assert sim.status_code == 200, sim.text
    s = sim.json()
    assert s["simulado"] and s["contagens"]["negocios"] == 1 and s["contagens"]["leads"] == 2 and s["contagens"]["usuarios"] == 2
    assert c.get("/leads").json() == []  # simular não grava

    r = sysadmin.post(f"/plataforma/empresas/{empresa_id}/importar-revendas", json={"arquivo_base64": arquivo, "simular": False}).json()
    assert r["contagens"]["lojas"] == 2 and r["contagens"]["atividades"] == 1
    lider = next(a for a in r["acessos"] if a["email"].startswith("lider."))
    assert lider["link"] and "/ativar-acesso#token=" in lider["link"] and lider["papel"] == "Equipe"

    # a senha antiga da planilha não serve para entrar
    assert httpx.post(f"{API}/auth/login", json={"email": lider["email"], "senha": "HASHQUENAOENTRA"}).status_code in (401, 403)

    lojas = {u["nome"] for u in c.get("/unidades").json()}
    assert {"Curitiba - Batel", "São Paulo - Moema"} <= lojas
    neg = c.get("/leads").json()
    assert len(neg) == 1 and neg[0]["nome"] == "Restaurante Fictício" and "Loja Batel" in neg[0]["etiquetas"] and "Frio" in neg[0]["etiquetas"]
    funil = next(f for f in c.get("/funis").json() if f["id"] == neg[0]["funil_id"])
    assert [e["nome"] for e in funil["etapas"]] == ["Novo lead", "Primeiro contato", "Proposta"]
    assert neg[0]["etapa_id"] == funil["etapas"][1]["id"]
    entradas = c.get("/entradas").json()
    assert any(e["nome"] == "Bar Sem Negócio" and e["na_fila"] for e in entradas)

    # importar de novo não duplica
    de_novo = sysadmin.post(f"/plataforma/empresas/{empresa_id}/importar-revendas", json={"arquivo_base64": arquivo, "simular": False}).json()
    assert de_novo["contagens"]["negocios"] == 0 and de_novo["contagens"]["leads"] == 0 and de_novo["contagens"]["usuarios"] == 0
    assert len(c.get("/leads").json()) == 1

    # arquivo que não é planilha
    ruim = sysadmin.post(f"/plataforma/empresas/{empresa_id}/importar-revendas", json={"arquivo_base64": base64.b64encode(b"qualquer coisa").decode(), "simular": True})
    assert ruim.status_code == 422
