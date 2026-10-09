"""Firestore com a interface do Motor (MongoDB assíncrono).

O SAX CRM foi escrito com consultas no estilo MongoDB. Esta camada permite usar o Firestore
(Firebase) como banco sem reescrever as regras de negócio:

- Cada "banco" (controle e um por imobiliária) vira o documento `bancos/{nome}`, e cada coleção,
  uma subcoleção dele: `bancos/{nome}/{coleção}/{id}`.
- O id do documento é o `_id` informado ou o campo `id` do registro. Buscas por `id` viram uma
  leitura direta (barata e rápida).
- Filtros de igualdade simples são enviados ao Firestore; o restante do filtro (`$or`, `$regex`,
  intervalos, ordenação, projeção) e todos os operadores de atualização (`$set`, `$inc`, `$push`,
  posicional `campo.$.x`, upsert...) são aplicados em Python com o mongomock — a mesma semântica
  do MongoDB, sem traduzir operador por operador.
- Atualizações rodam em transação do Firestore (leitura + escrita atômicas).
- Índices únicos são garantidos por documentos de reserva criados na mesma transação.
- Campos grandes (fotos, PDFs, logo) acima de ~400 KB são guardados em pedaços, porque o Firestore
  limita cada documento a 1 MiB.

Acesso via API REST (sem gRPC): leve para funções serverless.
Credencial: `FIREBASE_SERVICE_ACCOUNT` (JSON ou JSON em base64). Emulador: `FIRESTORE_EMULATOR_HOST`.
"""

from __future__ import annotations

import asyncio
import base64
import contextvars
import copy
import hashlib
import json
import logging
import os
import time
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Iterable
from urllib.parse import quote, unquote

import httpx
import mongomock
from mongomock import filtering
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

logger = logging.getLogger(__name__)

LIMITE_CAMPO = 400_000  # acima disso o campo vai para pedaços
TAMANHO_PEDACO = 800_000
# Campos que são listas: igualdade no Mongo significa "contém", então não vão para o Firestore.
CAMPOS_LISTA = {"papeis", "membros", "imovel_ids", "etiquetas", "etapas_alcancadas", "reacoes", "signatarios", "etapas",
                "modulos", "modulos_ativos", "formas_pagamento", "compartilhado_com", "tipos", "cidades", "bairros",
                "automacoes", "origens", "motivos_perda", "itens", "eventos", "parcelas"}

# Cache por requisição (definido pelo middleware): nome do documento -> dados.
cache_requisicao: contextvars.ContextVar[dict | None] = contextvars.ContextVar("cache_firestore", default=None)

# Índices únicos registrados por nome de coleção (vale para qualquer banco).
_UNICOS: dict[str, list[dict]] = {}

_motor_mock = mongomock.MongoClient()


# ====================================================================== conversão de valores


def _codificar(v: Any) -> dict:
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, Decimal):
        return {"doubleValue": float(v)}
    if isinstance(v, Enum):
        return _codificar(v.value)
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, datetime):
        dt = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return {"timestampValue": dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")}
    if isinstance(v, date):
        return {"stringValue": v.isoformat()}
    if isinstance(v, (bytes, bytearray, memoryview)):
        return {"bytesValue": base64.b64encode(bytes(v)).decode()}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {str(k): _codificar(x) for k, x in v.items()}}}
    if isinstance(v, (list, tuple, set)):
        return {"arrayValue": {"values": [_codificar(x) for x in v]}}
    if type(v).__name__ == "ObjectId":
        return {"stringValue": str(v)}
    raise TypeError(f"Tipo não suportado no Firestore: {type(v).__name__}")


