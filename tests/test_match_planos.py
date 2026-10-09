"""Regras puras do match cliente ↔ imóvel e do catálogo de planos (sem banco)."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "teste_unitario")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from lib.match import perfil_do_imovel, perfil_vazio, pontuar  # noqa: E402
from lib.planos import LEGADO, PLANOS, plano_de  # noqa: E402

CASA = {"tipo": "casa", "finalidade": "venda", "status": "publicado", "bairro": "Água Verde", "cidade": "Curitiba",
        "quartos": 3, "vagas": 2, "area_util": 120, "valor_venda": 650000}


def test_match_perfeito_e_acentos():
    perfil = {"finalidade": "venda", "tipos": ["casa"], "cidades": ["curitiba"], "bairros": ["agua verde"], "valor_max": 700000, "quartos_min": 3}
    nota = pontuar(perfil, CASA)
    assert nota["score"] == 100 and "Bairro Água Verde" in nota["motivos"]


def test_match_elimina_finalidade_vendido_e_muito_caro():
    assert pontuar({"finalidade": "locacao"}, CASA) is None
    assert pontuar({"finalidade": "venda"}, {**CASA, "status": "vendido"}) is None
    assert pontuar({"finalidade": "venda", "valor_max": 500000}, CASA) is None  # 30% acima do teto


def test_match_tolerancia_de_valor_reduz_nota():
    nota = pontuar({"finalidade": "venda", "valor_max": 600000}, CASA)  # 8% acima: entra com alerta
    assert nota and nota["score"] < 100 and any("acima do orçamento" in a for a in nota["alertas"])


def test_match_perfil_incompleto_nao_pune():
    assert pontuar({"finalidade": "venda"}, CASA)["score"] == 100
    assert perfil_vazio({"finalidade": "venda"}) and not perfil_vazio({"bairros": ["X"]})


def test_sugestao_de_perfil_a_partir_do_imovel():
    p = perfil_do_imovel(CASA)
    assert p["valor_max"] == 715000 and p["tipos"] == ["casa"] and p["bairros"] == ["Água Verde"]


def test_planos_legado_e_limites_personalizados():
    assert plano_de({"plano": "essencial"})["nome"] == LEGADO["nome"]  # anterior aos planos: sem limites
    pro = plano_de({"plano": "profissional", "plano_aplicado": True})
    assert pro["usuarios"] == 5 and "match" in pro["recursos"] and "portais" not in pro["recursos"]
    ext = plano_de({"plano": "profissional", "plano_aplicado": True, "limites_personalizados": {"usuarios": 8, "recursos_extras": ["portais"]}})
    assert ext["usuarios"] == 8 and "portais" in ext["recursos"]
    assert PLANOS["essencial"]["preco"] < PLANOS["profissional"]["preco"] < PLANOS["business"]["preco"]
