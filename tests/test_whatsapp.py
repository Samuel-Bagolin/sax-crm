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
    # Desde out/2026 o WhatsApp vem em todos os planos, inclusive o de entrada.
    c, _ = _cadastrar("barbearia", cartao_demo, plano="barbearia_essencial")
    assert c.get("/whatsapp/situacao").json()["liberado"] is True


def test_corretor_ve_as_dele_e_as_sem_responsavel(servidor):
    c = httpx.Client(base_url=API, timeout=30)
    assert c.post("/auth/login", json={"email": os.environ["CRM_CORRETOR"], "senha": os.environ["CRM_CORRETOR_SENHA"]}).status_code == 200
    r = c.get("/whatsapp/conversas")
    assert r.status_code in (200, 403)  # 403 quando o plano da imobiliária de demonstração não tem o recurso


def _membro(c: httpx.Client, nome: str) -> tuple[httpx.Client, str]:
    email = f"{nome.lower()}.{uuid.uuid4().hex[:5]}@exemplo.com"
    assert c.post("/usuarios", json={"nome": nome, "email": email, "senha": "SenhaForte#123", "papel": "corretor"}).status_code == 201
    s = httpx.Client(base_url=API, timeout=60)
    me = s.post("/auth/login", json={"email": email, "senha": "SenhaForte#123"})
    assert me.status_code == 200
    return s, me.json()["pessoa_id"]


def _conectar(c: httpx.Client, nome: str) -> tuple[dict, str]:
    antes = {i["name"] for i in httpx.get(f"{EVO}/instance/fetchInstances", headers={"apikey": "chave-teste"}).json()}
    con = c.post("/whatsapp/conexoes", json={"nome": nome}).json()
    inst = next(i["name"] for i in httpx.get(f"{EVO}/instance/fetchInstances", headers={"apikey": "chave-teste"}).json() if i["name"] not in antes)
    httpx.post(f"{EVO}/_teste/conectar/{inst}")
    return con, inst


def _numero() -> str:
    return "554197" + uuid.uuid4().hex[:7].translate(str.maketrans("abcdef", "123456"))


def test_numero_do_usuario_comum_so_ele_ve(servidor, cartao_demo):
    """Quem não é gestor conecta o próprio WhatsApp: as conversas são só dele; o gestor vê todos os números."""
    c, _ = _cadastrar("imobiliaria", cartao_demo)
    ana, ana_id = _membro(c, "Ana")
    bia, _ = _membro(c, "Bia")
    con, inst = _conectar(ana, "Celular da Ana")
    assert con["pessoal"] and con["dono_nome"].startswith("Ana")
    assert con["id"] in [x["id"] for x in c.get("/whatsapp/situacao").json()["conexoes"]]  # gestor vê
    assert con["id"] in [x["id"] for x in ana.get("/whatsapp/situacao").json()["conexoes"]]
    assert con["id"] not in [x["id"] for x in bia.get("/whatsapp/situacao").json()["conexoes"]]
    assert bia.get(f"/whatsapp/conexoes/{con['id']}/qr").status_code == 404
    assert bia.delete(f"/whatsapp/conexoes/{con['id']}").status_code == 404
    n = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n, "nome": "Cliente da Ana", "texto": "Oi Ana"})
    conv = [x for x in ana.get("/whatsapp/conversas").json() if x["nome"] == "Cliente da Ana"]
    assert conv and conv[0]["responsavel_id"] == ana_id
    assert not [x for x in bia.get("/whatsapp/conversas").json() if x["nome"] == "Cliente da Ana"]
    assert [x for x in c.get("/whatsapp/conversas").json() if x["nome"] == "Cliente da Ana"]
    assert ana.delete(f"/whatsapp/conexoes/{con['id']}").status_code == 204


