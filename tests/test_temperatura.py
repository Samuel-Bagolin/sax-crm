"""Temperatura do lead e do negócio: escolhida na tela ou pela origem; quente em cima, frio no fim."""

from test_segmentos import _cadastrar, cartao_demo, sysadmin  # noqa: F401


def test_temperatura_pela_origem_ordem_e_filtros(cartao_demo):  # noqa: F811
    c, _ = _cadastrar("veiculos", cartao_demo)
    r = c.put("/crm/config", json={"regras_temperatura": [{"origem": "google maps", "temperatura": "frio"},
                                                         {"origem": "Indicação", "temperatura": "quente"},
                                                         {"origem": "Google Maps", "temperatura": "morno"}]})
    assert r.status_code == 200, r.text
    assert len(r.json()["regras_temperatura"]) == 2 and r.json()["ordenar_por_temperatura"] is True  # repetida não entra
    assert c.put("/crm/config", json={"regras_temperatura": [{"origem": "x", "temperatura": "gelado"}]}).status_code == 422

    frio = c.post("/leads", json={"nome": "Frio do Maps", "origem": "Prospecção Google Maps"}).json()
    assert frio["temperatura"] == "frio"
    sem = c.post("/leads", json={"nome": "Sem regra", "origem": "Outdoor"}).json()
    assert sem["temperatura"] is None
    quente = c.post("/leads", json={"nome": "Escolhido quente", "origem": "Prospecção Google Maps", "temperatura": "quente"}).json()
    assert quente["temperatura"] == "quente"  # escolha da tela vale mais que a regra
    morno = c.post("/leads", json={"nome": "Morno", "origem": "Outdoor", "temperatura": "morno"}).json()

    ordem = [n["nome"] for n in c.get("/leads/kanban").json() if n["id"] in {frio["id"], sem["id"], quente["id"], morno["id"]}]
    assert ordem == ["Escolhido quente", "Morno", "Frio do Maps", "Sem regra"]

    # mudar e tirar a temperatura; fica no histórico
    assert c.patch(f"/leads/{sem['id']}", json={"temperatura": "quente"}).json()["temperatura"] == "quente"
    assert c.patch(f"/leads/{sem['id']}", json={"sem_temperatura": True}).json()["temperatura"] is None
    assert any("Temperatura" in h["texto"] for h in c.get(f"/leads/{sem['id']}/historico").json())
    assert c.patch(f"/leads/{sem['id']}", json={"temperatura": "fervendo"}).status_code == 422

    # em massa
    r = c.post("/leads/massa", json={"ids": [frio["id"], morno["id"]], "acao": "temperatura", "temperatura": "quente"}).json()
    assert r["ok"] == 2

    # desligar a ordem volta para o mais novo primeiro
    c.put("/crm/config", json={"ordenar_por_temperatura": False})
    ordem = [n["nome"] for n in c.get("/leads/kanban").json() if n["id"] in {frio["id"], sem["id"], quente["id"], morno["id"]}]
    assert ordem[0] == "Morno"

    # lead da caixa de entrada também ganha pela origem e passa para o negócio
    e = c.post("/entradas", json={"nome": "Lead do Maps", "telefone": "41999990000", "origem": "Google Maps"}).json()
    assert e["temperatura"] == "frio"
    assert c.patch(f"/entradas/{e['id']}", json={"temperatura": "morno"}).json()["temperatura"] == "morno"
    neg = c.post(f"/entradas/{e['id']}/converter", json={}).json()
    assert neg["temperatura"] == "morno"
