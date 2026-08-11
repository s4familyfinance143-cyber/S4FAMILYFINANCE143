"""Request logger middleware — method, path, status, latency, request id + api_logs table."""

from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("s4.request")


class RequestLoggerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        response = None
        try:
            response = await call_next(request)
            return response
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            status = getattr(response, "status_code", 500) if response is not None else 500
            if response is not None:
                response.headers["X-Request-ID"] = request_id
                response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
            logger.info(
                "request_id=%s method=%s path=%s status=%s duration_ms=%.1f user_id=%s",
                request_id,
                request.method,
                request.url.path,
                status,
                elapsed_ms,
                getattr(request.state, "user_id", None),
            )
            path = request.url.path or ""
            if path not in ("/docs", "/openapi.json", "/redoc", "/health", "/"):
                try:
                    from app.core.database import SessionLocal
                    from app.models.architecture_system import ApiLog
                    from app.services.architecture_system_hooks import bump_rate_limit

                    db = SessionLocal()
                    try:
                        db.add(
                            ApiLog(
                                user_id=getattr(request.state, "user_id", None),
                                endpoint=path[:255],
                                method=request.method[:10],
                                status_code=int(status),
                                duration_ms=int(elapsed_ms),
                            )
                        )
                        if "/auth/" in path and request.method.upper() == "POST":
                            client = request.client.host if request.client else "unknown"
                            bump_rate_limit(
                                db,
                                identifier=client,
                                endpoint=path[:255],
                                limit=120,
                                window_seconds=60,
                            )
                        db.commit()
                    finally:
                        db.close()
                except Exception:
                    pass