def test_setores_e_responsaveis_por_numero(servidor, cartao_demo):
    """Número com setor ou responsáveis: só quem atende vê. Número aberto: cada um vê as dele e as sem dono."""
    c, _ = _cadastrar("imobiliaria", cartao_demo)
    ana, ana_id = _membro(c, "Ana")
    bia, bia_id = _membro(c, "Bia")
    caio, caio_id = _membro(c, "Caio")

    # Setores com nome livre; nome repetido é recusado; pessoa de fora da equipe também.
    fin = c.post("/whatsapp/setores", json={"nome": "Financeiro", "membros": [bia_id, caio_id]})
    assert fin.status_code == 201, fin.text
    fin = fin.json()
    assert c.post("/whatsapp/setores", json={"nome": "financeiro"}).status_code == 409
    assert c.post("/whatsapp/setores", json={"nome": "Operações", "membros": ["pessoa-de-outra-empresa"]}).status_code == 422
    assert ana.post("/whatsapp/setores", json={"nome": "Meu setor"}).status_code == 403  # só o gestor cria

    comercial, inst_com = _conectar(c, "Comercial")
    financeiro, inst_fin = _conectar(c, "Financeiro")
    aberto, inst_ab = _conectar(c, "Recepção")

    # Comercial: só a Ana. Financeiro: setor Financeiro (Bia e Caio). Recepção: aberto.
    r = c.put(f"/whatsapp/conexoes/{comercial['id']}", json={"nome": "Comercial", "responsaveis": [ana_id]})
    assert r.status_code == 200 and r.json()["responsaveis"] == [ana_id]
    assert c.put(f"/whatsapp/conexoes/{financeiro['id']}", json={"nome": "Financeiro", "setor_id": fin["id"]}).status_code == 200
    assert c.put(f"/whatsapp/conexoes/{aberto['id']}", json={"nome": "Recepção", "setor_id": "nao-existe"}).status_code == 422
    assert ana.put(f"/whatsapp/conexoes/{comercial['id']}", json={"nome": "X", "responsaveis": [ana_id]}).status_code == 403

    n_com, n_fin, n_ab = _numero(), _numero(), _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst_com}", json={"numero": n_com, "nome": "Cliente Comercial", "texto": "Quero comprar"})
    httpx.post(f"{EVO}/_teste/receber/{inst_fin}", json={"numero": n_fin, "nome": "Cliente Boleto", "texto": "Segunda via do boleto"})
    httpx.post(f"{EVO}/_teste/receber/{inst_ab}", json={"numero": n_ab, "nome": "Cliente Recepção", "texto": "Oi"})

    def tels(s, **params):
        return {x["telefone"] for x in s.get("/whatsapp/conversas", params=params).json()}

    # Gestor vê tudo.
    assert {n_com, n_fin, n_ab} <= tels(c)
    # Comercial tem uma pessoa só: a conversa já nasce da Ana (e o lead também).
    conv_com = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == n_com)
    assert conv_com["responsavel_id"] == ana_id
    lead = next(e for e in c.get("/entradas").json() if e["id"] == conv_com["entrada_id"])
    assert lead["corretor_id"] == ana_id
    # Financeiro tem duas pessoas: fica sem dono, as duas veem; a Ana não.
    conv_fin = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == n_fin)
    assert conv_fin["responsavel_id"] is None

    assert tels(ana) >= {n_com, n_ab} and n_fin not in tels(ana)
    assert tels(bia) >= {n_fin, n_ab} and n_com not in tels(bia)
    assert n_fin in tels(caio) and n_com not in tels(caio)
    # Quem não atende o número não abre nem responde a conversa (404, não 403).
    assert bia.get(f"/whatsapp/conversas/{conv_com['id']}/mensagens").status_code == 404
    assert bia.post(f"/whatsapp/conversas/{conv_com['id']}/mensagens", json={"texto": "oi"}).status_code == 404
    # Situação: cada um só vê os números que atende e os abertos.
    nomes_bia = {x["nome"] for x in bia.get("/whatsapp/situacao").json()["conexoes"]}
    assert nomes_bia == {"Financeiro", "Recepção"}
    assert {x["nome"] for x in bia.get("/whatsapp/situacao").json()["setores"]} == {"Financeiro"}

    # Bia responde primeiro e fica com a conversa; o Caio continua vendo (atende o número inteiro).
    assert bia.post(f"/whatsapp/conversas/{conv_fin['id']}/mensagens", json={"texto": "Mando agora"}).status_code == 201
    assert next(x for x in c.get("/whatsapp/conversas").json() if x["id"] == conv_fin["id"])["responsavel_id"] == bia_id
    assert n_fin in tels(caio)
    assert n_fin in tels(bia, filtro="minhas") and n_fin not in tels(caio, filtro="minhas")

    # Filtros do gestor por setor e por número.
    assert tels(c, setor_id=fin["id"]) == {n_fin}
    assert tels(c, conexao_id=comercial["id"]) == {n_com}

    # Gestor passa a conversa do Comercial para o Caio: ela aparece para ele mesmo sem atender o número.
    # A Ana continua vendo, porque é responsável pelo número inteiro.
    assert c.put(f"/whatsapp/conversas/{conv_com['id']}/responsavel", json={"pessoa_id": caio_id}).status_code == 200
    assert n_com in tels(caio) and n_com in tels(ana)
    assert caio.get(f"/whatsapp/conversas/{conv_com['id']}/mensagens").status_code == 200

    # Remover o setor: o número Financeiro fica aberto; conversa da Bia continua dela, a Ana não vê a dela.
    assert c.delete(f"/whatsapp/setores/{fin['id']}").status_code == 204
    assert next(x for x in c.get("/whatsapp/situacao").json()["conexoes"] if x["id"] == financeiro["id"])["setor_id"] is None
    assert n_fin not in tels(ana)
    for con in (comercial, financeiro, aberto):
        c.delete(f"/whatsapp/conexoes/{con['id']}")


