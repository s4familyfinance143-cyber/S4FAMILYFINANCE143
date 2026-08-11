"""Auth rate limiting via slowapi (Redis when REDIS_URL set, else memory).

Architecture:
- Login: 5/min
- Register: 3/hr
- API: 60/min per user (JWT sub) or IP
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings


def _storage_uri() -> str:
    url = (settings.REDIS_URL or "").strip()
    if url:
        return url
    return "memory://"


def rate_limit_key(request) -> str:
    """Prefer authenticated user id; fall back to client IP."""
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        if token:
            try:
                from app.core.security import decode_token

                payload = decode_token(token)
                uid = payload.get("user_id") or payload.get("sub")
                if uid:
                    return f"user:{uid}"
            except Exception:
                pass
    return get_remote_address(request)


limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=["60/minute"],
    storage_uri=_storage_uri(),
    headers_enabled=True,
)

# Architecture exact numbers
AUTH_LOGIN_LIMIT = "5/minute"
AUTH_REGISTER_LIMIT = "3/hour"
AUTH_PASSWORD_EMAIL_LIMIT = "5/minute"
API_USER_LIMIT = "60/minute"
JOIN_REQUEST_LIMIT = "10/minute"
