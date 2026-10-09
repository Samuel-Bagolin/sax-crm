"""Camada Firestore com interface do Motor, testada contra um Firestore REST simulado (sem rede)."""
import asyncio
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pymongo import ReturnDocument  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402

import fake_firestore  # noqa: E402
from lib import firestore_mongo as fm  # noqa: E402


@pytest.fixture()
def cliente():
    fake_firestore.DOCS.clear()
    c = fm.FirestoreMongoClient(None, "sax-crm", "emulador.local")
    c.conexao._http = httpx.AsyncClient(transport=httpx.ASGITransport(app=fake_firestore.app))
    return c


def rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_valores_ida_e_volta():
    agora = datetime(2026, 10, 8, 12, 30, 15, 123456, tzinfo=timezone.utc)
    doc = {"a": 1, "b": 1.5, "c": True, "d": None, "e": "x", "f": agora, "g": b"\x00\x01", "h": {"i": [1, {"j": "k"}]}}
    volta = {k: fm._decodificar(fm._codificar(v)) for k, v in doc.items()}
    assert volta == doc
    assert fm._decodificar({"timestampValue": "2026-10-08T12:30:15.123456789Z"}) == agora


def test_id_do_documento():
    assert fm.doc_id({"_id": "dm:a:b"}) == "dm:a:b"
    assert fm.doc_id({"id": "x/y"}) == "x%2Fy"
    assert fm.doc_id({"_id": "__x__"}).startswith("h_")


def test_crud_consultas_e_operadores(cliente):
    async def caso():
        col = cliente["banco1"]["leads"]
        await col.insert_one({"id": "1", "nome": "A", "status": "aberto", "valor": 10, "etiquetas": ["Quente"], "em": datetime.now(timezone.utc)})
        await col.insert_many([{"id": "2", "nome": "B", "status": "ganho", "valor": 30, "etiquetas": []},
                               {"id": "3", "nome": "C", "status": "aberto", "valor": 20, "etiquetas": ["Quente", "VIP"]}])
        assert (await col.find_one({"id": "2"}))["nome"] == "B"
        abertos = await col.find({"status": "aberto"}).sort("valor", -1).to_list(None)
        assert [d["id"] for d in abertos] == ["3", "1"]
        assert await col.count_documents({"status": "aberto"}) == 2
        assert await col.count_documents({"etiquetas": "Quente"}) == 2  # igualdade em lista = "contém"
        assert [d["id"] async for d in col.find({"$or": [{"valor": {"$gt": 25}}, {"nome": {"$regex": "^A"}}]}).sort("id", 1)] == ["1", "2"]
        r = await col.update_one({"id": "1"}, {"$set": {"status": "perdido"}, "$inc": {"valor": 5}, "$addToSet": {"etiquetas": "X"}})
        assert r.matched_count == 1
        d = await col.find_one({"id": "1"}, {"_id": 0, "valor": 1, "etiquetas": 1})
        assert d == {"valor": 15, "etiquetas": ["Quente", "X"]}
        depois = await col.find_one_and_update({"id": "9"}, {"$setOnInsert": {"nome": "Novo"}, "$inc": {"n": 1}}, upsert=True,
                                               return_document=ReturnDocument.AFTER)
        assert depois["id"] == "9" and depois["n"] == 1
        assert (await col.find_one({"id": "9"}))["nome"] == "Novo"
        assert (await col.delete_many({"status": "aberto"})).deleted_count == 1
        assert await col.count_documents({}) == 3
    rodar(caso())


def test_posicional_e_elemmatch(cliente):
    async def caso():
        col = cliente["b"]["contratos"]
        await col.insert_one({"id": "c1", "signatarios": [{"id": "s1", "status": "pendente"}, {"id": "s2", "status": "pendente"}]})
        r = await col.update_one({"id": "c1", "signatarios": {"$elemMatch": {"id": "s2", "status": {"$in": ["pendente"]}}}},
                                 {"$set": {"signatarios.$.status": "assinado"}})
        assert r.matched_count == 1
        doc = await col.find_one({"id": "c1"})
        assert [s["status"] for s in doc["signatarios"]] == ["pendente", "assinado"]
        await col.update_one({"id": "c1"}, {"$pull": {"signatarios": {"id": "s1"}}})
        assert len((await col.find_one({"id": "c1"}))["signatarios"]) == 1
    rodar(caso())


def test_unicidade_e_id_duplicado(cliente):
    async def caso():
        col = cliente["b"]["usuarios"]
        fm.registrar_indice("usuarios", {"key": {"email": 1}, "unique": True, "name": "email"})
        await col.insert_one({"id": "u1", "email": "a@x.com"})
        with pytest.raises(DuplicateKeyError):
            await col.insert_one({"id": "u2", "email": "a@x.com"})
        with pytest.raises(DuplicateKeyError):
            await col.insert_one({"id": "u1", "email": "b@x.com"})
        await col.update_one({"id": "u1"}, {"$set": {"email": "c@x.com"}})
        await col.insert_one({"id": "u3", "email": "a@x.com"})  # e-mail antigo foi liberado
        await col.delete_one({"id": "u3"})
        await col.insert_one({"id": "u4", "email": "a@x.com"})
        exec_ = cliente["b"]["automacoes_execucoes"]
        await exec_.insert_one({"_id": "regra:1"})
        with pytest.raises(DuplicateKeyError):
            await exec_.insert_one({"_id": "regra:1"})
    rodar(caso())


