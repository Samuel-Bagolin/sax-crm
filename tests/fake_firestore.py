"""Firestore REST simulado (subconjunto usado por lib/firestore_mongo.py) para testes sem rede."""
import itertools
import sys
from urllib.parse import unquote

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "backend"))
from lib.firestore_mongo import _decodificar  # noqa: E402

app = FastAPI()
DOCS: dict[str, dict] = {}  # nome -> {"fields": ..., "v": int}
TX: dict[str, dict] = {}  # id -> {nome: versão lida}
_seq = itertools.count(1)
STATS = {"get": 0, "query": 0, "commit": 0, "batch": 0, "count": 0}


def _erro(status, codigo, msg):
    return JSONResponse({"error": {"code": status, "status": codigo, "message": msg}}, status_code=status)


def _doc(nome):
    d = DOCS[nome]
    return {"name": nome, "fields": d["fields"], "updateTime": "2026-01-01T00:00:00Z", "createTime": "2026-01-01T00:00:00Z"}


def _ler(tx, nome):
    if tx:
        TX.setdefault(tx, {})[nome] = DOCS.get(nome, {}).get("v", 0)


def _casa(campos, filtro):
    if not filtro:
        return True
    if "compositeFilter" in filtro:
        return all(_casa(campos, f) for f in filtro["compositeFilter"]["filters"])
    f = filtro["fieldFilter"]
    campo = f["field"]["fieldPath"]
    if campo not in campos:
        return False
    v = _decodificar(campos[campo])
    alvo = _decodificar(f["value"])
    if f["op"] == "EQUAL":
        return v == alvo and not isinstance(v, list)
    if f["op"] == "IN":
        return v in alvo
    raise ValueError(f["op"])


def _consultar(parent, sq, tx=None):
    col = sq["from"][0]["collectionId"]
    prefixo = parent + "/" + col + "/"
    saida = []
    for nome in sorted(DOCS):
        if nome.startswith(prefixo) and "/" not in nome[len(prefixo):] and _casa(DOCS[nome]["fields"], sq.get("where")):
            saida.append(nome)
            _ler(tx, nome)
    if sq.get("limit"):
        saida = saida[: sq["limit"]]
    return saida


@app.get("/v1/{nome:path}")
async def get(nome: str):
    STATS["get"] += 1
    nome = unquote(nome)
    if nome not in DOCS:
        return _erro(404, "NOT_FOUND", "no entity")
    return _doc(nome)


@app.post("/v1/{caminho:path}")
async def post(caminho: str, request: Request):
    corpo = await request.json() if await request.body() else {}
    caminho = unquote(caminho)
    base, _, acao = caminho.rpartition(":")
    tx = corpo.get("transaction")
    if acao == "runQuery":
        STATS["query"] += 1
        nomes = _consultar(base, corpo["structuredQuery"], tx)
        return [{"document": _doc(n), "readTime": "x"} for n in nomes] or [{"readTime": "x"}]
    if acao == "runAggregationQuery":
        STATS["count"] += 1
        sq = corpo["structuredAggregationQuery"]["structuredQuery"]
        return [{"result": {"aggregateFields": {"n": {"integerValue": str(len(_consultar(base, sq)))}}}, "readTime": "x"}]
    if acao == "batchGet":
        STATS["batch"] += 1
        saida = []
        for n in corpo["documents"]:
            _ler(tx, n)
            saida.append({"found": _doc(n)} if n in DOCS else {"missing": n})
        return saida
    if acao == "beginTransaction":
        tid = f"t{next(_seq)}"
        TX[tid] = {}
        return {"transaction": tid}
    if acao == "rollback":
        TX.pop(tx, None)
        return {}
    if acao == "commit":
        STATS["commit"] += 1
        if tx:
            lidos = TX.pop(tx, None)
            if lidos is None:
                return _erro(400, "INVALID_ARGUMENT", "transaction expired")
            for n, v in lidos.items():
                if DOCS.get(n, {}).get("v", 0) != v:
                    return _erro(409, "ABORTED", "Transaction lock timeout / contention")
        for w in corpo.get("writes", []):  # validação antes de aplicar (atômico)
            if "update" in w and w.get("currentDocument", {}).get("exists") is False and w["update"]["name"] in DOCS:
                return _erro(409, "ALREADY_EXISTS", "Document already exists: " + w["update"]["name"])
        for w in corpo.get("writes", []):
            if "update" in w:
                n = w["update"]["name"]
                DOCS[n] = {"fields": w["update"].get("fields", {}), "v": DOCS.get(n, {}).get("v", 0) + 1}
            elif "delete" in w:
                DOCS.pop(w["delete"], None)
        return {"commitTime": "x", "writeResults": []}
    if acao == "listCollectionIds":
        prefixo = base + "/"
        cols = sorted({n[len(prefixo):].split("/")[0] for n in DOCS if n.startswith(prefixo)})
        return {"collectionIds": cols}
    return _erro(400, "INVALID_ARGUMENT", "ação desconhecida: " + acao)


@app.get("/__stats")
async def stats():
    return {**STATS, "docs": len(DOCS)}
