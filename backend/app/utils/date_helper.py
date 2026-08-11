from __future__ import annotations

from datetime import date, datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()
