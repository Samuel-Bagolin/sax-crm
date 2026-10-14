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
