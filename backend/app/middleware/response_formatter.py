"""Response formatter — architecture success/error envelope."""

from __future__ import annotations

import json

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.api_response import SUCCESS_MESSAGE_BN, http_status_to_code


SKIP_PREFIXES = (
    "/docs",
    "/redoc",
    "/openapi",
    "/health",
    "/metrics",
    "/favicon",
)


class ResponseFormatterMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        request_id = getattr(request.state, "request_id", None)
        if request_id:
            response.headers.setdefault("X-Request-ID", str(request_id))

        path = request.url.path or ""
        if any(path == p or path.startswith(p + "/") for p in ("/health",)) or any(
            path.startswith(p) for p in SKIP_PREFIXES if p != "/health"
        ):
            return response

        content_type = (response.headers.get("content-type") or "").lower()
        if "application/json" not in content_type:
            return response

        try:
            body = getattr(response, "body", None)
            if body is None:
                return response
            raw = body.decode("utf-8")
            if not raw:
                return response
            payload = json.loads(raw)
        except Exception:
            return response

        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}

        # Errors: normalize to architecture envelope if not already
        if response.status_code >= 400:
            if isinstance(payload, dict) and payload.get("success") is False and "error" in payload:
                if request_id and "request_id" not in payload:
                    payload = {**payload, "request_id": request_id}
                return JSONResponse(payload, status_code=response.status_code, headers=headers)

            message = "Request failed"
            code = http_status_to_code(response.status_code)
            if isinstance(payload, dict):
                err = payload.get("error")
                if isinstance(err, dict):
                    message = str(err.get("message") or message)
                    code = str(err.get("code") or code)
                elif payload.get("detail") is not None:
                    message = str(payload.get("detail"))
                elif payload.get("message") is not None:
                    message = str(payload.get("message"))
                elif err is not None:
                    message = str(err)
            out = {
                "success": False,
                "error": {"code": code, "message": message},
            }
            if request_id:
                out["request_id"] = request_id
            return JSONResponse(out, status_code=response.status_code, headers=headers)

        # Success: wrap unless already architecture-shaped
        if isinstance(payload, dict) and "success" in payload:
            return response

        if isinstance(payload, list):
            out = {
                "success": True,
                "data": payload,
                "message": SUCCESS_MESSAGE_BN,
                "meta": {
                    "total": len(payload),
                    "page": 1,
                    "limit": len(payload) or 20,
                },
            }
        else:
            out = {
                "success": True,
                "data": payload,
                "message": SUCCESS_MESSAGE_BN,
            }
        if request_id:
            out["request_id"] = request_id
        return JSONResponse(out, status_code=response.status_code, headers=headers)
