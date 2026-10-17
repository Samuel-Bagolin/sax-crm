"""Sessão em grupo, presença por paciente, evolução em até 24 h e controle de atendimento."""

from datetime import date, timedelta

from test_segmentos import _cadastrar, cartao_demo, sysadmin  # noqa: F401  (fixtures)


def _preparar(c):
    me = c.get("/auth/me").json()
    c.put(f"/atendimentos/profissionais/{me['usuario_id']}", json={"atende": True, "jornada": {str(d): [["00:00", "23:55"]] for d in range(7)}, "comissao_pct": 0})
    s = c.post("/atendimentos/servicos", json={"nome": "Grupo de habilidades sociais", "duracao_min": 60, "preco": 90, "capacidade": 3}).json()
    assert s["capacidade"] == 3
    ind = c.post("/atendimentos/servicos", json={"nome": "Sessão individual", "duracao_min": 50, "preco": 150}).json()
    return me, s, ind


def _agendar(c, me, servico, dia, inicio, nome, tel):
    r = c.post("/atendimentos", json={"profissional_id": me["usuario_id"], "servico_ids": [servico["id"]], "data": dia, "inicio": inicio,
                                      "cliente_nome": nome, "cliente_telefone": tel, "encaixe": True})
    assert r.status_code == 201, r.text
    return r.json()["criados"][0]


