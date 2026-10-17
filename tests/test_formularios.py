"""Formulários, pesquisas e NPS: gestor monta, cliente responde no link, nota baixa vira tarefa, pesquisa automática
depois do atendimento concluído (link pessoal, uma resposta) e pesquisa dentro de campanha."""

from datetime import date, timedelta

import httpx

from test_segmentos import API, _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)
from test_whatsapp import EVO, _conectar, _evo_no_ar, _membro, _numero, servidor  # noqa: F401


def _token(link: str) -> str:
    return link.rsplit("/f/", 1)[-1]


def test_formulario_link_publico_nps_e_alerta(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("terapia", cartao_demo)
    me = c.get("/auth/me").json()
    f = c.post("/formularios", json={"modelo": "nps"}).json()
    assert f["perguntas"][0]["tipo"] == "nps" and f["link"] and f["alerta_pessoa_id"] == me["pessoa_id"]
    t = _token(f["link"])
    pub = httpx.get(f"{API}/publico/formularios/{t}").json()
    assert pub["perguntas"][0]["tipo"] == "nps" and pub["marca"]["empresa_nome"]
    assert httpx.get(f"{API}/publico/formularios/token-que-nao-existe-de-verdade").status_code == 404
    # validação
    assert httpx.post(f"{API}/publico/formularios/{t}", json={"respostas": {}}).status_code == 422
    assert httpx.post(f"{API}/publico/formularios/{t}", json={"respostas": {"p1": 11}}).status_code == 422
    for nota in (10, 9, 8, 3):
        r = httpx.post(f"{API}/publico/formularios/{t}", json={"respostas": {"p1": nota, "p2": "Demorou muito" if nota == 3 else ""}, "nome": f"Paciente {nota}"})
        assert r.status_code == 201, r.text
    res = c.get(f"/formularios/{f['id']}/resultado").json()
    nps = res["perguntas"][0]["nps"]
    assert res["total"] == 4 and nps == {"total": 4, "promotores": 2, "neutros": 1, "detratores": 1, "nps": 25}
    baixa = next(r for r in res["respostas"] if r["nota"] == 3)
    assert baixa["baixa"] and not baixa["tratada"]
    tarefa = [a for a in c.get("/atividades").json() if "Nota 3" in a["assunto"]]
    assert tarefa and tarefa[0]["corretor_id"] == me["pessoa_id"] and "Demorou muito" in (tarefa[0]["notas"] or "")
    assert c.post(f"/formularios/respostas/{baixa['id']}/tratar").status_code == 200
    # edição: com respostas não muda o tipo da pergunta; excluir é bloqueado
    corpo = {k: f[k] for k in ("nome", "descricao", "perguntas", "ativo", "auto_apos_atendimento", "intervalo_dias", "alerta_nota_ate")}
    mudado = {**corpo, "perguntas": [{**corpo["perguntas"][0], "tipo": "nota"}, corpo["perguntas"][1]]}
    assert c.put(f"/formularios/{f['id']}", json=mudado).status_code == 409
    assert c.delete(f"/formularios/{f['id']}").status_code == 409
    # desativado: link fecha
    assert c.put(f"/formularios/{f['id']}", json={**corpo, "ativo": False}).status_code == 200
    assert httpx.get(f"{API}/publico/formularios/{t}").status_code == 404
    # escolha sem opções não passa
    s = c.post("/formularios", json={"modelo": "vazio"}).json()
    ruim = {**corpo, "nome": "X", "perguntas": [{"id": "a", "tipo": "escolha", "titulo": "Qual?", "obrigatoria": True, "opcoes": ["Só uma"]}]}
    assert c.put(f"/formularios/{s['id']}", json=ruim).status_code == 422
    # só gestor
    func, _ = _membro(c, "Lia")
    assert func.get("/formularios").status_code == 403


def test_pesquisa_automatica_depois_do_atendimento(servidor, cartao_demo):  # noqa: F811
    c, _ = _cadastrar("barbearia", cartao_demo)
    con, inst = _conectar(c, "Recepção")
    f = c.post("/formularios", json={"modelo": "nps"}).json()
    corpo = {k: f[k] for k in ("nome", "descricao", "perguntas", "ativo", "intervalo_dias", "alerta_nota_ate")}
    assert c.put(f"/formularios/{f['id']}", json={**corpo, "auto_apos_atendimento": True, "conexao_id": con["id"],
                                                  "mensagem_whatsapp": "Valeu, {nome}! Avalia a gente: {link}"}).status_code == 200
    me = c.get("/auth/me").json()
    corte = next(s for s in c.get("/atendimentos/servicos").json() if s["nome"] == "Corte")
    jornada = {str(d): [["08:00", "20:00"]] for d in range(7)}
    c.put(f"/atendimentos/profissionais/{me['usuario_id']}", json={"atende": True, "jornada": jornada, "comissao_pct": 0})
    tel = _numero()
    a = c.post("/atendimentos", json={"profissional_id": me["usuario_id"], "servico_ids": [corte["id"]], "data": (date.today() + timedelta(days=1)).isoformat(),
                                      "inicio": "10:00", "cliente_nome": "Pedro Cliente", "cliente_telefone": tel[2:]}).json()["criados"][0]
    antes = len(httpx.get(f"{EVO}/_teste/enviadas").json())
    assert c.post(f"/atendimentos/{a['id']}/concluir", json={"valor": 50, "forma_pagamento": "pix"}).status_code == 200
    env = httpx.get(f"{EVO}/_teste/enviadas").json()[antes:]
    assert len(env) == 1 and env[0]["text"].startswith("Valeu, Pedro! Avalia a gente:") and "/f/" in env[0]["text"]
    t = env[0]["text"].split("/f/")[1].split()[0]
    pub = httpx.get(f"{API}/publico/formularios/{t}").json()
    assert pub["pessoal"] and pub["nome_cliente"] == "Pedro Cliente" and not pub["ja_respondido"]
    assert httpx.post(f"{API}/publico/formularios/{t}", json={"respostas": {"p1": 10}}).status_code == 201
    assert httpx.post(f"{API}/publico/formularios/{t}", json={"respostas": {"p1": 0}}).status_code == 409  # uma resposta por link
    res = c.get(f"/formularios/{f['id']}/resultado").json()
    assert res["total"] == 1 and res["respostas"][0]["nome"] == "Pedro Cliente" and res["respostas"][0]["origem"] == "atendimento"
    assert res["profissionais"][0]["nps"] == 100

    # pesquisa dentro de uma campanha: cada pessoa recebe o link dela
    httpx.post(f"{EVO}/_teste/receber/{inst}", json={"numero": tel, "nome": "Pedro", "texto": "Valeu!"})
    camp = c.post("/whatsapp/campanhas", json={"nome": "NPS do mês", "conexao_id": con["id"], "mensagem": "Oi {nome}, responde nossa pesquisa? {link}",
                                               "formulario_id": f["id"], "hora_inicio": "00:00", "hora_fim": "23:59", "domingo": True,
                                               "intervalo_min": 20, "intervalo_max": 20}).json()
    c.post(f"/whatsapp/campanhas/{camp['id']}/iniciar")
    antes = len(httpx.get(f"{EVO}/_teste/enviadas").json())
    assert c.post("/whatsapp/campanhas/processar").json()["enviados"] == 1
    texto = httpx.get(f"{EVO}/_teste/enviadas").json()[antes]["text"]
    assert "/f/" in texto and "{link}" not in texto and texto.split("/f/")[1].split()[0] != t