def test_audio_foto_do_contato_e_imagem(servidor, cartao_demo):
    c, _ = _cadastrar("imobiliaria", cartao_demo)
    con, inst = _conectar(c, "Comercial")
    numero = _numero()
    audio = {"audioMessage": {"url": "https://mmg.whatsapp.net/x", "mimetype": "audio/ogg; codecs=opus", "seconds": 7,
                              "mediaKey": "abc=", "ptt": True, "waveform": "AAAA"}}
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Cliente Áudio", "texto": "x", "message": audio, "tipo": "audioMessage"})
    foto = {"imageMessage": {"url": "https://mmg.whatsapp.net/y", "mimetype": "image/jpeg", "caption": "fachada", "jpegThumbnail": "QUJD"}}
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Cliente Áudio", "texto": "x", "message": foto, "tipo": "imageMessage"})

    conv = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == numero)
    msgs = c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()["mensagens"]
    m_audio, m_foto = msgs[0], msgs[1]
    assert m_audio["midia"]["tipo"] == "audio" and m_audio["midia"]["segundos"] == 7
    assert m_foto["midia"]["tipo"] == "imagem" and m_foto["texto"] == "[Foto] fachada"

    # Áudio: pede à Evolution em MP4 (toca no Safari) com a mensagem crua, sem miniatura nem onda.
    r = c.get(f"/whatsapp/mensagens/{m_audio['id']}/midia")
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/mp4") and r.content == b"ID3fake-audio-bytes"
    pedido = httpx.get(f"{EVO}/_teste/midia").json()[-1]
    assert pedido["convertToMp4"] is True and "waveform" not in pedido["message"]["message"]["audioMessage"]
    assert pedido["message"]["key"]["id"] == m_audio["id"].split("|", 1)[1]
    img = c.get(f"/whatsapp/mensagens/{m_foto['id']}/midia")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    # Texto não tem arquivo.
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Cliente Áudio", "texto": "só texto"})
    texto = c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()["mensagens"][-1]
    assert texto["midia"] is None and c.get(f"/whatsapp/mensagens/{texto['id']}/midia").status_code == 404

    # Foto do contato: vem do WhatsApp, servida pelo CRM; sem foto, 404 (a tela mostra as iniciais).
    f = c.get(f"/whatsapp/conversas/{conv['id']}/foto")
    assert f.status_code == 200 and f.headers["content-type"] == "image/png"
    sem = _numero()[:-4] + "0000"
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": sem, "nome": "Sem Foto", "texto": "oi"})
    conv2 = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == sem)
    assert c.get(f"/whatsapp/conversas/{conv2['id']}/foto").status_code == 404

    # Quem não pode ver a conversa não baixa o arquivo nem a foto.
    outro, _ = _membro(c, "Dani")
    pid = c.get("/equipe").json()
    c.put(f"/whatsapp/conexoes/{con['id']}", json={"nome": "Comercial", "responsaveis": [p["pessoa_id"] for p in pid if p["nome"] == "Dona Teste"][:1]})
    assert outro.get(f"/whatsapp/mensagens/{m_audio['id']}/midia").status_code == 404
    assert outro.get(f"/whatsapp/conversas/{conv['id']}/foto").status_code == 404
    c.delete(f"/whatsapp/conexoes/{con['id']}")


