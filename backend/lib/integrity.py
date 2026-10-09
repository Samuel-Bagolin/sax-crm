"""Shared validation, exact money allocation, sequencing, audit and list pagination."""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from lib.db import db
from models.common import new_id, now_utc


def cents(value) -> int:
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def money(value) -> float:
    return cents(value) / 100


def percentage(value, pct) -> float:
    return money(Decimal(str(value)) * Decimal(str(pct)) / 100)


def split_money(value, count: int) -> list[float]:
    base, residue = divmod(cents(value), count)
    return [(base + (1 if i < residue else 0)) / 100 for i in range(count)]


async def sequence(collection, field: str, prefix: str) -> str:
    # Atomic counter; initialize from historical maximum without deleting/reusing old numbers.
    maximum = 0
    async for doc in collection.find({field: {"$regex": "^" + prefix}}, {field: 1}):
        tail = str(doc.get(field, "")).removeprefix(prefix)
        if tail.isdigit(): maximum = max(maximum, int(tail))
    try:
        await db.counters.update_one({"_id": prefix}, {"$max": {"value": maximum}}, upsert=True)
    except DuplicateKeyError:
        await db.counters.update_one({"_id": prefix}, {"$max": {"value": maximum}})
    counter = await db.counters.find_one_and_update({"_id": prefix}, {"$inc": {"value": 1}}, return_document=ReturnDocument.AFTER)
    return f"{prefix}{counter['value']:04d}"


async def audit(principal, action: str, resource_id: str, before=None, after=None):
    # Only explicitly supplied business fields, never passwords, tokens or raw request bodies.
    await db.audit_events.insert_one({"id": new_id(), "actor": principal.usuario_id, "action": action,
        "resource_id": resource_id, "before": before, "after": after, "at": now_utc()})


async def reference(collection: str, value: str | None, principal=None, action=None):
    if not value: return None
    doc = await db[collection].find_one({"id": value})
    if not doc: raise HTTPException(422, f"Referência inválida: {collection}")
    if collection == "pessoas" and principal is not None and not principal.is_admin:
        from routers.pessoas import person_scope
        if not await db.pessoas.find_one({"$and": [{"id": value}, await person_scope(principal)]}):
            raise HTTPException(404, "Pessoa não encontrada")
    if principal is not None and action:
        from lib.auth import authorize
        authorize(principal, action, doc)
    return doc


async def page(cursor, response: Response, offset: int, limit: int):
    docs = await cursor.skip(offset).limit(limit + 1).to_list(limit + 1)
    if len(docs) > limit: response.headers["X-Next-Offset"] = str(offset + limit)
    return docs[:limit]


from functools import wraps
from datetime import timedelta

def operation_lock(collection_name):
    def decorate(function):
        @wraps(function)
        async def wrapped(*args, **kwargs):
            # Decorated core routines always receive a dict or record id as first argument.
            first = args[0] if args else kwargs.get("doc", kwargs.get("contrato_id"))
            rid = first["id"] if isinstance(first, dict) else first
            collection = db[collection_name]
            token = new_id()
            doc = await collection.find_one_and_update({"id": rid, "$or": [{"operation_until": {"$exists": False}}, {"operation_until": {"$lt": now_utc()}}]},
                {"$set": {"operation_token": token, "operation_until": now_utc()+timedelta(minutes=10)}}, return_document=ReturnDocument.AFTER)
            if not doc: raise HTTPException(409, "Operação em andamento ou registro indisponível; atualize e tente novamente")
            try:
                if isinstance(first, dict):
                    if args: args = (doc, *args[1:])
                    else: kwargs["doc"] = doc
                return await function(*args, **kwargs)
            finally:
                await collection.update_one({"id": rid, "operation_token": token}, {"$unset": {"operation_until": "", "operation_token": ""}})
        return wrapped
    return decorate
