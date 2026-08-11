"""UTC helpers — prefer these over deprecated datetime.utcnow()."""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Naive UTC timestamp (matches existing DateTime columns in this codebase)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_now_aware() -> datetime:
    """Timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)
