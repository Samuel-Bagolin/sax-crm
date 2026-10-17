"""PDFs da clínica (orçamento, prontuário, atestado) e arquivos do prontuário, com o mesmo sigilo do prontuário."""

import base64
import uuid

import httpx

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c63f8cfc0f01f0005000201ff8a2c5b0000000049454e44ae426082")


def _colega(c):
    email = f"prof.{uuid.uuid4().hex[:5]}@exemplo.com"
    assert c.post("/usuarios", json={"nome": "Outra Profissional", "email": email, "senha": "SenhaForte#123", "papel": "corretor"}).status_code == 201
    s = httpx.Client(base_url=API, timeout=60)
    assert s.post("/auth/login", json={"email": email, "senha": "SenhaForte#123"}).status_code == 200
    return s


def test_pdfs_e_arquivos(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("terapia", cartao_demo)
    p = c.post("/pacientes", json={"nome": "Lia Documentos", "telefone": "41990000401", "cpf_cnpj": "529.982.247-25"}).json()
    pid = p["id"]
    t = c.post(f"/pacientes/{pid}/tratamentos", json={"titulo": "Plano de fonoaudiologia", "itens": [
        {"descricao": "Sessão de fonoterapia", "quantidade": 8, "valor_unitario": 150}], "desconto": 100, "parcelas": 2}).json()
    r = c.get(f"/pacientes/{pid}/tratamentos/{t['id']}/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"

    c.post(f"/pacientes/{pid}/prontuario", json={"texto": "Avaliação inicial: queixa de disfluência.", "tipo": "avaliacao"})
    r = c.get(f"/pacientes/{pid}/prontuario/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and len(r.content) > 1500

    d = c.post(f"/pacientes/{pid}/documentos-clinicos", json={"tipo": "atestado", "texto": "Atesto que Lia esteve em atendimento hoje.", "cidade": "Curitiba"}).json()
    assert d["titulo"] == "Atestado" and d["autor_nome"]
    assert c.get(f"/pacientes/{pid}/documentos-clinicos/{d['id']}/pdf").content.startswith(b"%PDF")
    assert [x["id"] for x in c.get(f"/pacientes/{pid}/documentos-clinicos").json()] == [d["id"]]

    # arquivos
    ok = {"nome": "exame.png", "mime": "image/png", "base64": base64.b64encode(PNG).decode(), "descricao": "Audiometria"}
    assert c.post(f"/pacientes/{pid}/arquivos", json={**ok, "mime": "application/zip"}).status_code == 422
    assert c.post(f"/pacientes/{pid}/arquivos", json={**ok, "mime": "application/pdf"}).status_code == 422  # conteúdo não é PDF
    a = c.post(f"/pacientes/{pid}/arquivos", json=ok).json()
    assert a["tamanho"] == len(PNG) and "conteudo" not in a
    assert "conteudo" not in c.get(f"/pacientes/{pid}/arquivos").json()[0]
    assert c.get(f"/pacientes/{pid}/arquivos/{a['id']}").content == PNG

    # outra profissional que não atende a paciente não abre nada disso
    o = _colega(c)
    for url in (f"/pacientes/{pid}/prontuario/pdf", f"/pacientes/{pid}/documentos-clinicos/{d['id']}/pdf", f"/pacientes/{pid}/arquivos",
                f"/pacientes/{pid}/arquivos/{a['id']}", f"/pacientes/{pid}/tratamentos/{t['id']}/pdf"):
        assert o.get(url).status_code == 403, url
    assert c.delete(f"/pacientes/{pid}/arquivos/{a['id']}").status_code == 204


def test_orcamento_na_terapia_apresentar_e_aprovar(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("terapia", cartao_demo)
    p = c.post("/pacientes", json={"nome": "Téo Orçamento", "telefone": "41990000402"}).json()
    t = c.post(f"/pacientes/{p['id']}/tratamentos", json={"tipo": "geral", "titulo": "Plano terapêutico", "itens": [
        {"descricao": "Sessão de terapia ocupacional", "quantidade": 10, "valor_unitario": 120}], "parcelas": 2}).json()
    assert c.post(f"/pacientes/{p['id']}/tratamentos/{t['id']}/acao", json={"acao": "apresentar"}).status_code == 200
    assert c.post(f"/pacientes/{p['id']}/tratamentos/{t['id']}/acao", json={"acao": "aprovar"}).status_code == 200
    assert c.get(f"/pacientes/{p['id']}/tratamentos/{t['id']}/pdf").content.startswith(b"%PDF")