def _decodificar(v: dict) -> Any:
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "timestampValue" in v:
        s = v["timestampValue"].replace("Z", "+00:00")
        if "." in s:  # nanossegundos -> microssegundos
            corpo, resto = s.split(".", 1)
            n = 0
            while n < len(resto) and resto[n].isdigit():
                n += 1
            frac, fuso = resto[:n], resto[n:]
            s = f"{corpo}.{frac[:6].ljust(6, '0')}{fuso}"
        return datetime.fromisoformat(s)
    if "bytesValue" in v:
        return base64.b64decode(v["bytesValue"])
    if "mapValue" in v:
        return {k: _decodificar(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in v:
        return [_decodificar(x) for x in (v["arrayValue"].get("values") or [])]
    if "referenceValue" in v:
        return v["referenceValue"]
    return None


def _para_naive(v: Any) -> Any:
    """Mesmo comportamento do Motor: datas voltam sem fuso (UTC)."""
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, dict):
        return {k: _para_naive(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_para_naive(x) for x in v]
    return v


def doc_id(doc: dict) -> str:
    bruto = doc.get("_id", doc.get("id"))
    if bruto is None:
        bruto = uuid.uuid4().hex
    s = str(bruto)
    s = s.replace("%", "%25").replace("/", "%2F")
    if s in (".", "..") or s.startswith("__") or len(s.encode()) > 1400:
        s = "h_" + hashlib.sha256(str(bruto).encode()).hexdigest()
    return s


# ====================================================================== HTTP / credenciais


class _Conexao:
    def __init__(self, credencial: dict | None, projeto: str, emulador: str | None, database: str = "(default)"):
        self.credencial = credencial
        self.projeto = projeto
        self.emulador = emulador
        host = f"http://{emulador}" if emulador else "https://firestore.googleapis.com"
        self.raiz = f"projects/{projeto}/databases/{database}/documents"
        self.base = f"{host}/v1/{self.raiz}"
        self._http: httpx.AsyncClient | None = None
        self._token: tuple[str, float] | None = None
        self._trava_token = asyncio.Lock()

    def http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(20, connect=8), limits=httpx.Limits(max_connections=20))
        return self._http

    async def _cabecalhos(self) -> dict:
        if self.emulador:
            return {"Authorization": "Bearer owner"}
        if self._token and self._token[1] > time.time() + 60:
            return {"Authorization": f"Bearer {self._token[0]}"}
        async with self._trava_token:
            if not (self._token and self._token[1] > time.time() + 60):
                import jwt

                agora = int(time.time())
                afirmacao = jwt.encode({
                    "iss": self.credencial["client_email"], "sub": self.credencial["client_email"],
                    "aud": "https://oauth2.googleapis.com/token", "iat": agora, "exp": agora + 3600,
                    "scope": "https://www.googleapis.com/auth/datastore",
                }, self.credencial["private_key"], algorithm="RS256")
                r = await self.http().post("https://oauth2.googleapis.com/token", data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": afirmacao})
                if r.status_code != 200:
                    raise OperationFailure(f"Firebase recusou a credencial: {r.text[:200]}")
                dados = r.json()
                self._token = (dados["access_token"], time.time() + int(dados.get("expires_in", 3600)))
        return {"Authorization": f"Bearer {self._token[0]}"}

    async def chamar(self, metodo: str, url: str, corpo: dict | None = None, ok404: bool = False, commit: bool = False) -> Any:
        for tentativa in range(4):
            r = await self.http().request(metodo, url, json=corpo, headers=await self._cabecalhos())
            if r.status_code == 404 and ok404:
                return None
            if r.status_code in (429, 500, 502, 503) and tentativa < 3:
                await asyncio.sleep(0.2 * 2 ** tentativa)
                continue
            if r.status_code >= 400:
                texto = r.text[:500]
                if r.status_code == 409 and "ABORTED" in texto:
                    raise _Abortada(texto)
                if commit and r.status_code in (400, 409) and ("ALREADY_EXISTS" in texto or "FAILED_PRECONDITION" in texto):
                    raise DuplicateKeyError("E11000 registro duplicado")
                raise OperationFailure(f"Firestore {r.status_code}: {texto}")
            return r.json() if r.content else None
        raise OperationFailure("Firestore indisponível")


class _Abortada(Exception):
    pass


# ====================================================================== unicidade


def registrar_indice(colecao: str, especificacao: dict) -> None:
    if not especificacao.get("unique"):
        return
    campos = [k for k, _ in especificacao["key"].items()] if isinstance(especificacao["key"], dict) else [k for k, _ in especificacao["key"]]
    if campos == ["_id"]:
        return
    lista = _UNICOS.setdefault(colecao, [])
    if any(e["nome"] == especificacao.get("name") for e in lista):
        return
    lista.append({"nome": especificacao.get("name") or "_".join(campos), "campos": campos,
                  "sparse": bool(especificacao.get("sparse")), "parcial": especificacao.get("partialFilterExpression")})


def _valor_caminho(doc: dict, caminho: str):
    atual: Any = doc
    for parte in caminho.split("."):
        if not isinstance(atual, dict) or parte not in atual:
            return None
        atual = atual[parte]
    return atual


def _chaves_unicas(colecao: str, doc: dict | None) -> set[str]:
    if not doc:
        return set()
    chaves = set()
    for ind in _UNICOS.get(colecao, []):
        valores = [_valor_caminho(doc, c) for c in ind["campos"]]
        if ind["sparse"] and all(v is None for v in valores):
            continue
        if ind["parcial"] and not filtering.filter_applies(_para_naive(ind["parcial"]), _para_naive(doc)):
            continue
        bruto = json.dumps([ind["nome"], [str(v) for v in valores]], ensure_ascii=False)
        chaves.add(f"{colecao}.{hashlib.sha256(bruto.encode()).hexdigest()[:40]}")
    return chaves


# ====================================================================== banco / coleção / cursor


class _Resultado:
    def __init__(self, **kw):
        self.__dict__.update(kw)
        self.acknowledged = True


class _Sessao:
    """Compatibilidade com `async with await client.start_session()` (sem transação multi-coleção)."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def start_transaction(self, *a, **k):
        return self

    async def end_session(self):
        return None


class FirestoreMongoClient:
    def __init__(self, credencial: dict | None = None, projeto: str | None = None, emulador: str | None = None):
        projeto = projeto or (credencial or {}).get("project_id") or os.environ.get("FIREBASE_PROJECT_ID")
        if not projeto:
            raise RuntimeError("Projeto do Firebase não identificado (FIREBASE_SERVICE_ACCOUNT ou FIREBASE_PROJECT_ID)")
        self.conexao = _Conexao(credencial, projeto, emulador, os.environ.get("FIRESTORE_DATABASE", "(default)"))
        self._bancos: dict[str, FirestoreDatabase] = {}

    def __getitem__(self, nome: str) -> "FirestoreDatabase":
        if nome not in self._bancos:
            self._bancos[nome] = FirestoreDatabase(self, nome)
        return self._bancos[nome]

    def __getattr__(self, nome: str) -> "FirestoreDatabase":
        if nome.startswith("_"):
            raise AttributeError(nome)
        return self[nome]

    async def start_session(self, *a, **k):
        return _Sessao()

    async def drop_database(self, nome: str, *a, **k):
        await self[nome].apagar_tudo()

    def close(self):
        http = self.conexao._http
        if http is not None and not http.is_closed:
            try:
                asyncio.get_event_loop().create_task(http.aclose())
            except Exception:
                pass


class FirestoreDatabase:
    def __init__(self, cliente: FirestoreMongoClient, nome: str):
        self.client = cliente
        self.name = nome
        self._colecoes: dict[str, FirestoreCollection] = {}

    @property
    def caminho(self) -> str:
        return f"bancos/{self.name}"

    def __getitem__(self, nome: str) -> "FirestoreCollection":
        if nome not in self._colecoes:
            self._colecoes[nome] = FirestoreCollection(self, nome)
        return self._colecoes[nome]

    def __getattr__(self, nome: str) -> "FirestoreCollection":
        if nome.startswith("_"):
            raise AttributeError(nome)
        return self[nome]

    async def command(self, comando, *a, **k):
        nome = comando if isinstance(comando, str) else next(iter(comando))
        if nome == "ping":
            await self.client.conexao.chamar("GET", f"{self.client.conexao.base}/{self.caminho}/_ping/x", ok404=True)
            return {"ok": 1}
        if nome == "hello":
            return {"ok": 1, "setName": "firestore", "isWritablePrimary": True}
        if nome == "dbStats":
            return {"ok": 1, "storageSize": 0, "dataSize": 0}
        return {"ok": 1}

    async def list_collection_names(self, *a, **k) -> list[str]:
        con = self.client.conexao
        nomes, token = [], None
        while True:
            corpo = {"pageSize": 300, **({"pageToken": token} if token else {})}
            r = await con.chamar("POST", f"{con.base}/{self.caminho}:listCollectionIds", corpo) or {}
            nomes += r.get("collectionIds", [])
            token = r.get("nextPageToken")
            if not token:
                return [n for n in nomes if not n.startswith("_")]

    async def apagar_tudo(self):
        con = self.client.conexao
        for nome in await self.list_collection_names() + ["_uniq", "_blobs"]:
            await self[nome].delete_many({})


class FirestoreCursor:
    def __init__(self, colecao: "FirestoreCollection", filtro: dict | None, projecao: Any = None, sort=None, skip=0, limit=0):
        self._col = colecao
        self._filtro = filtro or {}
        self._projecao = projecao
        self._sort = _normalizar_sort(sort)
        self._skip = skip
        self._limit = limit
        self._buffer: list[dict] | None = None

    def sort(self, chave, direcao=None):
        self._sort = _normalizar_sort(chave if direcao is None else [(chave, direcao)])
        return self

    def skip(self, n: int):
        self._skip = n
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    async def to_list(self, length: int | None = None):
        docs = await self._col._buscar(self._filtro, self._projecao, self._sort, self._skip, self._limit)
        return docs if length is None else docs[:length]

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._buffer is None:
            self._buffer = await self.to_list(None)
        if not self._buffer:
            raise StopAsyncIteration
        return self._buffer.pop(0)


def _normalizar_sort(sort) -> list[tuple[str, int]] | None:
    if not sort:
        return None
    if isinstance(sort, str):
        return [(sort, 1)]
    if isinstance(sort, (list, tuple)):
        if len(sort) == 2 and isinstance(sort[0], str) and isinstance(sort[1], int):
            return [(sort[0], sort[1])]
        return [(k, d) for k, d in sort]
    return None


def _aplicar_em_memoria(docs: list[dict], filtro: dict, projecao=None, sort=None, skip=0, limit=0) -> list[dict]:
    tmp = _motor_mock["m"][uuid.uuid4().hex]
    try:
        if docs:
            tmp.insert_many([dict(d) for d in docs])
        cur = tmp.find(filtro or {}, projecao)
        if sort:
            cur = cur.sort(sort)
        if skip:
            cur = cur.skip(skip)
        if limit:
            cur = cur.limit(limit)
        return list(cur)
    finally:
        tmp.drop()


class FirestoreCollection:
    def __init__(self, banco: FirestoreDatabase, nome: str):
        self.database = banco
        self.name = nome

    # ------------------------------------------------------------------ caminhos

    @property
    def _con(self) -> _Conexao:
        return self.database.client.conexao

    @property
    def _pai(self) -> str:
        return f"{self._con.base}/{self.database.caminho}"

    def _nome_doc(self, did: str) -> str:
        # Nome de recurso (corpo JSON): id cru. Só a URL leva codificação.
        return f"{self._con.raiz}/{self.database.caminho}/{self.name}/{did}"

    def _url_doc(self, did: str) -> str:
        return f"{self._con.base}/{self.database.caminho}/{self.name}/{quote(did, safe='')}"

    # ------------------------------------------------------------------ leitura

    def _cache(self) -> dict | None:
        return cache_requisicao.get()

    def _invalidar_cache(self):
        c = self._cache()
        if c is not None:
            prefixo = f"{self._con.raiz}/{self.database.caminho}/{self.name}/"
            for k in [k for k in c if k.startswith(prefixo) or k.startswith("q:" + prefixo)]:
                c.pop(k, None)

    async def _de_documento(self, d: dict, projecao=None) -> dict:
        campos = {k: _decodificar(v) for k, v in (d.get("fields") or {}).items()}
        await self._remontar(campos, projecao)
        campos.setdefault("_id", d["name"].rsplit("/", 1)[1])
        return _para_naive(campos)

    def _pushdown(self, filtro: dict) -> tuple[dict | None, bool]:
        """Monta o filtro do Firestore (só igualdades seguras). Retorna (where, cobre_tudo)."""
        iguais, cobre = [], True
        em = None
        for k, v in filtro.items():
            if k.startswith("$") or "." in k or k in CAMPOS_LISTA:
                cobre = False
                continue
            if isinstance(v, (str, bool, int)) and not isinstance(v, float):
                iguais.append((k, "EQUAL", _codificar(v)))
            elif isinstance(v, dict) and set(v) == {"$in"} and isinstance(v["$in"], (list, tuple)) \
                    and 0 < len(v["$in"]) <= 30 and all(isinstance(x, (str, int)) and not isinstance(x, bool) for x in v["$in"]):
                if em is None:
                    em = (k, "IN", {"arrayValue": {"values": [_codificar(x) for x in v["$in"]]}})
                else:
                    cobre = False
            else:
                cobre = False
        filtros = iguais or ([em] if em else [])
        if iguais and em:
            cobre = False
        if not filtros:
            return None, cobre and not filtro
        partes = [{"fieldFilter": {"field": {"fieldPath": f}, "op": op, "value": val}} for f, op, val in filtros]
        where = partes[0] if len(partes) == 1 else {"compositeFilter": {"op": "AND", "filters": partes}}
        return where, cobre

    def _consulta(self, where: dict | None, limite: int = 0) -> dict:
        q: dict = {"from": [{"collectionId": self.name}]}
        if where:
            q["where"] = where
        if limite:
            q["limit"] = limite
        return q

    async def _candidatos(self, filtro: dict, projecao=None, transacao: str | None = None, limite_direto: int = 0) -> list[dict]:
        """Documentos que podem casar com o filtro (o filtro completo é aplicado depois)."""
        # Caminho rápido: busca por id/_id vira leitura direta do documento.
        for chave in ("_id", "id"):
            v = filtro.get(chave)
            if isinstance(v, str):
                doc = await self._get(doc_id({chave: v}), projecao, transacao)
                if doc is not None and filtering.filter_applies(_para_naive(filtro), doc):
                    return [doc]
                if doc is not None and chave == "_id":
                    return []
                if chave == "_id":
                    return []
                break
        where, cobre = self._pushdown(filtro)
        consulta = self._consulta(where, limite_direto if cobre else 0)
        chave_cache = None
        if transacao is None and self._cache() is not None:
            chave_cache = "q:" + f"{self._con.raiz}/{self.database.caminho}/{self.name}/" + json.dumps(consulta, sort_keys=True) + json.dumps(projecao, default=str)
            if chave_cache in self._cache():
                return copy.deepcopy(self._cache()[chave_cache])
        corpo = {"structuredQuery": consulta}
        if transacao:
            corpo["transaction"] = transacao
        resposta = await self._con.chamar("POST", f"{self._pai}:runQuery", corpo) or []
        docs = [await self._de_documento(r["document"], projecao) for r in resposta if "document" in r]
        if chave_cache:
            self._cache()[chave_cache] = copy.deepcopy(docs)
        return docs

    async def _get(self, did: str, projecao=None, transacao: str | None = None) -> dict | None:
        nome = self._nome_doc(did)
        cache = self._cache()
        if transacao is None and cache is not None and nome in cache:
            d = cache[nome]
            return copy.deepcopy(d)
        if transacao:
            r = await self._con.chamar("POST", f"{self._con.base}:batchGet", {"documents": [nome], "transaction": transacao})
            achado = next((x["found"] for x in r or [] if "found" in x), None)
        else:
            achado = await self._con.chamar("GET", self._url_doc(did), ok404=True)
        doc = await self._de_documento(achado, projecao) if achado else None
        if transacao is None and cache is not None:
            cache[nome] = copy.deepcopy(doc)
        return doc

    async def _buscar(self, filtro, projecao=None, sort=None, skip=0, limit=0) -> list[dict]:
        filtro = filtro or {}
        limite_direto = (skip + limit) if (limit and not sort) else 0
        docs = await self._candidatos(filtro, projecao, limite_direto=limite_direto)
        return _aplicar_em_memoria(docs, filtro, projecao, sort, skip, limit)

    def find(self, filtro=None, projecao=None, *a, sort=None, skip=0, limit=0, session=None, **k):
        return FirestoreCursor(self, filtro, projecao, sort, skip, limit)

    async def find_one(self, filtro=None, projecao=None, *a, sort=None, session=None, **k):
        if filtro is not None and not isinstance(filtro, dict):
            filtro = {"_id": filtro}
        docs = await self._buscar(filtro or {}, projecao, _normalizar_sort(sort), 0, 1)
        return docs[0] if docs else None

    async def count_documents(self, filtro=None, *a, session=None, **k) -> int:
        filtro = filtro or {}
        where, cobre = self._pushdown(filtro)
        if cobre and not any(c in filtro for c in ("id", "_id")):
            corpo = {"structuredAggregationQuery": {"structuredQuery": self._consulta(where), "aggregations": [{"alias": "n", "count": {}}]}}
            r = await self._con.chamar("POST", f"{self._pai}:runAggregationQuery", corpo) or []
            for linha in r:
                campos = (linha.get("result") or {}).get("aggregateFields") or {}
                if "n" in campos:
                    return int(campos["n"].get("integerValue", 0))
            return 0
        return len(await self._buscar(filtro, {"_id": 1}))

    async def estimated_document_count(self, *a, **k) -> int:
        return await self.count_documents({})

    async def distinct(self, campo: str, filtro=None, *a, **k):
        vistos = []
        for d in await self._buscar(filtro or {}):
            v = _valor_caminho(d, campo)
            for x in (v if isinstance(v, list) else [v]):
                if x is not None and x not in vistos:
                    vistos.append(x)
        return vistos

    # ------------------------------------------------------------------ campos grandes

    def _separar_grandes(self, did: str, doc: dict, marcadores_antigos: dict) -> tuple[dict, list[dict]]:
        escritas, saida = [], {}
        for k, v in doc.items():
            dado = None
            if isinstance(v, (bytes, bytearray)) and len(v) > LIMITE_CAMPO:
                dado, tipo = bytes(v), "bytes"
            elif isinstance(v, str) and len(v) > LIMITE_CAMPO:
                dado, tipo = v.encode("utf-8"), "str"
            if dado is None:
                saida[k] = v
                continue
            prefixo = f"{self.name}.{did}.{k}"[:900]
            n = (len(dado) + TAMANHO_PEDACO - 1) // TAMANHO_PEDACO
            for i in range(n):
                escritas.append({"update": {"name": self._nome_blob(f"{prefixo}.{i}"),
                                            "fields": {"d": _codificar(dado[i * TAMANHO_PEDACO:(i + 1) * TAMANHO_PEDACO])}}})
            antigo = marcadores_antigos.get(k)
            if antigo:
                for i in range(n, antigo.get("n", 0)):
                    escritas.append({"delete": self._nome_blob(f"{antigo['p']}.{i}")})
            saida[k] = {"_blob_ref": {"p": prefixo, "n": n, "t": tipo}}
        for k, antigo in marcadores_antigos.items():
            if k not in saida or not (isinstance(saida[k], dict) and "_blob_ref" in saida[k]):
                for i in range(antigo.get("n", 0)):
                    escritas.append({"delete": self._nome_blob(f"{antigo['p']}.{i}")})
        return saida, escritas

    def _nome_blob(self, chave: str) -> str:
        return f"{self._con.raiz}/{self.database.caminho}/_blobs/{doc_id({'_id': chave})}"

    async def _remontar(self, campos: dict, projecao=None):
        refs = [(k, v["_blob_ref"]) for k, v in campos.items() if isinstance(v, dict) and "_blob_ref" in v]
        if not refs:
            return
        for k, ref in refs:
            if projecao and isinstance(projecao, dict):
                incluir = projecao.get(k)
                excluiu = any(val in (0, False) for val in projecao.values())
                if (excluiu and incluir in (0, False)) or (not excluiu and not incluir):
                    campos.pop(k, None)
                    continue
            nomes = [self._nome_blob(f"{ref['p']}.{i}") for i in range(ref["n"])]
            r = await self._con.chamar("POST", f"{self._con.base}:batchGet", {"documents": nomes}) or []
            pedacos = {x["found"]["name"]: _decodificar(x["found"]["fields"]["d"]) for x in r if "found" in x}
            dado = b"".join(pedacos.get(n, b"") for n in nomes)
            campos[k] = dado.decode("utf-8") if ref["t"] == "str" else dado

    @staticmethod
    def _marcadores(doc_bruto: dict | None) -> dict:
        if not doc_bruto:
            return {}
        return {k: v["_blob_ref"] for k, v in doc_bruto.items() if isinstance(v, dict) and "_blob_ref" in v}

    # ------------------------------------------------------------------ escrita

    def _escritas_doc(self, did: str, novo: dict | None, antigo: dict | None, antigo_bruto: dict | None,
                      criar: bool = False) -> list[dict]:
        escritas: list[dict] = []
        nome = self._nome_doc(did)
        if novo is None:
            escritas.append({"delete": nome})
            for ref in self._marcadores(antigo_bruto).values():
                escritas += [{"delete": self._nome_blob(f"{ref['p']}.{i}")} for i in range(ref.get("n", 0))]
        else:
            corpo = dict(novo)
            corpo["_id"] = str(corpo.get("_id", did))
            corpo, blobs = self._separar_grandes(did, corpo, self._marcadores(antigo_bruto))
            escrita = {"update": {"name": nome, "fields": {k: _codificar(v) for k, v in corpo.items()}}}
            if criar:
                escrita["currentDocument"] = {"exists": False}
            escritas.append(escrita)
            escritas += blobs
        # reservas de índices únicos
        velhas, novas = _chaves_unicas(self.name, antigo), _chaves_unicas(self.name, novo)
        for chave in novas - velhas:
            escritas.append({"update": {"name": self._nome_uniq(chave), "fields": {"dono": _codificar(did)}},
                             "currentDocument": {"exists": False}})
        for chave in velhas - novas:
            escritas.append({"delete": self._nome_uniq(chave)})
        return escritas

    def _nome_uniq(self, chave: str) -> str:
        return f"{self._con.raiz}/{self.database.caminho}/_uniq/{doc_id({'_id': chave})}"

    async def _commit(self, escritas: list[dict], transacao: str | None = None):
        if not escritas and not transacao:
            return
        corpo: dict = {"writes": escritas}
        if transacao:
            corpo["transaction"] = transacao
        try:
            await self._con.chamar("POST", f"{self._con.base}:commit", corpo, commit=True)
        finally:
            self._invalidar_cache()

    async def insert_one(self, doc: dict, *a, session=None, **k):
        if "_id" not in doc:
            doc["_id"] = doc.get("id") if isinstance(doc.get("id"), str) else uuid.uuid4().hex
        did = doc_id({"_id": doc["_id"]})
        await self._commit(self._escritas_doc(did, dict(doc), None, None, criar=True))
        return _Resultado(inserted_id=doc["_id"])

    async def insert_many(self, docs: Iterable[dict], *a, session=None, ordered=True, **k):
        ids, escritas = [], []
        for doc in docs:
            if "_id" not in doc:
                doc["_id"] = doc.get("id") if isinstance(doc.get("id"), str) else uuid.uuid4().hex
            did = doc_id({"_id": doc["_id"]})
            escritas += self._escritas_doc(did, dict(doc), None, None, criar=True)
            ids.append(doc["_id"])
            if len(escritas) >= 400:
                await self._commit(escritas)
                escritas = []
        await self._commit(escritas)
        return _Resultado(inserted_ids=ids)

    async def _transacao(self, trabalho):
        """Executa `trabalho(transacao)` com repetição em caso de conflito."""
        for tentativa in range(6):
            r = await self._con.chamar("POST", f"{self._con.base}:beginTransaction", {"options": {"readWrite": {}}})
            tid = r["transaction"]
            try:
                resultado, escritas = await trabalho(tid)
                await self._commit(escritas, tid)
                return resultado
            except _Abortada:
                await asyncio.sleep(0.05 * (tentativa + 1))
                continue
            except Exception:
                try:
                    await self._con.chamar("POST", f"{self._con.base}:rollback", {"transaction": tid})
                except Exception:
                    pass
                raise
        raise OperationFailure("Firestore: muitas tentativas concorrentes")

    async def _brutos(self, docs: list[dict], tid: str) -> dict[str, dict]:
        """Versões sem remontagem (para saber os pedaços antigos)."""
        if not docs:
            return {}
        nomes = [self._nome_doc(doc_id({"_id": d["_id"]})) for d in docs]
        r = await self._con.chamar("POST", f"{self._con.base}:batchGet", {"documents": nomes, "transaction": tid}) or []
        return {x["found"]["name"].rsplit("/", 1)[1]: {kk: _decodificar(vv) for kk, vv in (x["found"].get("fields") or {}).items()}
                for x in r if "found" in x}

    async def _atualizar(self, filtro: dict, update: dict, *, upsert=False, multi=False, retornar=None, sort=None,
                         projecao=None, substituir=False):
        filtro = filtro or {}

        async def trabalho(tid):
            candidatos = await self._candidatos(filtro, None, tid)
            alvos = _aplicar_em_memoria(candidatos, filtro, None, _normalizar_sort(sort), 0, 0 if multi else 1)
            brutos = await self._brutos(alvos, tid)
            tmp = _motor_mock["u"][uuid.uuid4().hex]
            escritas, antes, depois, upsert_id = [], None, None, None
            try:
                if alvos:
                    tmp.insert_many([dict(d) for d in alvos])
                    antes = dict(alvos[0])
                    if substituir:
                        novo = dict(update)
                        novo["_id"] = alvos[0]["_id"]
                        tmp.replace_one({"_id": alvos[0]["_id"]}, novo)
                    else:
                        for d in alvos:
                            # O filtro original acompanha o _id para o operador posicional ($) achar o item.
                            tmp.update_one({**filtro, "_id": d["_id"]} if _usa_posicional(update) else {"_id": d["_id"]}, update)
                    for d in alvos:
                        novo = tmp.find_one({"_id": d["_id"]})
                        if novo != d:
                            did = doc_id({"_id": d["_id"]})
                            escritas += self._escritas_doc(did, novo, d, brutos.get(did))
                    depois = tmp.find_one({"_id": alvos[0]["_id"]})
                elif upsert:
                    if substituir:
                        base = dict(update)
                        for kk, vv in filtro.items():
                            if not kk.startswith("$") and "." not in kk and not isinstance(vv, dict):
                                base.setdefault(kk, vv)
                        tmp.insert_one(base)
                        novo = tmp.find_one({})
                    else:
                        res = tmp.update_one(filtro, update, upsert=True)
                        novo = tmp.find_one({"_id": res.upserted_id})
                    if type(novo["_id"]).__name__ == "ObjectId":
                        novo["_id"] = novo["id"] if isinstance(novo.get("id"), str) else uuid.uuid4().hex
                    did = doc_id({"_id": novo["_id"]})
                    escritas += self._escritas_doc(did, novo, None, None, criar=True)
                    depois, upsert_id = novo, novo["_id"]
            finally:
                tmp.drop()
            n = len(alvos)
            if retornar is not None:
                doc = depois if retornar == ReturnDocument.AFTER else antes
                if doc is not None and projecao:
                    doc = _aplicar_em_memoria([doc], {}, projecao)[0]
                return doc, escritas
            modificados = sum(1 for e in escritas if "update" in e and "/_uniq/" not in e["update"]["name"] and "/_blobs/" not in e["update"]["name"])
            return _Resultado(matched_count=n, modified_count=min(n, modificados), upserted_id=upsert_id), escritas

        return await self._transacao(trabalho)

    async def update_one(self, filtro, update, upsert=False, *a, session=None, **k):
        return await self._atualizar(filtro, update, upsert=upsert)

    async def update_many(self, filtro, update, upsert=False, *a, session=None, **k):
        filtro = filtro or {}
        # Em lotes: uma transação do Firestore aceita até 500 escritas.
        candidatos = _aplicar_em_memoria(await self._candidatos(filtro), filtro, {"_id": 1})
        total, modificados = 0, 0
        for i in range(0, len(candidatos), 150):
            ids = [c["_id"] for c in candidatos[i:i + 150]]
            r = await self._atualizar({"$and": [filtro, {"_id": {"$in": ids}}]}, update, multi=True)
            total += r.matched_count
            modificados += r.modified_count
        if not candidatos and upsert:
            return await self._atualizar(filtro, update, upsert=True)
        return _Resultado(matched_count=total, modified_count=modificados, upserted_id=None)

    async def replace_one(self, filtro, documento, upsert=False, *a, session=None, **k):
        return await self._atualizar(filtro, documento, upsert=upsert, substituir=True)

    async def find_one_and_update(self, filtro, update, projection=None, sort=None, upsert=False,
                                  return_document=ReturnDocument.BEFORE, *a, session=None, **k):
        return await self._atualizar(filtro, update, upsert=upsert, retornar=return_document, sort=sort, projecao=projection)

    async def find_one_and_delete(self, filtro, *a, sort=None, session=None, **k):
        doc = await self.find_one(filtro, sort=sort)
        if doc:
            await self.delete_one({"_id": doc["_id"]})
        return doc

    async def delete_one(self, filtro, *a, session=None, **k):
        return await self._apagar(filtro or {}, um=True)

    async def delete_many(self, filtro, *a, session=None, **k):
        return await self._apagar(filtro or {}, um=False)

    async def _apagar(self, filtro: dict, um: bool):
        alvos = _aplicar_em_memoria(await self._candidatos(filtro), filtro, None, None, 0, 1 if um else 0)
        apagados = 0
        for i in range(0, len(alvos), 100):
            lote = alvos[i:i + 100]
            nomes = [self._nome_doc(doc_id({"_id": d["_id"]})) for d in lote]
            r = await self._con.chamar("POST", f"{self._con.base}:batchGet", {"documents": nomes}) or []
            brutos = {x["found"]["name"].rsplit("/", 1)[1]: {kk: _decodificar(vv) for kk, vv in (x["found"].get("fields") or {}).items()}
                      for x in r if "found" in x}
            escritas = []
            for d in lote:
                did = doc_id({"_id": d["_id"]})
                escritas += self._escritas_doc(did, None, d, brutos.get(did))
            await self._commit(escritas)
            apagados += len(lote)
        return _Resultado(deleted_count=apagados)

    # ------------------------------------------------------------------ índices

    async def create_indexes(self, modelos, *a, **k):
        for m in modelos:
            doc = getattr(m, "document", m)
            registrar_indice(self.name, dict(doc))
        return [getattr(m, "document", {}).get("name", "") for m in modelos]

    async def create_index(self, chaves, *a, **k):
        especificacao = {"key": dict(chaves) if isinstance(chaves, list) else {chaves: 1}, **k}
        registrar_indice(self.name, especificacao)
        return especificacao.get("name", "")

    async def drop_index(self, *a, **k):
        return None

    async def drop(self, *a, **k):
        await self.delete_many({})


def _usa_posicional(update: dict) -> bool:
    return any(".$." in campo or campo.endswith(".$") for op in update.values() if isinstance(op, dict) for campo in op)


def cliente_do_ambiente() -> FirestoreMongoClient:
    """Lê FIREBASE_SERVICE_ACCOUNT (JSON puro ou base64) ou usa o emulador."""
    emulador = os.environ.get("FIRESTORE_EMULATOR_HOST")
    bruto = (os.environ.get("FIREBASE_SERVICE_ACCOUNT") or "").strip()
    credencial = None
    if bruto:
        try:
            credencial = json.loads(bruto if bruto.startswith("{") else base64.b64decode(bruto).decode())
        except Exception as exc:
            raise RuntimeError("FIREBASE_SERVICE_ACCOUNT inválida: cole o conteúdo inteiro do arquivo .json da chave") from exc
        if "\\n" in credencial.get("private_key", ""):
            credencial["private_key"] = credencial["private_key"].replace("\\n", "\n")
    if not credencial and not emulador:
        raise RuntimeError("Configure FIREBASE_SERVICE_ACCOUNT com a chave do Firebase")
    return FirestoreMongoClient(credencial, os.environ.get("FIREBASE_PROJECT_ID"), emulador)
