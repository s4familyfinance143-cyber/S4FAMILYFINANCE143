"""Architecture API/table smoke — no live server required for model/route import checks."""

from app.main import app as fastapi_app
from app.models.base import Base
import app.models  # noqa: F401


def test_architecture_tables_registered():
    needed = {
        "user_preferences",
        "refresh_tokens",
        "device_sessions",
        "push_tokens",
        "tags",
        "transaction_tags",
        "loan_payments",
        "expense_categories",
        "income_categories",
        "vendor_contacts",
        "grocery_list_items",
        "investments",
        "investment_returns",
        "health_expenses",
        "vehicle_expenses",
        "education_funds",
        "properties",
        "subscriptions",
        "documents",
        "sync_queue",
        "sync_logs",
        "device_registry",
        "notification_templates",
        "api_logs",
        "rate_limits",
    }
    names = set(Base.metadata.tables.keys())
    missing = sorted(needed - names)
    assert missing == [], f"Missing tables: {missing}"


def test_architecture_routes_registered():
    paths = {getattr(r, "path", "") for r in fastapi_app.routes}
    for needle in (
        "/api/v1/investments",
        "/api/v1/health-expenses",
        "/api/v1/vehicle-expenses",
        "/api/v1/education-funds",
        "/api/v1/properties",
        "/api/v1/subscriptions",
        "/api/v1/documents",
        "/api/v1/tags",
        "/api/v1/loan-payments",
        "/api/v1/transaction-tags",
        "/api/v1/life-modules/summary",
        "/api/v1/life-modules/upcoming",
        "/api/v1/user-preferences",
        "/api/v1/sync-logs",
        "/api/v1/device-registry",
        "/api/v1/notification-templates",
    ):
        assert any(needle in p for p in paths), f"Missing route containing {needle}"

    # PATCH update endpoints for dedicated modules
    methods_by_path = {}
    for r in fastapi_app.routes:
        p = getattr(r, "path", "") or ""
        methods = getattr(r, "methods", None) or set()
        methods_by_path.setdefault(p, set()).update(methods)
    for patch_path in (
        "/api/v1/investments/{item_id}",
        "/api/v1/health-expenses/{item_id}",
        "/api/v1/vehicle-expenses/{item_id}",
        "/api/v1/education-funds/{item_id}",
        "/api/v1/properties/{item_id}",
        "/api/v1/subscriptions/{item_id}",
        "/api/v1/documents/{item_id}",
    ):
        assert "PATCH" in methods_by_path.get(patch_path, set()), f"Missing PATCH {patch_path}"


def test_sync_apply_allows_architecture_entities():
    from app.services.sync_apply import ALLOWED_ENTITY_TYPES, APPLYABLE_NOW

    for et in (
        "investments",
        "health_expenses",
        "education_funds",
        "documents",
        "tags",
        "loan_payments",
    ):
        assert et in ALLOWED_ENTITY_TYPES
        assert et in APPLYABLE_NOW


def test_auth_push_cutover_models():
    from app.models.architecture_auth import DeviceSession, PushToken, RefreshToken, UserPreference

    assert RefreshToken.__tablename__ == "refresh_tokens"
    assert DeviceSession.__tablename__ == "device_sessions"
    assert PushToken.__tablename__ == "push_tokens"
    assert UserPreference.__tablename__ == "user_preferences"
    assert hasattr(RefreshToken, "token_family")
    assert hasattr(RefreshToken, "status")
