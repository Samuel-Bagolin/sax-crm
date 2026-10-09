"""Shared model helpers: string ids, aware-UTC timestamps, datetime normalisation."""

import uuid
from datetime import datetime, timezone


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def utc_aware(dt: datetime | str | None) -> datetime | None:
    """Normaliza o que vem do Mongo para datetime com offset UTC.

    Motor devolve datetime naive; já um documento restaurado de backup JSON traz a data como
    string ISO — ambos precisam virar datetime aware para o Pydantic serializar.
    """
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is not None:
        return dt
    return dt.replace(tzinfo=timezone.utc)
