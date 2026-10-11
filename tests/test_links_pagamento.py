"""Links de pagamento dos planos no Asaas: valores (Pix 10% off), idempotência, troca de preço e erro.
Unitário: Asaas simulado e banco de controle em memória (não precisa da API no ar)."""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("JWT_SECRET", "teste-jwt-123456789012345678901234")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

from lib import asaas
from lib import links_pagamento as lp

CATALOGO = {
    "odontologia_business": {"nome": "Business", "segmento": "odontologia", "preco_mensal": 249, "preco_anual": 2390.4, "ativo": True, "ordem": 2},
    "barbearia_starter": {"nome": "Starter", "segmento": "barbearia", "preco_mensal": 79.9, "preco_anual": None, "ativo": True, "ordem": 1},
    "velho": {"nome": "Antigo", "segmento": "barbearia", "preco_mensal": 50, "ativo": False},
}


class AsaasFalso:
    def __init__(self):
        self.links, self.removidos, self.n = {}, [], 0
        self.recusar_pix = False

    async def chamar(self, metodo, caminho, corpo=None):
        if metodo == "POST" and caminho == "/paymentLinks":
            if self.recusar_pix and corpo["billingType"] == "PIX":
                raise asaas.ErroAsaas(402, "Recorrência não disponível para Pix.")
            self.n += 1
            lid = f"lnk_{self.n}"
            self.links[lid] = corpo
            return {"id": lid, "url": f"https://www.asaas.com/c/{lid}"}
        if metodo == "DELETE":
            self.removidos.append(caminho.rsplit("/", 1)[1])
            return {"deleted": True}
        raise AssertionError(caminho)


@pytest.fixture()
def ambiente(monkeypatch):
    banco = AsyncMongoMockClient()["controle_teste"]
    falso = AsaasFalso()
    catalogo = {k: dict(v) for k, v in CATALOGO.items()}
    monkeypatch.setattr(lp, "controle", banco)
    monkeypatch.setattr(asaas, "_chamar", falso.chamar)

    async def cfg():
        return {"chave": "x", "ambiente": "sandbox", "chave_por_env": False}

    async def cat():
        return catalogo

    monkeypatch.setattr(asaas, "config", cfg)
    monkeypatch.setattr(lp, "_catalogo", cat)
    return falso, catalogo


def rodar(c):
    return asyncio.run(c)


def test_valores_pix_com_desconto_e_plano_inativo_fora():
    itens = {i["_id"]: i for i in lp.planejar(CATALOGO)}
    assert len(itens) == 8  # 2 planos ativos x 2 períodos x 2 formas
    assert itens["odontologia_business:mensal:cartao"]["valor"] == 249.0
    assert itens["odontologia_business:mensal:pix"]["valor"] == 224.1
    assert itens["odontologia_business:anual:pix"]["valor"] == 2151.36
    assert itens["barbearia_starter:anual:cartao"]["valor"] == 958.8  # sem preço anual: 12x o mensal
    assert itens["barbearia_starter:mensal:pix"]["valor"] == 71.91
    assert not any(k.startswith("velho") for k in itens)
    corpo = lp._corpo(itens["odontologia_business:mensal:pix"])
    assert corpo["billingType"] == "PIX" and corpo["chargeType"] == "RECURRENT" and corpo["subscriptionCycle"] == "MONTHLY"
    assert "—" not in corpo["description"] and "10%" in corpo["description"]


def test_gera_uma_vez_e_troca_quando_o_preco_muda(ambiente):
    falso, catalogo = ambiente
    r = rodar(lp.sincronizar())
    assert r["prontos"] == 8 and r["pendentes"] == 0 and len(falso.links) == 8
    # Rodar de novo não cria nada (clique duplo ou repetição).
    rodar(lp.sincronizar())
    assert len(falso.links) == 8 and not falso.removidos
    # Preço mudou: só os 4 links do plano são trocados e os antigos saem do Asaas.
    catalogo["barbearia_starter"]["preco_mensal"] = 89.9
    r = rodar(lp.sincronizar())
    assert len(falso.links) == 12 and len(falso.removidos) == 4 and r["prontos"] == 8
    # Plano desativado: links removidos.
    catalogo["barbearia_starter"]["ativo"] = False
    r = rodar(lp.sincronizar())
    assert r["total"] == 4 and len(falso.removidos) == 8


def test_erro_do_asaas_em_um_tipo_nao_trava_os_outros(ambiente):
    falso, _ = ambiente
    falso.recusar_pix = True
    r = rodar(lp.sincronizar())
    assert r["prontos"] == 4 and r["parar"] is True
    assert all(x["erro"] == "Recorrência não disponível para Pix." for x in r["links"] if x["forma"] == "pix")


def test_sem_chave_do_asaas(ambiente, monkeypatch):
    async def sem_chave():
        return {"chave": None, "ambiente": "sandbox", "chave_por_env": False}

    monkeypatch.setattr(asaas, "config", sem_chave)
    with pytest.raises(HTTPException) as e:
        rodar(lp.sincronizar())
    assert e.value.status_code == 503
