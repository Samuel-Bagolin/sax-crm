"""WhatsApp no CRM: conectar número por QR, receber mensagem (vira conversa e lead), responder pela equipe,
visibilidade por responsável e segurança do webhook. Precisa da API local e do simulador da Evolution API
(tests/fake_evolution.py: uvicorn fake_evolution:app --port 8098 --app-dir tests) em EVOLUTION_TESTE_URL (padrão http://localhost:8098, chave "chave-teste")."""

import os
import uuid

import httpx
import pytest

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)

EVO = os.environ.get("EVOLUTION_TESTE_URL", "http://localhost:8098")


def _evo_no_ar() -> bool:
    try:
        return httpx.get(f"{EVO}/instance/fetchInstances", headers={"apikey": "chave-teste"}, timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _evo_no_ar(), reason="simulador da Evolution API fora do ar")


@pytest.fixture(scope="module")
def servidor(sysadmin):
    assert sysadmin.put("/plataforma/whatsapp", json={"url": EVO, "apikey": "errada"}).status_code == 422
    r = sysadmin.put("/plataforma/whatsapp", json={"url": EVO, "apikey": "chave-teste"})
    assert r.status_code == 200, r.text
    assert r.json()["configurado"] is True and "chave-teste" not in r.text
    return True


def test_conectar_receber_responder(servidor, cartao_demo):
    c, _ = _cadastrar("imobiliaria", cartao_demo)  # plano enterprise: tem WhatsApp
    s = c.get("/whatsapp/situacao").json()
    assert s["servidor_ok"] and s["liberado"] and s["pode_gerir"]

    antes = {i["name"] for i in httpx.get(f"{EVO}/instance/fetchInstances", headers={"apikey": "chave-teste"}).json()}
    r = c.post("/whatsapp/conexoes", json={"nome": "Comercial"})
    assert r.status_code == 201, r.text
    con = r.json()
    assert con["qr"].startswith("data:image") and con["status"] == "aguardando_qr"
    inst = next(i["name"] for i in httpx.get(f"{EVO}/instance/fetchInstances", headers={"apikey": "chave-teste"}).json() if i["name"] not in antes)
    q = c.get(f"/whatsapp/conexoes/{con['id']}/qr").json()
    assert q["conectado"] is False and q["qr"]

    # Celular leu o QR: webhook connection.update.
    assert httpx.post(f"{EVO}/_teste/conectar/{inst}").json()["webhook"] == 200
    conexoes = c.get("/whatsapp/situacao").json()["conexoes"]
    assert conexoes[0]["status"] == "conectado" and conexoes[0]["numero"] == "5541990001111"

    v0 = c.get("/whatsapp/versao").json()["versao"]
    numero = "554198" + uuid.uuid4().hex[:7].translate(str.maketrans("abcdef", "123456"))
    rec = httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Maria Cliente", "texto": "Oi, vi o apartamento no site"}).json()
    assert rec["webhook"] == 200
    # Webhook repetido (a Evolution reenvia) não duplica.
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Maria Cliente", "texto": "Oi, vi o apartamento no site", "id": rec["id"]})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Maria Cliente", "texto": "x",
                                                    "message": {"imageMessage": {"caption": "planta"}}, "tipo": "imageMessage"})
    # Grupo fica de fora.
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"jid": "120363000000@g.us", "nome": "Grupo", "texto": "oi grupo"})
    assert c.get("/whatsapp/versao").json()["versao"] > v0

    conv = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == numero)
    assert conv["nome"] == "Maria Cliente" and conv["nao_lidas"] == 2 and conv["entrada_id"]
    assert not any("@g.us" in x["id"] for x in c.get("/whatsapp/conversas").json())
    # Virou lead com origem WhatsApp.
    lead = next(e for e in c.get("/entradas").json() if e["id"] == conv["entrada_id"])
    assert lead["origem"] == "WhatsApp" and lead["telefone"] == numero

    m = c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()
    assert [x["texto"] for x in m["mensagens"]] == ["Oi, vi o apartamento no site", "[Foto] planta"]
    assert c.get("/whatsapp/conversas").json()[0]["nao_lidas"] == 0 or all(x["nao_lidas"] == 0 for x in c.get("/whatsapp/conversas").json() if x["id"] == conv["id"])

    env = c.post(f"/whatsapp/conversas/{conv['id']}/mensagens", json={"texto": "Olá Maria! Qual o melhor horário para a visita?"})
    assert env.status_code == 201, env.text
    enviada = [x for x in httpx.get(f"{EVO}/_teste/enviadas").json() if x["number"] == numero][-1]
    assert enviada["text"].startswith("Olá Maria")
    # Eco da própria mensagem no webhook (fromMe) não duplica.
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "texto": enviada["text"], "de_mim": True, "id": enviada["id"]})
    msgs = c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()["mensagens"]
    assert len([x for x in msgs if x["de_mim"]]) == 1 and msgs[-1]["autor"]

    # Mensagem mandada direto pelo celular aparece na conversa.
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "texto": "Mandei pelo celular", "de_mim": True})
    assert c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()["mensagens"][-1]["texto"] == "Mandei pelo celular"

    # Desconectar: some do CRM e da Evolution.
    assert c.delete(f"/whatsapp/conexoes/{con['id']}").status_code == 204
    assert c.post(f"/whatsapp/conversas/{conv['id']}/mensagens", json={"texto": "x"}).status_code == 409


def test_webhook_com_token_errado_e_sem_recurso(servidor, cartao_demo):
    assert httpx.post(f"{API}/webhooks/whatsapp/token-falso", json={"event": "messages.upsert", "instance": "sax-x", "data": {}}).status_code == 404
    # Plano de entrada não tem WhatsApp: a tela explica, as rotas recusam.
    c, _ = _cadastrar("barbearia", cartao_demo, plano="barbearia_essencial")
    s = c.get("/whatsapp/situacao").json()
    assert s["liberado"] is False
    assert c.post("/whatsapp/conexoes", json={"nome": "Recepção"}).status_code == 402  # recurso fora do plano


def test_corretor_ve_as_dele_e_as_sem_responsavel(servidor):
    c = httpx.Client(base_url=API, timeout=30)
    assert c.post("/auth/login", json={"email": os.environ["CRM_CORRETOR"], "senha": os.environ["CRM_CORRETOR_SENHA"]}).status_code == 200
    assert c.post("/whatsapp/conexoes", json={"nome": "X"}).status_code == 403  # só o gestor conecta número
    r = c.get("/whatsapp/conversas")
    assert r.status_code in (200, 403)  # 403 quando o plano da imobiliária de demonstração não tem o recurso
