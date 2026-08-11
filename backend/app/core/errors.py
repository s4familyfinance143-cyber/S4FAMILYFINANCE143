"""Global HTTP exception handlers — architecture error envelope."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.api_response import detail_to_message, error_response, http_status_to_code


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        code = http_status_to_code(exc.status_code)
        message = detail_to_message(exc.detail)
        # Preserve explicit AUTH codes from detail dict when provided
        if isinstance(exc.detail, dict) and exc.detail.get("code"):
            code = str(exc.detail.get("code"))
            message = str(exc.detail.get("message") or message)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response(code=code, message=message, status_code=exc.status_code),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=error_response(
                code="VALIDATION_001",
                message="Validation failed",
                status_code=422,
            ),
        )

    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
        import logging

        logging.getLogger("s4.db").exception(
            "SQLAlchemy error on %s %s: %s",
            request.method,
            request.url.path,
            exc,
        )
        return JSONResponse(
            status_code=500,
            content=error_response(
                code="DB_001",
                message="Database error",
                status_code=500,
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content=error_response(
                code="SERVER_ERROR",
                message="Internal server error",
                status_code=500,
            ),
        )
