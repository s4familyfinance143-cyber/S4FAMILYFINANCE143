"""HttpOnly Secure refresh cookie helpers (architecture Auth & Security)."""

from __future__ import annotations

from fastapi import Request, Response

from app.core.config import settings


def refresh_cookie_name() -> str:
    return settings.REFRESH_COOKIE_NAME or "s4_refresh_token"


def set_refresh_cookie(response: Response, raw_refresh_token: str) -> None:
    max_age = int(settings.REFRESH_TOKEN_EXPIRE_DAYS) * 24 * 60 * 60
    secure = bool(settings.IS_PRODUCTION or settings.REFRESH_COOKIE_SECURE)
    response.set_cookie(
        key=refresh_cookie_name(),
        value=raw_refresh_token,
        httponly=True,
        secure=secure,
        samesite=settings.REFRESH_COOKIE_SAMESITE or "lax",
        max_age=max_age,
        path="/",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=refresh_cookie_name(), path="/")


def read_refresh_token(request: Request, body_token: str | None = None) -> str | None:
    """Prefer HttpOnly cookie; fall back to body for mobile clients."""
    cookie_val = request.cookies.get(refresh_cookie_name())
    if cookie_val:
        return cookie_val
    if body_token:
        return body_token
    return None
