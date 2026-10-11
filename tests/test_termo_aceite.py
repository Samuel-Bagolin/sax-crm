"""Termo de adesão: texto (unitário) e aceite do gestor no primeiro acesso (ponta a ponta, precisa da API local)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from lib import termo_aceite as ta
from test_segmentos import API, _cadastrar, _cpf, cartao_demo, sysadmin  # noqa: F401  (fixtures)

CONTRATADA = {"razao_social": "SAX Tecnologia Ltda", "cnpj": "11.222.333/0001-81", "endereco": "Rua Teste, 100, Centro, Curitiba/PR, 80000-000",
              "cidade_uf": "Curitiba/PR", "email": "suporte@exemplo.com"}


def test_texto_do_termo():
    t = ta.texto(CONTRATADA, {"nome": "Clínica X", "documento": "11.222.333/0001-81"})
    assert "—" not in t
    for trecho in ("Código de Defesa do Consumidor", "artigo 49", "não são devolvidos", "taxa de implantação",
                   "Não há prazo mínimo de permanência nem multa", "cobrança em duplicidade", "2.200-2/2001",
                   "comarca de Curitiba/PR", "SAX Tecnologia Ltda", "Clínica X"):
        assert trecho in t, trecho
    # O hash da versão muda se a contratada mudar (o texto exibido muda).
    assert ta.hash_versao(CONTRATADA) != ta.hash_versao({**CONTRATADA, "cidade_uf": "São Paulo/SP"})
    assert not ta.configurada({**CONTRATADA, "cnpj": ""})


def test_aceite_no_primeiro_acesso(cartao_demo, sysadmin):
    r = sysadmin.put("/plataforma/contratada", json={**CONTRATADA, "cnpj": "11.222.333/0001-00"})
    assert r.status_code == 422  # CNPJ inválido
    assert sysadmin.put("/plataforma/contratada", json=CONTRATADA).status_code == 200

    c, _ = _cadastrar("odontologia", cartao_demo)
    empresa_id = c.get("/auth/me").json()["empresa_id"]
    s = c.get("/termo").json()
    assert s["exigir"] is True and s["hash_versao"] and "não são devolvidos" in s["texto"]

    base = {"hash_versao": s["hash_versao"], "nome": "Maria Gestora Silva", "cpf": _cpf(), "cargo": "Sócia",
            "li_e_aceito": True, "uso_empresarial": True, "ciente_sem_reembolso": True, "tempo_leitura_s": 95}
    assert c.post("/termo/aceitar", json={**base, "ciente_sem_reembolso": False}).status_code == 422
    assert c.post("/termo/aceitar", json={**base, "cpf": "111.111.111-11"}).status_code == 422
    assert c.post("/termo/aceitar", json={**base, "hash_versao": "0" * 64}).status_code == 409
    # O suporte (administrador de sistema na aba da empresa) não aceita em nome do cliente.
    assert sysadmin.post("/termo/aceitar", json=base, headers={"X-Sax-Empresa": empresa_id}).status_code == 403

    ok = c.post("/termo/aceitar", json=base)
    assert ok.status_code == 200, ok.text
    aceite = ok.json()["aceite"]
    assert aceite["versao"] == ta.VERSAO and aceite["nome"] == "Maria Gestora Silva" and len(aceite["hash"]) == 64
    # Clique duplo não cria outro registro nem muda a data.
    assert c.post("/termo/aceitar", json=base).json()["aceite"]["em"] == aceite["em"]
    assert c.get("/termo").json()["exigir"] is False

    pdf = c.get("/termo/comprovante.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    # Painel do administrador: data do aceite na empresa e comprovante.
    emp = next(e for e in sysadmin.get("/empresas").json() if e["id"] == empresa_id)
    assert emp["termo_aceite"]["em"] == aceite["em"]
    lista = sysadmin.get(f"/plataforma/termos/{empresa_id}").json()
    assert lista[0]["ip"] and lista[0]["cpf"]
    pdf2 = sysadmin.get(f"/plataforma/termos/{empresa_id}/comprovante.pdf")
    assert pdf2.status_code == 200 and pdf2.content[:4] == b"%PDF"
    # Gestor de outra empresa não baixa o comprovante desta.
    outra, _ = _cadastrar("barbearia", cartao_demo)
    assert outra.get(f"/plataforma/termos/{empresa_id}/comprovante.pdf").status_code == 403
    assert outra.get("/termo/comprovante.pdf").status_code == 404
