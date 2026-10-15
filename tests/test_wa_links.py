"""Texto do passo de link do fluxo do WhatsApp (unitário: roda sem nada no ar)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from lib.wa_links import citado, texto_com_link  # noqa: E402

PROFS = [{"id": "1", "nome": "Diego Souza"}, {"id": "2", "nome": "Rafa Lima"}, {"id": "3", "nome": "Rafa Costa"}]


def test_texto_com_link():
    assert texto_com_link("Agenda do {nome}: {link}", "https://x/a", {"nome": "Diego", "preco": ""}) == "Agenda do Diego: https://x/a"
    # ninguém citado: some o "do {nome}" em vez de ficar "Agenda do :"
    assert texto_com_link("Fechou! Agenda do {nome}: {link}", "https://x/a", {"nome": "", "preco": ""}) == "Fechou! Agenda: https://x/a"
    assert texto_com_link("Marque com o {nome} aqui", "https://x/a", {"nome": "", "preco": ""}) == "Marque aqui\nhttps://x/a"
    # sem link montável, o {link} sai do texto
    assert texto_com_link("Veja: {link}", None, {"nome": "", "preco": ""}) == "Veja:"


def test_profissional_citado():
    assert citado("quero cortar com o diego amanhã", PROFS)["id"] == "1"
    assert citado("Pode ser com o Rafa Costa?", PROFS)["id"] == "3"
    assert citado("pode ser com o rafa", PROFS) is None  # primeiro nome repetido na equipe não decide sozinho
    assert citado("diegoo", PROFS) is None
