"""Testes ponta a ponta do CRM estilo Pipedrive contra uma API em execução (homologação/local).

Uso: BACKEND_URL=http://localhost:8001 CRM_ADMIN=admin@... CRM_ADMIN_SENHA=... \
     CRM_CORRETOR=... CRM_CORRETOR_SENHA=... python -m pytest tests/test_crm_pipedrive.py -q
Sem as variáveis (ou sem a API no ar), os testes são pulados. Cria registros de teste:
não rode em produção.
"""

import base64
import os
import struct
import zlib

import httpx
import pytest

API = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
ADMIN = (os.environ.get("CRM_ADMIN"), os.environ.get("CRM_ADMIN_SENHA"))
CORRETOR = (os.environ.get("CRM_CORRETOR"), os.environ.get("CRM_CORRETOR_SENHA"))


def _login(cred):
    if not all(cred):
        pytest.skip("credenciais de teste não informadas")
    c = httpx.Client(base_url=API, timeout=20)
    try:
        r = c.post("/auth/login", json={"email": cred[0], "senha": cred[1]})
    except httpx.HTTPError:
        pytest.skip("API indisponível")
    assert r.status_code == 200, r.text
    return c


def _png() -> str:
    raw = b"".join(b"\x00" + b"\x00\x00\x00\xff" * 40 for _ in range(12))

    def ch(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", 40, 12, 8, 6, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode()


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def corretor():
    return _login(CORRETOR)


def test_funis_padrao_e_rbac(admin, corretor):
    funis = admin.get("/funis").json()
    assert funis and any(f["padrao"] for f in funis)
    assert corretor.get("/funis").status_code == 200
    r = corretor.post("/funis", json={"nome": "X", "etapas": [{"nome": "A"}]})
    assert r.status_code == 403


def test_fluxo_lead_negocio_atividade(admin):
    e = admin.post("/entradas", json={"nome": "Teste Automatizado", "telefone": "(41) 90000-0000", "origem": "Site"}).json()
    neg = admin.post(f"/entradas/{e['id']}/converter", json={}).json()
    assert neg["status"] == "aberto" and neg["funil_id"]
    assert admin.post(f"/entradas/{e['id']}/converter", json={}).status_code == 409
    funil = next(f for f in admin.get("/funis").json() if f["id"] == neg["funil_id"])
    r = admin.post(f"/leads/{neg['id']}/mover", json={"etapa_id": funil["etapas"][2]["id"]})
    assert r.json()["etapa_id"] == funil["etapas"][2]["id"]
    assert admin.post(f"/leads/{neg['id']}/mover", json={"etapa_id": "inexistente"}).status_code == 422
    a = admin.post("/atividades", json={"tipo": "ligacao", "assunto": "Ligar", "data": "2020-01-01", "negocio_id": neg["id"]}).json()
    card = next(n for n in admin.get("/leads/kanban").json() if n["id"] == neg["id"])
    assert card["situacao_atividade"] == "atrasada"
    admin.patch(f"/atividades/{a['id']}", json={"concluida": True})
    hist = admin.get(f"/leads/{neg['id']}/historico").json()
    assert any(h["tipo"] == "etapa" for h in hist) and any("concluída" in h["texto"] for h in hist)


def test_corretor_nao_ve_negocio_alheio(admin, corretor):
    neg = admin.post("/leads", json={"nome": "Negócio do gestor"}).json()
    assert corretor.get(f"/leads/{neg['id']}").status_code == 404
    assert all(n["id"] != neg["id"] for n in corretor.get("/leads/kanban").json())


def test_foto_rejeita_arquivo_que_nao_e_imagem(admin):
    eu = admin.get("/perfil").json()
    falso = base64.b64encode(b"<?php echo 1; ?>" * 4).decode()
    assert admin.put(f"/usuarios/{eu['id']}/foto", json={"base64": falso, "mime": "image/jpeg"}).status_code == 422


def test_assinatura_link_publico(admin):
    imovel = admin.get("/imoveis").json()[0]
    neg = admin.post("/leads", json={"nome": "Assinatura teste", "imovel_id": imovel["id"]}).json()
    admin.post(f"/leads/{neg['id']}/ganhar")
    ct = admin.post("/contratos", json={"tipo": "venda", "imovel_id": imovel["id"], "lead_id": neg["id"], "valor": 100000, "inicio": "2030-01-10"}).json()
    modelo = next(m for m in admin.get("/modelos-contrato").json() if m["tipo"] == "venda")
    admin.post(f"/contratos/{ct['id']}/documento/gerar", json={"modelo_id": modelo["id"]})
    painel = admin.post(f"/contratos/{ct['id']}/signatarios", json={"nome": "Fulano de Tal", "papel": "comprador"}).json()
    sig = painel["signatarios"][-1]
    publico = httpx.Client(base_url=API, timeout=20)
    doc = publico.get(f"/assinatura/{sig['token']}").json()
    assert doc["signatario"]["token"] is None  # o token nunca volta na página pública
    corpo = {"nome": "Fulano de Tal", "cpf": "111.111.111-11", "assinatura_png": _png(), "aceite": True}
    assert publico.post(f"/assinatura/{sig['token']}/assinar", json=corpo).status_code == 422  # CPF inválido
    corpo["cpf"] = "529.982.247-25"
    assert publico.post(f"/assinatura/{sig['token']}/assinar", json=corpo).status_code == 200
    assert publico.post(f"/assinatura/{sig['token']}/assinar", json=corpo).status_code == 409
    assert admin.put(f"/contratos/{ct['id']}/documento", json={"titulo": "Novo", "texto": "x" * 40}).status_code == 409
    final = admin.get(f"/contratos/{ct['id']}/assinatura").json()
    assert final["status"] == "assinado"
    assert admin.get(f"/contratos/{ct['id']}/documento.pdf").headers["content-type"] == "application/pdf"
    assert publico.get("/assinatura/token-invalido-com-mais-de-20-caracteres").status_code == 404


def test_relatorio_funil_por_alcance(admin):
    """Voltar o card de etapa não pode diminuir o funil (regra do CRM Revendas)."""
    funil = next(f for f in admin.get("/funis").json() if f["padrao"])
    antes = admin.get(f"/relatorios/funil?funil_id={funil['id']}").json()
    neg = admin.post("/leads", json={"nome": "Alcance teste", "funil_id": funil["id"]}).json()
    admin.post(f"/leads/{neg['id']}/mover", json={"etapa_id": funil["etapas"][3]["id"]})
    admin.post(f"/leads/{neg['id']}/mover", json={"etapa_id": funil["etapas"][0]["id"]})
    depois = admin.get(f"/relatorios/funil?funil_id={funil['id']}").json()
    assert depois["criados"] == antes["criados"] + 1
    assert depois["funil"][3]["alcancaram"] == antes["funil"][3]["alcancaram"] + 1
    assert depois["funil"][4]["alcancaram"] == antes["funil"][4]["alcancaram"]
    assert depois["funil"][-1]["id"] == "__ganho"


def _eu(c):
    return c.get("/auth/me").json()


def test_chat_canal_geral_direta_e_nao_lidas(admin, corretor):
    pessoas = corretor.get("/chat/pessoas").json()
    assert len(pessoas) >= 2 and all("email" not in p and "telefone" not in p for p in pessoas)
    geral = next(c for c in admin.get("/chat/conversas").json() if c["todos"])
    corretor.get(f"/chat/conversas/{geral['id']}/mensagens")  # zera não lidas
    antes = corretor.get("/chat/nao-lidas").json()["total"]
    admin.post(f"/chat/conversas/{geral['id']}/mensagens", json={"texto": "teste automatizado"})
    assert corretor.get("/chat/nao-lidas").json()["total"] == antes + 1
    msgs = corretor.get(f"/chat/conversas/{geral['id']}/mensagens").json()
    assert msgs[-1]["texto"] == "teste automatizado"
    assert corretor.get("/chat/nao-lidas").json()["total"] == antes
    # a própria mensagem só pode ser apagada pelo autor (ou gestor)
    assert corretor.delete(f"/chat/mensagens/{msgs[-1]['id']}").status_code in (403, 404)
    dm = corretor.post("/chat/diretas", json={"usuario_id": _eu(admin)["usuario_id"]}).json()
    assert dm["tipo"] == "direta" and dm["id"] == corretor.post("/chat/diretas", json={"usuario_id": _eu(admin)["usuario_id"]}).json()["id"]
    assert corretor.post("/chat/diretas", json={"usuario_id": _eu(corretor)["usuario_id"]}).status_code == 422


def test_chat_anexo_so_imagem_ou_pdf(admin):
    geral = next(c for c in admin.get("/chat/conversas").json() if c["todos"])
    r = admin.post(f"/chat/conversas/{geral['id']}/anexo", files={"arquivo": ("x.exe", b"MZ\x90\x00", "application/octet-stream")})
    assert r.status_code == 415


def test_documento_sem_google_fica_no_crm(admin):
    st = admin.get("/google/status").json()
    if st["conectado"]:
        pytest.skip("usuário de teste já conectado ao Google")
    neg = admin.post("/leads", json={"nome": "Negócio com documento"}).json()
    r = admin.post("/documentos/upload", data={"negocio_id": neg["id"]}, files={"arquivo": ("rg.pdf", b"%PDF-1.4\n", "application/pdf")})
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["armazenamento"] == "crm"
    assert admin.get(f"/documentos/{doc['id']}/abrir").content.startswith(b"%PDF")
    assert [d["id"] for d in admin.get(f"/documentos?negocio_id={neg['id']}").json()] == [doc["id"]]


def test_google_conectar_exige_configuracao(admin):
    st = admin.get("/google/status").json()
    r = admin.get("/google/conectar")
    if st["configurado"]:
        assert r.status_code == 200
        url = r.json()["url"]
        assert "state=" in url and "drive.file" in url and "calendar.events" in url
    else:
        assert r.status_code == 503


# ------------------------------------------------------------------ diferenciais (Etapa 8.3)


def _publico():
    return httpx.Client(base_url=API, timeout=20)


def _negocio_com_imovel(admin, nome="Teste diferenciais"):
    im = admin.post("/imoveis", json={"titulo": "Casa teste match", "tipo": "casa", "finalidade": "venda", "endereco": "Rua X, 1",
                                       "bairro": "Bairro Teste", "cidade": "Cidade Teste", "estado": "PR", "quartos": 3, "vagas": 2,
                                       "area_util": 120, "valor_venda": 500000, "banheiros": 2}).json()
    neg = admin.post("/leads", json={"nome": nome, "imovel_id": im["id"]}).json()
    return im, neg


def test_match_vitrine_e_reacao(admin):
    im, neg = _negocio_com_imovel(admin)
    sug = admin.get(f"/leads/{neg['id']}/perfil").json()
    assert sug["perfil"] is None and sug["sugestao"]["bairros"] == ["Bairro Teste"]
    assert admin.put(f"/leads/{neg['id']}/perfil", json=sug["sugestao"]).status_code == 200
    comp = admin.get(f"/leads/{neg['id']}/compativeis").json()
    alvo = next(c for c in comp if c["imovel"]["id"] == im["id"])
    assert alvo["score"] >= 90
    assert any(i["negocio_id"] == neg["id"] for i in admin.get(f"/imoveis/{im['id']}/interessados").json())
    v = admin.post(f"/leads/{neg['id']}/vitrines", json={"imovel_ids": [im["id"]]}).json()
    pub = _publico()
    pagina = pub.get(f"/publico/vitrine/{v['token']}")
    assert pagina.status_code == 200 and "Rua X" not in pagina.text  # endereço exato nunca aparece
    assert pub.post(f"/publico/vitrine/{v['token']}/reacao", json={"imovel_id": im["id"], "reacao": "quero_visitar"}).status_code == 204
    assert pub.post(f"/publico/vitrine/{v['token']}/reacao", json={"imovel_id": "outro", "reacao": "gostei"}).status_code == 404
    assert any("visita pedida" in a["assunto"] for a in admin.get(f"/atividades?negocio_id={neg['id']}").json())
    admin.delete(f"/vitrines/{v['id']}")
    assert pub.get(f"/publico/vitrine/{v['token']}").status_code == 404


def test_propostas_cadeia_aceite_e_pdf(admin):
    im, neg = _negocio_com_imovel(admin, "Teste propostas")
    r = admin.post(f"/leads/{neg['id']}/propostas", json={"valor": 450000, "formas_pagamento": ["financiamento"], "sinal": 500000})
    assert r.status_code == 422  # sinal maior que o valor
    p1 = admin.post(f"/leads/{neg['id']}/propostas", json={"valor": 450000, "formas_pagamento": ["financiamento"]}).json()
    assert p1["status"] == "enviada" and p1["desconto_pct"] == 10.0
    p2 = admin.post(f"/propostas/{p1['id']}/contraproposta", json={"valor": 480000}).json()
    assert p2["autor"] == "proprietario" and p2["parent_id"] == p1["id"]
    assert admin.post(f"/propostas/{p1['id']}/responder", json={"status": "aceita"}).status_code == 409
    assert admin.post(f"/propostas/{p2['id']}/responder", json={"status": "aceita"}).json()["status"] == "aceita"
    assert admin.get(f"/leads/{neg['id']}").json()["negocio"]["valor_estimado"] == 480000
    pdf = admin.get(f"/propostas/{p2['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_portais_feed_e_lead_idempotente(admin):
    import xml.etree.ElementTree as ET

    im, _ = _negocio_com_imovel(admin, "Teste portais")
    admin.put(f"/imoveis/{im['id']}", json={"publicar_portais": True})
    cfg = admin.get("/portais/config").json()
    if not cfg["liberado"]:
        pytest.skip("plano da empresa de teste sem portais")
    token = cfg["feed_url"].split("/portais/")[1].split("/")[0]
    pub = _publico()
    feed = pub.get(f"/publico/portais/{token}/vrsync.xml")
    assert feed.status_code == 200
    ET.fromstring(feed.content)  # XML bem formado
    assert any(p["imovel_id"] == im["id"] and "fotos" in p["faltando"] for p in cfg["pendencias"])  # sem foto não entra
    lead = {"leadOrigin": "Grupo OLX", "originLeadId": f"t-{im['id']}", "clientListingId": im["codigo"], "name": "Lead Portal", "ddd": "41", "phone": "999990000"}
    r1 = pub.post(f"/publico/portais/{token}/leads", json=lead).json()
    r2 = pub.post(f"/publico/portais/{token}/leads", json=lead).json()
    assert r1["lead_id"] == r2["lead_id"] and r1["imovel_vinculado"]
    assert pub.post(f"/publico/portais/{token}/leads", json={**lead, "originLeadId": "x", "clientListingId": ""}).status_code == 422
    assert pub.get("/publico/portais/token-invalido-com-mais-de-vinte/vrsync.xml").status_code == 404


def test_relatorio_proprietario_sem_dados_de_clientes(admin):
    im, neg = _negocio_com_imovel(admin, "Cliente Sigiloso da Silva")
    admin.post(f"/leads/{neg['id']}/propostas", json={"valor": 470000})
    link = admin.post(f"/imoveis/{im['id']}/relatorio-proprietario").json()
    r = _publico().get(f"/publico{link['url']}")
    assert r.status_code == 200
    assert "Sigiloso" not in r.text and r.json()["propostas"][0]["valor"] == 470000


def test_automacao_lead_novo_e_sla(admin):
    cfg = admin.get("/crm/config").json()
    if not any(a["gatilho"] == "lead_novo" and a["ativo"] for a in cfg.get("automacoes", [])):
        pytest.skip("automação de lead novo desligada")
    e = admin.post("/entradas", json={"nome": "Lead SLA", "telefone": "(41) 90000-1111"}).json()
    ativ = [a for a in admin.get("/atividades?pendentes=true").json() if a.get("entrada_id") == e["id"]]
    assert ativ and ativ[0]["created_by"] == "automacao"
    admin.patch(f"/atividades/{ativ[0]['id']}", json={"concluida": True})
    entrada = next(x for x in admin.get("/entradas?status=todos").json() if x["id"] == e["id"])
    assert entrada["primeiro_contato_em"] and entrada["status"] == "em_contato"
    assert admin.get("/relatorios/atendimento").json()["respondidos"] >= 1


def test_fotos_do_imovel(admin):
    im, _ = _negocio_com_imovel(admin, "Teste fotos")
    png = base64.b64decode(_png().split(",")[1])
    r = admin.post(f"/imoveis/{im['id']}/fotos", files=[("arquivos", ("a.png", png, "image/png"))])
    assert r.status_code == 201
    foto = r.json()[0]
    assert _publico().get(foto["url"].removeprefix("/api")).headers["content-type"] == "image/png"
    assert admin.post(f"/imoveis/{im['id']}/fotos", files=[("arquivos", ("x.png", b"<svg/>", "image/png"))]).status_code == 415
    assert admin.get("/plano").json()["nome"]