def test_enviar_audio_e_arquivo(servidor, cartao_demo):
    import base64

    c, _ = _cadastrar("imobiliaria", cartao_demo)
    con, inst = _conectar(c, "Comercial")
    numero = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": numero, "nome": "Cliente Mídia", "texto": "Oi"})
    conv = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == numero)
    audio = base64.b64encode(b"webm-fake-audio" * 20).decode()
    r = c.post(f"/whatsapp/conversas/{conv['id']}/midia", json={"audio": True, "base64": audio, "mime": "audio/webm", "segundos": 4})
    assert r.status_code == 201, r.text
    assert r.json()["midia"]["tipo"] == "audio" and r.json()["texto"] == "[Áudio]"
    pdf = base64.b64encode(b"%PDF-1.4 fake").decode()
    r2 = c.post(f"/whatsapp/conversas/{conv['id']}/midia", json={"base64": pdf, "mime": "application/pdf", "nome": "proposta.pdf", "legenda": "Segue a proposta"})
    assert r2.status_code == 201 and r2.json()["midia"]["tipo"] == "documento" and "Segue a proposta" in r2.json()["texto"]
    img = base64.b64encode(b"\x89PNG fake").decode()
    r3 = c.post(f"/whatsapp/conversas/{conv['id']}/midia", json={"base64": img, "mime": "image/png", "nome": "fachada.png"})
    assert r3.json()["midia"]["tipo"] == "imagem"
    enviadas = [x for x in httpx.get(f"{EVO}/_teste/enviadas").json() if x["number"] == numero]
    assert [x["tipo"] for x in enviadas[-3:]] == ["audio", "document", "image"]
    assert enviadas[-2]["fileName"] == "proposta.pdf" and enviadas[-2]["caption"] == "Segue a proposta"
    # Arquivo grande demais e conteúdo inválido.
    grande = base64.b64encode(b"x" * (3 * 1024 * 1024 + 10)).decode()
    assert c.post(f"/whatsapp/conversas/{conv['id']}/midia", json={"base64": grande, "mime": "application/pdf"}).status_code == 413
    assert c.post(f"/whatsapp/conversas/{conv['id']}/midia", json={"base64": "@@@@@@@@", "mime": "application/pdf"}).status_code == 422
    # Aparece na conversa como mensagem da equipe, com arquivo.
    msgs = c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()["mensagens"]
    assert [m["midia"]["tipo"] for m in msgs if m["de_mim"]] == ["audio", "documento", "imagem"]
    c.delete(f"/whatsapp/conexoes/{con['id']}")


