"""Architecture-standard API response helpers."""

from __future__ import annotations

from typing import Any


SUCCESS_MESSAGE_BN = "সফল হয়েছে"


def success_response(
    data: Any = None,
    *,
    message: str = SUCCESS_MESSAGE_BN,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "success": True,
        "data": data,
        "message": message,
    }
    if meta is not None:
        body["meta"] = meta
    return body


def list_response(
    data: list[Any],
    *,
    total: int | None = None,
    page: int = 1,
    limit: int = 20,
    message: str = SUCCESS_MESSAGE_BN,
) -> dict[str, Any]:
    items = list(data or [])
    if total is None:
        total = len(items)
    return success_response(
        items,
        message=message,
        meta={"total": total, "page": page, "limit": limit},
    )


def error_response(
    *,
    code: str,
    message: str,
    status_code: int = 400,
) -> dict[str, Any]:
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
    }


def http_status_to_code(status_code: int) -> str:
    mapping = {
        400: "BAD_REQUEST",
        401: "AUTH_001",
        403: "AUTH_003",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "VALIDATION_001",
        429: "RATE_LIMIT",
        500: "SERVER_ERROR",
    }
    return mapping.get(status_code, f"HTTP_{status_code}")


def detail_to_message(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("detail") or detail)
    if isinstance(detail, list):
        return "Validation failed"
    return str(detail)
