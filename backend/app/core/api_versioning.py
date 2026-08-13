"""API version helpers — /api/v1 and /api/v2 are first-class mounts."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


def resolve_api_version(path: str) -> str | None:
    """Return '1', '2', or None for non-versioned paths."""
    if path.startswith("/api/v2/") or path == "/api/v2" or path.startswith("/api/v2?"):
        return "2"
    if path.startswith("/api/v1/") or path == "/api/v1" or path.startswith("/api/v1?"):
        return "1"
    return None


class ApiVersionHeaderMiddleware(BaseHTTPMiddleware):
    """Attach X-API-Version on versioned routes so clients can assert the surface."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        version = resolve_api_version(request.url.path or "")
        if version:
            response.headers.setdefault("X-API-Version", version)
            response.headers.setdefault("X-API-Supported-Versions", "1, 2")
        return response


def api_version_payload(version: str) -> dict:
    return {
        "api_version": version,
        "supported_versions": ["1", "2"],
        "prefixes": {"v1": "/api/v1", "v2": "/api/v2"},
        "note": (
            "v1 and v2 expose the same stable business contract. "
            "Both are supported; prefer /api/v2 for new clients. "
            "Legacy unversioned mounts are off by default."
        ),
    }