def test_unico_parcial(cliente):
    async def caso():
        fm.registrar_indice("contratos2", {"key": {"lead_id": 1}, "unique": True, "name": "ativo",
                                           "partialFilterExpression": {"lead_id": {"$type": "string"}, "status": "ativo"}})
        col = cliente["b"]["contratos2"]
        await col.insert_one({"id": "a", "lead_id": "L", "status": "ativo"})
        await col.insert_one({"id": "b", "lead_id": "L", "status": "cancelado"})
        with pytest.raises(DuplicateKeyError):
            await col.insert_one({"id": "c", "lead_id": "L", "status": "ativo"})
    rodar(caso())


def test_campos_grandes_em_pedacos(cliente):
    async def caso():
        col = cliente["b"]["fotos_imovel"]
        dados = os.urandom(2_100_000)
        await col.insert_one({"id": "f1", "imovel_id": "i", "dados": dados, "ordem": 0})
        assert (await col.find_one({"id": "f1"}))["dados"] == dados
        leve = await col.find({"imovel_id": "i"}, {"dados": 0}).to_list(None)
        assert "dados" not in leve[0]
        maiores = [n for n in fake_firestore.DOCS if "/_blobs/" in n]
        assert len(maiores) == 3
        await col.delete_one({"id": "f1"})
        assert not [n for n in fake_firestore.DOCS if "/_blobs/" in n]
    rodar(caso())


def test_datas_como_no_motor(cliente):
    async def caso():
        col = cliente["b"]["x"]
        agora = datetime.now(timezone.utc)
        await col.insert_one({"id": "1", "em": agora - timedelta(minutes=5)})
        doc = await col.find_one({"em": {"$lt": agora}})
        assert doc and doc["em"].tzinfo is None  # Motor devolve UTC sem fuso
    rodar(caso())


def test_credencial_e_token_cacheado(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    cred = {"project_id": "sax-crm", "client_email": "svc@sax-crm.iam.gserviceaccount.com", "private_key": chave}
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT", base64.b64encode(json.dumps(cred).encode()).decode())
    c = fm.cliente_do_ambiente()
    assert c.conexao.projeto == "sax-crm"
    chamadas = []

    def responder(req: httpx.Request):
        chamadas.append(str(req.url))
        return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})

    c.conexao._http = httpx.AsyncClient(transport=httpx.MockTransport(responder))
    cab = asyncio.run(c.conexao._cabecalhos())
    assert cab == {"Authorization": "Bearer tok"}
    assert asyncio.run(c.conexao._cabecalhos()) == cab and len(chamadas) == 1
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT", json.dumps({**cred, "private_key": chave.replace("\n", "\\n")}))
    assert "BEGIN PRIVATE KEY" in fm.cliente_do_ambiente().conexao.credencial["private_key"].split("\n")[0]


def test_trancar_regras_monta_chamadas(monkeypatch):
    """Sem rede: confere as chamadas às APIs de regras do Firebase e a marca no banco."""
    import asyncio

    import httpx

    from lib import autoconfig

    chamadas = []

    def responder(req: httpx.Request):
        chamadas.append((req.method, str(req.url), req.content.decode()))
        if req.url.path.endswith("/rulesets"):
            return httpx.Response(200, json={"name": "projects/sax-crm/rulesets/abc"})
        return httpx.Response(200, json={})

    original = httpx.AsyncClient
    monkeypatch.setattr(autoconfig.httpx, "AsyncClient", lambda **k: original(transport=httpx.MockTransport(responder)))

    class Conexao:
        emulador = None
        credencial = {"client_email": "x"}
        projeto = "sax-crm"

        async def token(self, escopo):
            assert "firebase.database" in escopo
            return "tok"

    class Cliente:
        conexao = Conexao()

    marcas = {}

    class Col:
        async def find_one(self, f):
            return marcas.get(f["_id"])

        async def update_one(self, f, u, upsert=False):
            marcas[f["_id"]] = u["$set"]

    class Controle:
        def __getitem__(self, nome):
            return Col()

    import lib.db
    monkeypatch.setattr(lib.db, "controle", Controle())
    asyncio.run(autoconfig.trancar_regras(Cliente()))
    assert autoconfig.ESTADO["regras"] == "trancadas"
    urls = [c[1] for c in chamadas]
    assert urls[0].endswith("/v1/projects/sax-crm/rulesets") and "if false" in chamadas[0][2]
    assert urls[1].endswith("/v1/projects/sax-crm/releases/cloud.firestore") and chamadas[1][0] == "PATCH"
    assert urls[2] == "https://sax-crm-default-rtdb.firebaseio.com/.settings/rules.json" and '".read": false' in chamadas[2][2]
    assert marcas["regras"] == {"versao": 1}
    chamadas.clear()
    asyncio.run(autoconfig.trancar_regras(Cliente()))  # segunda vez: não chama nada
    assert chamadas == []
