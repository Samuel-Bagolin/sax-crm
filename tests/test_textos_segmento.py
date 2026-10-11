"""Cada segmento vê só os próprios termos: nada de imóvel, corretor ou portal fora da imobiliária."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from lib.planos import RECURSOS, recursos_do_segmento
from lib.segmentos import SEGMENTOS

IMOB = re.compile(r"im[óo]ve(l|is)|imobili|corretor|propriet[áa]ri|portais|zap|vivareal|loca[çc][ãa]o", re.I)


def test_recursos_de_cada_segmento_sem_termos_de_imobiliaria():
    for seg in SEGMENTOS:
        rotulos = recursos_do_segmento(seg)
        assert rotulos, seg
        assert set(rotulos) <= set(RECURSOS)
        if seg != "imobiliaria":
            ruins = [r for r in rotulos.values() if IMOB.search(r)]
            assert not ruins, (seg, ruins)


def test_clinicas_nao_veem_recursos_de_venda_e_imobiliaria_nao_ve_os_de_clinica():
    assert "odontograma" in recursos_do_segmento("odontologia") and "odontograma" not in recursos_do_segmento("barbearia")
    assert "mapa_facial" in recursos_do_segmento("estetica")
    for seg in ("odontologia", "terapia", "barbearia", "estetica"):
        assert not {"portais", "match", "proprietario"} & set(recursos_do_segmento(seg))
        # Site próprio vale para todos, com o rótulo do segmento (nada de "imóveis" na clínica).
        assert "imóve" not in recursos_do_segmento(seg)["site"]
    assert not {"agenda_online", "prontuario", "odontograma", "mapa_facial"} & set(recursos_do_segmento("imobiliaria"))
    assert recursos_do_segmento("veiculos")["site"] == "Site da loja com o estoque e WhatsApp"


def test_termos_dos_segmentos_de_atendimento():
    for seg in ("odontologia", "terapia", "barbearia", "estetica"):
        termos = " ".join(SEGMENTOS[seg]["termos"].values())
        assert not IMOB.search(termos), seg
