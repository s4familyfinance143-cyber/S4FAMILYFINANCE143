"""Architecture layers — middleware, DI, modules, utils, repos must be real."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.modules import MODULES, auth_module, finance_module, grocery_module
from app.utils.currency import money, to_decimal
from app.utils.date_helper import to_iso, utc_now

client = TestClient(app)


def test_health_exposes_full_layer_stack():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    layers = body["layers"]
    assert layers["repository_pattern"] is True
    assert layers["service_layer"] is True
    assert layers["dependency_injection"] is True
    middleware = layers["middleware"]
    for name in (
        "CORSMiddleware",
        "RequestLoggerMiddleware",
        "AuthContextMiddleware",
        "RateLimitMiddleware",
        "AuditLogMiddleware",
        "ResponseFormatterMiddleware",
        "GlobalErrorHandler",
    ):
        assert name in middleware
    assert "auth" in layers["modules"]
    assert "finance" in layers["modules"]
    assert res.headers.get("x-request-id") or res.headers.get("X-Request-ID")


def test_middleware_classes_importable():
    from app.middleware.audit_middleware import AuditLogMiddleware
    from app.middleware.auth_middleware import AuthContextMiddleware
    from app.middleware.global_error_handler import GlobalErrorHandler
    from app.middleware.rate_limit_middleware import RateLimitMiddleware
    from app.middleware.request_logger import RequestLoggerMiddleware
    from app.middleware.response_formatter import ResponseFormatterMiddleware

    assert callable(AuditLogMiddleware)
    assert callable(AuthContextMiddleware)
    assert callable(GlobalErrorHandler)
    assert callable(RateLimitMiddleware)
    assert callable(RequestLoggerMiddleware)
    assert callable(ResponseFormatterMiddleware)


def test_dependencies_factories_exist():
    from app.core.dependencies import (
        get_current_user,
        require_owner_dep,
        require_permission_for_family,
        require_role,
    )

    assert callable(get_current_user)
    assert callable(require_owner_dep)
    assert callable(require_permission_for_family)
    assert callable(require_role("OWNER"))
    assert callable(require_permission_for_family("transaction.read"))


def test_modules_are_real_packages():
    assert "auth" in MODULES
    assert finance_module.transaction_void_service is not None
    assert auth_module.security is not None
    assert grocery_module.sync_apply is not None


def test_utils_money_and_dates():
    assert money("10.5") == "10.5000"
    assert to_decimal("3.14") > 0
    now = utc_now()
    assert to_iso(now) is not None


def test_repositories_export_account_and_transaction():
    from app.repositories import account_repo, family_repo, transaction_repo, user_repo

    assert callable(user_repo)
    assert callable(family_repo)
    assert callable(account_repo)
    assert callable(transaction_repo)