def test_grupo_presenca_evolucao_e_controle(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("terapia", cartao_demo)
    me, grupo, ind = _preparar(c)
    hoje = date.today().isoformat()
    a = _agendar(c, me, grupo, hoje, "00:00", "Alice Grupo", "41990000001")
    s = c.post(f"/sessoes/{a['id']}/participantes", json={"cliente_nome": "Bruno Grupo", "cliente_telefone": "41990000002"}).json()
    s = c.post(f"/sessoes/{a['id']}/participantes", json={"cliente_nome": "Carla Grupo", "cliente_telefone": "41990000003"}).json()
    assert len(s["participantes"]) == 3 and s["capacidade"] == 3
    assert c.post(f"/sessoes/{a['id']}/participantes", json={"cliente_nome": "Davi Sobra", "cliente_telefone": "41990000004"}).status_code == 409
    ids = {p["cliente_nome"]: p["cliente_id"] for p in s["participantes"]}
    assert c.post(f"/sessoes/{a['id']}/participantes", json={"cliente_id": ids["Bruno Grupo"]}).status_code == 409  # cheia/duplicado

    # sessão individual não aceita segundo paciente
    b = _agendar(c, me, ind, hoje, "02:00", "Igor Individual", "41990000005")
    assert c.post(f"/sessoes/{b['id']}/participantes", json={"cliente_nome": "Outro", "cliente_telefone": "41990000006"}).status_code == 409

    # presença
    assert c.post(f"/sessoes/{a['id']}/presenca", json={"cliente_id": ids["Alice Grupo"], "presenca": "presente"}).json()["status"] == "em_atendimento"
    c.post(f"/sessoes/{a['id']}/presenca", json={"cliente_id": ids["Bruno Grupo"], "presenca": "falta_justificada", "justificativa": "Atestado"})
    c.post(f"/sessoes/{a['id']}/presenca", json={"cliente_id": ids["Carla Grupo"], "presenca": "presente"})

    # evolução ligada à sessão: no prazo, uma por paciente e sessão
    ev = c.post(f"/pacientes/{ids['Alice Grupo']}/prontuario", json={"texto": "Participou bem da dinâmica.", "agendamento_id": a["id"]})
    assert ev.status_code == 201 and ev.json()["no_prazo"] is True
    assert c.post(f"/pacientes/{ids['Alice Grupo']}/prontuario", json={"texto": "De novo", "agendamento_id": a["id"]}).status_code == 409
    assert c.post(f"/pacientes/{ids['Alice Grupo']}/prontuario", json={"texto": "Errado", "agendamento_id": b["id"]}).status_code == 422
    # com evolução, não marca falta
    assert c.post(f"/sessoes/{a['id']}/presenca", json={"cliente_id": ids["Alice Grupo"], "presenca": "falta"}).status_code == 409

    ctl = c.get("/sessoes/controle/lista", params={"inicio": hoje, "fim": hoje}).json()
    por = {l["paciente_nome"]: l for l in ctl["linhas"]}
    assert por["Alice Grupo"]["evolucao"] == "feita" and por["Bruno Grupo"]["evolucao"] is None and por["Carla Grupo"]["evolucao"] == "pendente"
    assert por["Bruno Grupo"]["presenca"] == "falta_justificada" and por["Igor Individual"]["presenca"] is None
    assert ctl["resumo"]["feita"] == 1 and ctl["resumo"]["pendente"] == 1 and ctl["resumo"]["sessoes"] == 2

    # sessão de 3 dias atrás sem evolução: atrasada; evolução agora entra fora do prazo
    velho = (date.today() - timedelta(days=3)).isoformat()
    v = _agendar(c, me, ind, velho, "09:00", "Vera Antiga", "41990000007")
    c.post(f"/sessoes/{v['id']}/presenca", json={"cliente_id": v["cliente_id"], "presenca": "presente"})
    pend = c.get("/sessoes/controle/pendentes").json()
    assert pend["atrasadas"] == 1 and pend["pendentes"] == 1
    e2 = c.post(f"/pacientes/{v['cliente_id']}/prontuario", json={"texto": "Registro tardio.", "agendamento_id": v["id"]}).json()
    assert e2["no_prazo"] is False
    ctl = c.get("/sessoes/controle/lista", params={"inicio": velho, "fim": hoje}).json()
    assert next(l for l in ctl["linhas"] if l["paciente_nome"] == "Vera Antiga")["evolucao"] == "feita_fora_do_prazo"

    # ficha do paciente mostra a sessão em grupo com a presença dele
    f = c.get(f"/pacientes/{ids['Bruno Grupo']}").json()
    assert f["agendamentos"][0]["grupo"] and f["agendamentos"][0]["presenca"] == "falta_justificada"
    # presença em sessão futura não
    fut = _agendar(c, me, ind, (date.today() + timedelta(days=2)).isoformat(), "09:00", "Futuro", "41990000008")
    assert c.post(f"/sessoes/{fut['id']}/presenca", json={"cliente_id": fut["cliente_id"], "presenca": "presente"}).status_code == 409


def test_folha_por_profissional(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("terapia", cartao_demo)
    me, grupo, ind = _preparar(c)
    hoje = date.today().isoformat()
    mes = hoje[:7]
    assert c.put(f"/folha/regras/{me['usuario_id']}", json={"modelo": "percentual"}).status_code == 422
    r = c.put(f"/folha/regras/{me['usuario_id']}", json={"modelo": "fixo_mais_sessao", "valor_sessao": 60, "fixo_mensal": 1000, "grupo_conta": "por_paciente"})
    assert r.status_code == 200 and r.json()["modelo"] == "fixo_mais_sessao"
    g = _agendar(c, me, grupo, hoje, "00:00", "Ana G", "41990000201")
    s = c.post(f"/sessoes/{g['id']}/participantes", json={"cliente_nome": "Beto G", "cliente_telefone": "41990000202"}).json()
    s = c.post(f"/sessoes/{g['id']}/participantes", json={"cliente_nome": "Caio G", "cliente_telefone": "41990000203"}).json()
    ids = {p["cliente_nome"]: p["cliente_id"] for p in s["participantes"]}
    for n in ("Ana G", "Beto G", "Caio G"):
        c.post(f"/sessoes/{g['id']}/presenca", json={"cliente_id": ids[n], "presenca": "presente"})
    for n in ("Ana G", "Beto G"):  # Caio sem evolução: não entra
        c.post(f"/pacientes/{ids[n]}/prontuario", json={"texto": "ok", "agendamento_id": g["id"]})
    i = _agendar(c, me, ind, hoje, "02:00", "Ivo I", "41990000204")
    c.post(f"/sessoes/{i['id']}/presenca", json={"cliente_id": i["cliente_id"], "presenca": "presente"})
    c.post(f"/pacientes/{i['cliente_id']}/prontuario", json={"texto": "ok", "agendamento_id": i["id"]})
    f = c.get("/folha", params={"mes": mes}).json()
    eu = next(p for p in f["profissionais"] if p["usuario_id"] == me["usuario_id"])
    assert eu["sessoes"] == 2 and eu["atendimentos"] == 3 and eu["aguardando_evolucao"] == 1
    assert eu["variavel"] == 180 and eu["fixo"] == 1000 and eu["total"] == 1180 and eu["fechada"] is None

    # concluir não lança comissão para quem tem folha
    c.put(f"/atendimentos/profissionais/{me['usuario_id']}", json={"atende": True, "jornada": {str(d): [["00:00", "23:55"]] for d in range(7)}, "comissao_pct": 30})
    assert c.post(f"/atendimentos/{i['id']}/concluir", json={"valor": 150, "forma_pagamento": "pix"}).status_code == 200
    assert not [t for t in c.get("/transacoes").json() if t.get("agendamento_id") == i["id"] and t["tipo"] == "pagar"]

    # fechar: conta a pagar com id fixo, não duplica, reabre se não pago
    r = c.post(f"/folha/{mes}/fechar", json={"usuario_ids": [me["usuario_id"]]}).json()
    assert r["fechadas"][0]["total"] == 1180
    assert c.post(f"/folha/{mes}/fechar", json={"usuario_ids": [me["usuario_id"]]}).json()["puladas"][0]["motivo"] == "Já fechada"
    tx = [t for t in c.get("/transacoes").json() if t["descricao"].startswith(f"Folha {mes[5:]}/{mes[:4]}")]
    assert len(tx) == 1 and tx[0]["valor"] == 1180 and tx[0]["tipo"] == "pagar"
    # fechada fica congelada: evolução nova não muda o valor
    c.post(f"/pacientes/{ids['Caio G']}/prontuario", json={"texto": "tarde", "agendamento_id": g["id"]})
    assert next(p for p in c.get("/folha", params={"mes": mes}).json()["profissionais"] if p["usuario_id"] == me["usuario_id"])["total"] == 1180
    assert c.post(f"/folha/{mes}/reabrir/{me['usuario_id']}").status_code == 200
    assert not [t for t in c.get("/transacoes").json() if t["descricao"].startswith(f"Folha {mes[5:]}/{mes[:4]}")]
    eu = next(p for p in c.get("/folha", params={"mes": mes}).json()["profissionais"] if p["usuario_id"] == me["usuario_id"])
    assert eu["variavel"] == 240  # agora Caio também tem evolução

    # percentual sobre o valor da sessão (cobrado, se concluída)
    c.put(f"/folha/regras/{me['usuario_id']}", json={"modelo": "percentual", "percentual": 40, "grupo_conta": "por_sessao"})
    eu = next(p for p in c.get("/folha", params={"mes": mes}).json()["profissionais"] if p["usuario_id"] == me["usuario_id"])
    assert eu["total"] == 96  # grupo: 40% de 90 = 36 (uma vez); individual concluído: 40% de 150 = 60