def test_fluxo_de_resposta(servidor, cartao_demo):
    c, _ = _cadastrar("imobiliaria", cartao_demo)
    ana, ana_id = _membro(c, "Ana")
    bia, bia_id = _membro(c, "Bia")
    fin = c.post("/whatsapp/setores", json={"nome": "Financeiro", "membros": [bia_id]}).json()
    con, inst = _conectar(c, "Comercial")

    fluxo = {"nome": "Boas-vindas", "gatilho": "nova_conversa", "passos": [
        {"id": "ola", "tipo": "mensagem", "texto": "Olá! Aqui é a Imobiliária Teste.", "proximo": "menu"},
        {"id": "menu", "tipo": "menu", "texto": "Como podemos ajudar?", "opcoes": [
            {"rotulo": "Comprar imóvel", "proximo": "vendas"}, {"rotulo": "Segunda via de boleto", "proximo": "fin"}, {"rotulo": "Horário", "proximo": "hora"}]},
        {"id": "vendas", "tipo": "transferir", "texto": "Vou te passar para a Ana.", "destino_tipo": "pessoa", "destino_id": ana_id},
        {"id": "fin", "tipo": "transferir", "texto": "Vou te passar para o financeiro.", "destino_tipo": "setor", "destino_id": fin["id"]},
        {"id": "hora", "tipo": "encerrar", "texto": "Atendemos de segunda a sexta, das 9h às 18h."},
    ]}
    # Validações.
    ruim = {**fluxo, "passos": [{"id": "a", "tipo": "menu", "texto": "x", "opcoes": [{"rotulo": "1", "proximo": "nao-existe"}, {"rotulo": "2"}]}]}
    assert c.post("/whatsapp/fluxos", json=ruim).status_code == 422
    assert ana.post("/whatsapp/fluxos", json=fluxo).status_code == 403
    r = c.post("/whatsapp/fluxos", json=fluxo)
    assert r.status_code == 201, r.text
    # Dois fluxos de boas-vindas ativos no mesmo número: recusa.
    assert c.post("/whatsapp/fluxos", json={**fluxo, "nome": "Outro"}).status_code == 409
    chave = c.post("/whatsapp/fluxos", json={"nome": "Endereço", "gatilho": "palavra_chave", "palavras": ["endereço", "onde fica"],
                                            "passos": [{"id": "end", "tipo": "encerrar", "texto": "Rua das Flores, 100."}]})
    assert chave.status_code == 201, chave.text

    def enviadas(num):
        return [x["text"] for x in httpx.get(f"{EVO}/_teste/enviadas").json() if x["number"] == num and "text" in x]

    # Cliente novo recebe as boas-vindas e o menu.
    n1 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n1, "nome": "Cliente Um", "texto": "Boa tarde"})
    textos = enviadas(n1)
    assert textos[0].startswith("Olá!") and "1. Comprar imóvel" in textos[1] and "2. Segunda via de boleto" in textos[1]
    conv1 = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == n1)
    assert conv1["robo"] is True and conv1["responsavel_id"] is None
    # Resposta fora do menu: pede de novo.
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n1, "nome": "Cliente Um", "texto": "hã?"})
    assert enviadas(n1)[-1].startswith("Não entendi")
    # Escolhe 1: vai para a Ana (e o lead também).
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n1, "nome": "Cliente Um", "texto": "1"})
    assert enviadas(n1)[-1] == "Vou te passar para a Ana."
    conv1 = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == n1)
    assert conv1["responsavel_id"] == ana_id and conv1["robo"] is False
    lead = next(e for e in c.get("/entradas").json() if e["id"] == conv1["entrada_id"])
    assert lead["corretor_id"] == ana_id
    msgs = c.get(f"/whatsapp/conversas/{conv1['id']}/mensagens").json()["mensagens"]
    assert any(m["autor"] == "Atendimento automático" for m in msgs)

    # Outro cliente escolhe o financeiro pelo texto: vai para o setor (a Bia vê, a Ana não).
    n2 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n2, "nome": "Cliente Dois", "texto": "Oi"})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n2, "nome": "Cliente Dois", "texto": "segunda via de boleto"})
    conv2 = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == n2)
    assert conv2["setor_id"] == fin["id"] and conv2["responsavel_id"] is None
    assert any(x["telefone"] == n2 for x in bia.get("/whatsapp/conversas").json())

    # Quando alguém da equipe responde, o robô para.
    n3 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n3, "nome": "Cliente Três", "texto": "Oi"})
    conv3 = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == n3)
    assert conv3["robo"] is True
    c.post(f"/whatsapp/conversas/{conv3['id']}/mensagens", json={"texto": "Oi! Eu mesma vou te atender."})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n3, "nome": "Cliente Três", "texto": "3"})
    assert enviadas(n3)[-1] == "Oi! Eu mesma vou te atender."

    # Palavra-chave a qualquer momento (sem acento também).
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n3, "nome": "Cliente Três", "texto": "Qual o endereco de vocês?"})
    assert enviadas(n3)[-1] == "Rua das Flores, 100."

    # Fluxo desativado não responde.
    f = r.json()
    assert c.put(f"/whatsapp/fluxos/{f['id']}", json={**fluxo, "ativo": False}).status_code == 200
    n4 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n4, "nome": "Cliente Quatro", "texto": "Oi"})
    assert enviadas(n4) == []
    assert c.delete(f"/whatsapp/fluxos/{f['id']}").status_code == 204
    c.delete(f"/whatsapp/conexoes/{con['id']}")


