"""Optional Redis cache helpers (dashboard/rates). Memory no-op when REDIS_URL unset."""

from __future__ import annotations

import json
from typing import Any

from app.core.config import settings

_client = None
_memory: dict[str, tuple[float, str]] = {}


def _redis():
    global _client
    url = (settings.REDIS_URL or "").strip()
    if not url:
        return None
    if _client is not None:
        return _client
    try:
        import redis

        _client = redis.Redis.from_url(url, decode_responses=True)
        _client.ping()
        return _client
    except Exception:
        _client = False  # type: ignore
        return None


def cache_get(key: str) -> Any | None:
    import time

    r = _redis()
    if r:
        raw = r.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None
    row = _memory.get(key)
    if not row:
        return None
    expires, raw = row
    if expires and expires < time.time():
        _memory.pop(key, None)
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def cache_set(key: str, value: Any, ttl_seconds: int = 60) -> None:
    import time

    raw = json.dumps(value, default=str)
    r = _redis()
    if r:
        try:
            r.setex(key, max(1, ttl_seconds), raw)
            return
        except Exception:
            pass
    _memory[key] = (time.time() + max(1, ttl_seconds), raw)


def cache_delete(key: str) -> None:
    r = _redis()
    if r:
        try:
            r.delete(key)
        except Exception:
            pass
    _memory.pop(key, None)


def cache_status() -> dict:
    r = _redis()
    return {
        "redis_url_set": bool((settings.REDIS_URL or "").strip()),
        "redis_connected": bool(r),
        "backend": "redis" if r else "memory",
    }
