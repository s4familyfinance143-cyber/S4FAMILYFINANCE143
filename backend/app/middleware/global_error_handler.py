"""Global error handler middleware alias — FastAPI exception handlers are canonical."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class GlobalErrorHandlerMiddleware(BaseHTTPMiddleware):
    """
    Safety net: unhandled exceptions should already be caught by
    register_exception_handlers(). This middleware ensures request_id
    is preserved if a raw ASGI error escapes.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            import logging
            import sys

            from fastapi.responses import JSONResponse

            # Reached only when an exception escapes register_exception_handlers()
            # entirely — e.g. raised inside another middleware (AuditLogMiddleware,
            # AuthContextMiddleware, ...) positioned outside RequestLoggerMiddleware
            # in the stack, so that middleware's status-only log line never fires
            # either. Without this, such an exception was traced nowhere.
            logging.getLogger("s4.error").exception(
                "Exception escaped exception handlers on %s %s: %s",
                request.method,
                request.url.path,
                exc,
            )
            print(
                f"[S4 SERVER_ERROR] {request.method} {request.url.path}: {exc!r}",
                file=sys.stderr,
                flush=True,
            )

            request_id = getattr(request.state, "request_id", None)
            return JSONResponse(
                status_code=500,
                content={
                    "error": True,
                    "detail": "Internal server error",
                    "path": str(request.url.path),
                    "request_id": request_id,
                },
            )


# Alias expected by architecture checklist
GlobalErrorHandler = GlobalErrorHandlerMiddleware