def test_fluxo_com_link_de_agenda_e_profissional_citado(servidor, cartao_demo):
    """Barbearia: quem cita o barbeiro recebe a agenda dele; o menu manda a agenda da casa; link livre e catálogo validados."""
    c, _ = _cadastrar("barbearia", cartao_demo)
    for nome in ("Diego Souza", "Rafa Lima"):
        assert c.post("/usuarios", json={"nome": nome, "email": f"{nome.split()[0].lower()}.{uuid.uuid4().hex[:5]}@exemplo.com",
                                         "senha": "SenhaForte#123", "papel": "corretor"}).status_code == 201
    profs = {p["nome"]: p for p in c.get("/atendimentos/profissionais?todos=true").json()}
    for nome in ("Diego Souza", "Rafa Lima"):
        assert c.put(f"/atendimentos/profissionais/{profs[nome]['id']}", json={"atende": True, "online": True}).status_code == 200
    passo_link = {"id": "ag", "tipo": "link", "link_tipo": "agenda_citado", "texto": "Fechou! Agenda do {nome}: {link}"}
    citado = {"nome": "Barbeiro citado", "gatilho": "profissional", "passos": [passo_link]}
    # sem agenda online ligada não deixa salvar
    r = c.post("/whatsapp/fluxos", json=citado)
    assert r.status_code == 422 and "agenda online" in r.json()["detail"]
    slug = f"barba-{uuid.uuid4().hex[:6]}"
    assert c.put("/atendimentos/config", json={"ativo": True, "slug": slug}).status_code == 200
    assert c.post("/whatsapp/fluxos", json=citado).status_code == 201, r.text

    opcoes = c.get("/whatsapp/fluxos/opcoes-link").json()
    assert opcoes["agenda"].endswith(f"/agendar/{slug}") and len(opcoes["profissionais"]) >= 2 and opcoes["catalogo"] is None
    diego = next(p for p in opcoes["profissionais"] if p["nome"] == "Diego Souza")
    assert diego["url"].startswith(f"{opcoes['agenda']}/")

    # validações do passo de link
    def um_passo(p):
        return {"nome": "Teste link", "gatilho": "palavra_chave", "palavras": ["teste"], "passos": [p]}
    assert c.post("/whatsapp/fluxos", json=um_passo({"id": "u", "tipo": "link", "link_tipo": "url", "url": "ftp://x"})).status_code == 422
    assert c.post("/whatsapp/fluxos", json=um_passo({"id": "u", "tipo": "link", "link_tipo": "catalogo"})).json()["detail"].startswith("Passo 1: publique o site")
    assert c.post("/whatsapp/fluxos", json=um_passo({"id": "u", "tipo": "link", "link_tipo": "agenda_profissional"})).status_code == 422
    assert c.post("/whatsapp/fluxos", json=um_passo({"id": "u", "tipo": "link"})).status_code == 422

    menu = {"nome": "Boas-vindas", "gatilho": "nova_conversa", "passos": [
        {"id": "m", "tipo": "menu", "texto": "Fala! O que você precisa?", "opcoes": [
            {"rotulo": "Agendar horário", "proximo": "ag"}, {"rotulo": "Agendar com o Rafa", "proximo": "rafa"}, {"rotulo": "Instagram", "proximo": "ig"}]},
        {"id": "ag", "tipo": "link", "link_tipo": "agenda", "texto": "Escolha o melhor horário:", "proximo": "tchau"},
        {"id": "rafa", "tipo": "link", "link_tipo": "agenda_profissional", "destino_id": profs["Rafa Lima"]["id"], "texto": "Agenda do {nome}: {link}"},
        {"id": "ig", "tipo": "link", "link_tipo": "url", "url": "https://instagram.com/barbearia.teste", "texto": "Segue a gente:"},
        {"id": "tchau", "tipo": "encerrar", "texto": "Qualquer coisa, é só chamar."},
    ]}
    r = c.post("/whatsapp/fluxos", json=menu)
    assert r.status_code == 201, r.text
    assert r.json()["passos"][1]["link_tipo"] == "agenda"
    con, inst = _conectar(c, "Recepção")

    def enviadas(num):
        return [x["text"] for x in httpx.get(f"{EVO}/_teste/enviadas").json() if x["number"] == num and "text" in x]

    # chegou citando o barbeiro: vale o fluxo do nome, não o de boas-vindas
    n1 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n1, "nome": "Cliente", "texto": "Quero cortar com o diego amanhã"})
    assert enviadas(n1) == [f"Fechou! Agenda do Diego Souza: {diego['url']}"]

    # conversa nova sem nome: menu; opção 1 manda a agenda da casa (link numa linha no fim) e segue
    n2 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n2, "nome": "Cliente 2", "texto": "Boa tarde"})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n2, "nome": "Cliente 2", "texto": "1"})
    t = enviadas(n2)
    assert t[1] == f"Escolha o melhor horário:\n{opcoes['agenda']}" and t[2] == "Qualquer coisa, é só chamar."
    n3 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n3, "nome": "Cliente 3", "texto": "Oi"})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n3, "nome": "Cliente 3", "texto": "3"})
    assert enviadas(n3)[-1] == "Segue a gente:\nhttps://instagram.com/barbearia.teste"
    n4 = _numero()
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n4, "nome": "Cliente 4", "texto": "Oi"})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": n4, "nome": "Cliente 4", "texto": "2"})
    rafa = next(p for p in opcoes["profissionais"] if p["nome"] == "Rafa Lima")
    assert enviadas(n4)[-1] == f"Agenda do Rafa Lima: {rafa['url']}"
    c.delete(f"/whatsapp/conexoes/{con['id']}")


