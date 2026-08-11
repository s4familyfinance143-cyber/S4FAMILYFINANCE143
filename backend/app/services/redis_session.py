"""JWT denylist + session cache on Redis (memory fallback when REDIS_URL unset)."""

from __future__ import annotations

import json
import time
from typing import Any

from app.services.redis_cache import cache_delete, cache_get, cache_set, _redis


def blacklist_jti(jti: str, ttl_seconds: int) -> None:
    if not jti:
        return
    cache_set(f"jwt:blacklist:{jti}", {"revoked_at": time.time()}, ttl_seconds=max(1, ttl_seconds))


def blacklist_token_hash(token_hash: str, ttl_seconds: int) -> None:
    if not token_hash:
        return
    cache_set(f"jwt:blacklist:hash:{token_hash}", {"revoked_at": time.time()}, ttl_seconds=max(1, ttl_seconds))


def is_token_blacklisted(*, jti: str | None = None, token_hash: str | None = None) -> bool:
    if jti and cache_get(f"jwt:blacklist:{jti}") is not None:
        return True
    if token_hash and cache_get(f"jwt:blacklist:hash:{token_hash}") is not None:
        return True
    return False


def session_set(session_id: str, payload: dict[str, Any], ttl_seconds: int = 86400) -> None:
    cache_set(f"session:{session_id}", payload, ttl_seconds=ttl_seconds)


def session_get(session_id: str) -> dict[str, Any] | None:
    value = cache_get(f"session:{session_id}")
    return value if isinstance(value, dict) else None


def session_delete(session_id: str) -> None:
    cache_delete(f"session:{session_id}")


def rate_limit_incr(key: str, window_seconds: int = 60) -> int:
    """Atomic-ish counter for rate limiting (Redis INCR or memory)."""
    r = _redis()
    full = f"ratelimit:{key}"
    if r:
        try:
            count = int(r.incr(full))
            if count == 1:
                r.expire(full, max(1, window_seconds))
            return count
        except Exception:
            pass
    # memory fallback
    row = cache_get(full)
    count = int((row or {}).get("n", 0)) + 1 if isinstance(row, dict) else 1
    cache_set(full, {"n": count}, ttl_seconds=window_seconds)
    return count


def redis_stack_status() -> dict[str, Any]:
    r = _redis()
    return {
        "jwt_blacklist": "redis" if r else "memory",
        "session_store": "redis" if r else "memory",
        "rate_limit_counter": "redis" if r else "memory",
        "connected": bool(r),
    }
