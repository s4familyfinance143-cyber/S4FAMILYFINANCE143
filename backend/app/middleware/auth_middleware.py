"""ASGI middleware: attach auth context + reject blacklisted bearer tokens early."""

from __future__ import annotations

import hashlib

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.security import decode_token
from app.services.redis_session import is_token_blacklisted


PUBLIC_PREFIXES = (
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v2/auth/login",
    "/api/v2/auth/register",
)


class AuthContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.user_id = None
        request.state.token_jti = None

        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
            token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
            try:
                payload = decode_token(token)
                jti = payload.get("jti")
                if is_token_blacklisted(jti=jti, token_hash=token_hash):
                    return JSONResponse({"detail": "Token revoked"}, status_code=401)
                request.state.user_id = payload.get("sub")
                request.state.token_jti = jti
                request.state.access_token_hash = token_hash
            except Exception:
                # Let route-level auth decide; middleware only blocks explicit blacklist hits
                pass

        return await call_next(request)