def test_campanha_em_massa_com_limite_e_sair(servidor, cartao_demo, sysadmin):  # noqa: F811
    """Campanha: só contatos com telefone que já conversaram, uma mensagem por toque, SAIR tira da lista."""
    c, _ = _cadastrar("barbearia", cartao_demo)
    con, inst = _conectar(c, "Principal")
    tel_ja, tel_novo = _numero(), _numero()
    ja = c.post("/pessoas", json={"nome": "joão conversou", "papeis": ["cliente"], "telefone": f"({tel_ja[2:4]}) {tel_ja[4:]}"}).json()
    c.post("/pessoas", json={"nome": "Nunca Falou", "papeis": ["cliente"], "telefone": tel_novo[2:]})
    c.post("/pessoas", json={"nome": "Sem Telefone", "papeis": ["cliente"]})
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": tel_ja, "nome": "João", "texto": "Oi"})

    p = c.post("/whatsapp/campanhas/previa", json={"origem": "clientes"}).json()
    assert p["total"] == 1 and p["sem_conversa"] == 1 and p["sem_telefone"] >= 1 and p["amostra"] == ["joão conversou"]
    assert c.post("/whatsapp/campanhas/previa", json={"origem": "clientes", "ja_conversou": False}).json()["total"] == 2

    base = {"nome": "Volta às aulas", "conexao_id": con["id"], "mensagem": "Oi {nome}, saudade de você aqui na {empresa}!",
            "intervalo_min": 20, "intervalo_max": 30, "teto_diario": 50, "hora_inicio": "00:00", "hora_fim": "23:59", "domingo": True}
    assert c.post("/whatsapp/campanhas", json={**base, "intervalo_min": 10}).status_code == 422  # intervalo mínimo de 20 s
    assert c.post("/whatsapp/campanhas", json={**base, "intervalo_max": 20, "intervalo_min": 40}).status_code == 422
    camp = c.post("/whatsapp/campanhas", json=base).json()
    assert camp["status"] == "rascunho" and camp["total"] == 1
    assert c.post(f"/whatsapp/campanhas/{camp['id']}/iniciar").json()["status"] == "enviando"
    antes = len(httpx.get(f"{EVO}/_teste/enviadas").json())
    assert c.post("/whatsapp/campanhas/processar").json()["enviados"] == 1
    assert c.post("/whatsapp/campanhas/processar").json()["enviados"] == 0  # intervalo: não manda duas de uma vez
    env = httpx.get(f"{EVO}/_teste/enviadas").json()[antes:]
    assert len(env) == 1 and env[0]["text"].startswith("Oi João, saudade") and "responda SAIR" in env[0]["text"]
    lista = c.get(f"/whatsapp/campanhas/{camp['id']}/envios").json()
    assert lista[0]["status"] == "enviado"
    conv = next(x for x in c.get("/whatsapp/conversas").json() if x["telefone"] == tel_ja)
    ult = c.get(f"/whatsapp/conversas/{conv['id']}/mensagens").json()["mensagens"][-1]
    assert "saudade" in ult["texto"] and ult["autor"] == "Campanha: Volta às aulas"

    # responde SAIR: entra na lista de quem saiu e recebe a confirmação
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": tel_ja, "nome": "João", "texto": "Sair"})
    assert "não vai mais receber" in httpx.get(f"{EVO}/_teste/enviadas").json()[-1]["text"]
    saidas = c.get("/whatsapp/campanhas/saidas").json()
    assert [s["nome"] for s in saidas] == ["João"]
    p = c.post("/whatsapp/campanhas/previa", json={"origem": "clientes"}).json()
    assert p["total"] == 0 and p["sairam"] == 1
    assert c.post("/whatsapp/campanhas", json=base).status_code == 422

    # só o gestor
    func, _ = _membro(c, "Caio")
    assert func.get("/whatsapp/campanhas").status_code == 403
    assert c.post(f"/whatsapp/campanhas/{camp['id']}/cancelar").status_code in (200, 409)
    assert ja["id"]
    # disparador externo (agendador de 1 em 1 minuto): token do administrador da plataforma
    caminho = sysadmin.get("/plataforma/whatsapp").json()["disparador"].removeprefix("/api")
    assert httpx.get(f"{API}{caminho}").status_code == 200
    assert httpx.get(f"{API}/publico/whatsapp/disparar/token-errado-com-tamanho-bom").status_code == 404
