"""Server-side date helpers. The pod clock is UTC — anchor "today" here, never in the browser."""

import os
from datetime import datetime
from zoneinfo import ZoneInfo


def today_iso(tz: str | None = None) -> str:
    """Today's date as YYYY-MM-DD in `tz` (default: APP_TZ env, else America/Sao_Paulo)."""
    zone = tz or os.environ.get("APP_TZ", "America/Sao_Paulo")
    return datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")
