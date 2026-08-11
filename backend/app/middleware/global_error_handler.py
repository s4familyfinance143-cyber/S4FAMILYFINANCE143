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
        except Exception:
            from fastapi.responses import JSONResponse

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
