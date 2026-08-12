"""Batch-7 coverage push: loans, budgets, goals, savings, zakat, recurring, dashboard,
notifications helpers, currency utils, date_helper, core errors/rate_limit/permissions."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Shared Query / Db helpers (same pattern as batch2)
# ---------------------------------------------------------------------------

class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def filter_by(self, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def with_for_update(self):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first

    def count(self):
        return len(self.rows)

    def scalar(self):
        return self._first

    def offset(self, n):
        return self

    def limit(self, n):
        return self


class Db:
    def __init__(self, query_map=None, got=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.added = []
        self.commit_count = 0
        self.flush_count = 0
        self.refresh_count = 0
        self.deleted = []

    def query(self, model):
        payload = self.query_map.pop(model, None)
        if isinstance(payload, Query):
            return payload
        if isinstance(payload, list):
            return Query(rows=payload)
        return Query(first_row=payload)

    def get(self, model, key):
        if isinstance(self.got, dict):
            return self.got.get(key)
        return self.got

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flush_count += 1
        for i, row in enumerate(self.added):
            if getattr(row, "id", None) is None:
                row.id = f"id-{i + 1}"

    def commit(self):
        self.commit_count += 1

    def refresh(self, entity):
        self.refresh_count += 1
        return entity

    def delete(self, entity):
        self.deleted.append(entity)


def _run(coro):
    return asyncio.run(coro)


# ===========================================================================
# app/utils/currency.py
# ===========================================================================

def test_currency_money_zero():
    from app.utils.currency import money
    assert money(0) == "0.0000"


def test_currency_money_rounds():
    from app.utils.currency import money
    result = money("123.456789")
    assert result.startswith("123.4568")


def test_currency_money_none():
    from app.utils.currency import money
    assert money(None) == "0.0000"


def test_currency_to_decimal_valid():
    from app.utils.currency import to_decimal
    assert to_decimal("99.5") == Decimal("99.5")


def test_currency_to_decimal_invalid_returns_zero():
    from app.utils.currency import to_decimal
    assert to_decimal("abc") == Decimal("0")


def test_currency_to_decimal_none():
    from app.utils.currency import to_decimal
    assert to_decimal(None) == Decimal("0")


# ===========================================================================
# app/utils/date_helper.py
# ===========================================================================

def test_date_helper_utc_now_returns_datetime():
    from app.utils.date_helper import utc_now
    now = utc_now()
    assert isinstance(now, datetime)
    assert now.tzinfo is not None


def test_date_helper_to_iso_none():
    from app.utils.date_helper import to_iso
    assert to_iso(None) is None


def test_date_helper_to_iso_date():
    from app.utils.date_helper import to_iso
    d = date(2025, 1, 15)
    assert to_iso(d) == "2025-01-15"


def test_date_helper_to_iso_naive_datetime():
    from app.utils.date_helper import to_iso
    dt = datetime(2025, 6, 1, 12, 0, 0)
    result = to_iso(dt)
    assert "2025-06-01" in result


def test_date_helper_to_iso_aware_datetime():
    from app.utils.date_helper import to_iso
    dt = datetime(2025, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    result = to_iso(dt)
    assert "2025-06-01" in result


# ===========================================================================
# app/api/v1/loans.py  – pure helper functions
# ===========================================================================

def test_loans_money_helper():
    from app.api.v1.loans import money
    assert money(Decimal("100")) == "100.0000"


def test_loans_validate_amount_valid():
    from app.api.v1.loans import validate_amount
    result = validate_amount("250.50")
    assert result == Decimal("250.5000")


def test_loans_validate_amount_zero_raises():
    from app.api.v1.loans import validate_amount
    with pytest.raises(HTTPException) as exc:
        validate_amount("0")
    assert exc.value.status_code == 400


def test_loans_validate_amount_invalid_string_raises():
    from app.api.v1.loans import validate_amount
    with pytest.raises(HTTPException) as exc:
        validate_amount("not-a-number")
    assert exc.value.status_code == 400


def test_loans_clean_text_none():
    from app.api.v1.loans import clean_text
    assert clean_text(None) is None


def test_loans_clean_text_strips():
    from app.api.v1.loans import clean_text
    assert clean_text("  hello  ") == "hello"


def test_loans_clean_text_blank_returns_none():
    from app.api.v1.loans import clean_text
    assert clean_text("   ") is None


def test_loans_clean_currency_valid():
    from app.api.v1.loans import clean_currency
    assert clean_currency("usd") == "USD"


def test_loans_clean_currency_too_short_raises():
    from app.api.v1.loans import clean_currency
    with pytest.raises(HTTPException) as exc:
        clean_currency("AB")
    assert exc.value.status_code == 400


def test_loans_can_use_wallet_owner():
    from app.api.v1.loans import can_use_wallet
    member = SimpleNamespace(id="m1", role="OWNER")
    wallet = SimpleNamespace(owner_member_id="other", is_shared_family=False, is_owner_wallet=False)
    assert can_use_wallet(member, wallet) is True


def test_loans_can_use_wallet_member_shared():
    from app.api.v1.loans import can_use_wallet
    member = SimpleNamespace(id="m1", role="MEMBER")
    wallet = SimpleNamespace(owner_member_id="other", is_shared_family=True, is_owner_wallet=False)
    assert can_use_wallet(member, wallet) is True


def test_loans_can_use_wallet_denied():
    from app.api.v1.loans import can_use_wallet
    member = SimpleNamespace(id="m1", role="CHILD")
    wallet = SimpleNamespace(owner_member_id="other", is_shared_family=False, is_owner_wallet=False)
    assert can_use_wallet(member, wallet) is False


def test_loans_require_active_loan_active():
    from app.api.v1.loans import require_active_loan
    loan = SimpleNamespace(status="ACTIVE")
    require_active_loan(loan)  # no exception


def test_loans_require_active_loan_closed_raises():
    from app.api.v1.loans import require_active_loan
    loan = SimpleNamespace(status="CLOSED")
    with pytest.raises(HTTPException) as exc:
        require_active_loan(loan)
    assert exc.value.status_code == 400


# ===========================================================================
# app/api/v1/budgets.py – pure helpers
# ===========================================================================

def test_budgets_money():
    from app.api.v1.budgets import money
    assert money("50.123") == "50.1230"


def test_budgets_clean_text_required_raises():
    from app.api.v1.budgets import clean_text
    with pytest.raises(HTTPException) as exc:
        clean_text("", "Name")
    assert exc.value.status_code == 400


def test_budgets_clean_text_too_long_raises():
    from app.api.v1.budgets import clean_text
    with pytest.raises(HTTPException):
        clean_text("x" * 200, "Name", max_length=150)


def test_budgets_clean_text_valid():
    from app.api.v1.budgets import clean_text
    assert clean_text("Food", "Name") == "Food"


def test_budgets_clean_optional_text_none():
    from app.api.v1.budgets import clean_optional_text
    assert clean_optional_text(None) is None


def test_budgets_clean_optional_text_blank():
    from app.api.v1.budgets import clean_optional_text
    assert clean_optional_text("  ") is None


def test_budgets_clean_optional_text_too_long():
    from app.api.v1.budgets import clean_optional_text
    with pytest.raises(HTTPException):
        clean_optional_text("x" * 600)


def test_budgets_clean_currency_valid():
    from app.api.v1.budgets import clean_currency
    assert clean_currency("eur") == "EUR"


def test_budgets_clean_period_type_monthly():
    from app.api.v1.budgets import clean_period_type
    assert clean_period_type("monthly") == "MONTHLY"


def test_budgets_clean_period_type_invalid_raises():
    from app.api.v1.budgets import clean_period_type
    with pytest.raises(HTTPException):
        clean_period_type("DAILY")


def test_budgets_validate_amount_zero_raises():
    from app.api.v1.budgets import validate_amount
    with pytest.raises(HTTPException):
        validate_amount("0")


def test_budgets_percent_zero_budget():
    from app.api.v1.budgets import percent
    assert percent(100, 0) == "0.00"


def test_budgets_percent_calculates():
    from app.api.v1.budgets import percent
    assert percent(50, 100) == "50.00"


# ===========================================================================
# app/api/v1/goals.py – pure helpers
# ===========================================================================

def test_goals_money():
    from app.api.v1.goals import money
    assert money("10.5") == "10.5000"


def test_goals_progress_percent_zero_target():
    from app.api.v1.goals import progress_percent
    assert progress_percent(50, 0) == "0.00"


def test_goals_progress_percent_calculates():
    from app.api.v1.goals import progress_percent
    assert progress_percent(25, 100) == "25.00"


def test_goals_recommended_monthly_no_date():
    from app.api.v1.goals import recommended_monthly
    goal = SimpleNamespace(target_date=None, target_amount="1000", current_amount="0")
    assert recommended_monthly(goal) == "0.0000"


def test_goals_recommended_monthly_already_reached():
    from app.api.v1.goals import recommended_monthly
    future = date.today() + timedelta(days=90)
    goal = SimpleNamespace(target_date=future, target_amount="100", current_amount="200")
    assert recommended_monthly(goal) == "0.0000"


def test_goals_recommended_monthly_calculates():
    from app.api.v1.goals import recommended_monthly
    future = date.today() + timedelta(days=90)
    goal = SimpleNamespace(target_date=future, target_amount="600", current_amount="0")
    result = recommended_monthly(goal)
    assert Decimal(result) > 0


def test_goals_get_payload_wallet_id_wallet_account_id():
    from app.api.v1.goals import get_payload_wallet_id
    payload = SimpleNamespace(wallet_account_id="w1", account_id=None)
    assert get_payload_wallet_id(payload) == "w1"


def test_goals_get_payload_wallet_id_account_id_fallback():
    from app.api.v1.goals import get_payload_wallet_id
    payload = SimpleNamespace(wallet_account_id=None, account_id="a1")
    assert get_payload_wallet_id(payload) == "a1"


# ===========================================================================
# app/api/v1/savings.py – pure helpers
# ===========================================================================

def test_savings_validate_amount_valid():
    from app.api.v1.savings import validate_amount
    assert validate_amount("100") == Decimal("100.0000")


def test_savings_validate_amount_negative_raises():
    from app.api.v1.savings import validate_amount
    with pytest.raises(HTTPException):
        validate_amount("-5")


def test_savings_validate_amount_bad_string_raises():
    from app.api.v1.savings import validate_amount
    with pytest.raises(HTTPException):
        validate_amount("xyz")


def test_savings_clean_currency_short_raises():
    from app.api.v1.savings import clean_currency
    with pytest.raises(HTTPException):
        clean_currency("US")


def test_savings_percent_zero_target():
    from app.api.v1.savings import percent
    assert percent(10, 0) == "0.00"


def test_savings_percent_normal():
    from app.api.v1.savings import percent
    assert percent(75, 100) == "75.00"


# ===========================================================================
# app/api/v1/zakat.py – pure helpers
# ===========================================================================

def test_zakat_money():
    from app.api.v1.zakat import money
    assert money("2500") == "2500.0000"


def test_zakat_clean_currency():
    from app.api.v1.zakat import clean_currency
    assert clean_currency("gbp") == "GBP"


def test_zakat_resolve_metal_values_gold_no_rate_raises():
    from app.api.v1.zakat import resolve_metal_values
    db = Db()
    payload = SimpleNamespace(
        gold_value=None, silver_value=None,
        gold_grams=10, silver_grams=None,
        nisab_amount=None, nisab_metal=None,
    )
    with pytest.raises(HTTPException) as exc:
        resolve_metal_values(db, payload)
    assert exc.value.status_code == 400


def test_zakat_resolve_metal_values_explicit_nisab():
    from app.api.v1.zakat import resolve_metal_values
    mock_rate = SimpleNamespace(rate_bdt="850", metal="GOLD")
    db = Db(query_map={})
    # Provide explicit nisab_amount so no rate lookup needed for nisab
    payload = SimpleNamespace(
        gold_value="500", silver_value="200",
        gold_grams=None, silver_grams=None,
        nisab_amount="5000", nisab_metal=None,
    )
    gold_v, silver_v, nisab = resolve_metal_values(db, payload)
    assert gold_v == Decimal("500")
    assert silver_v == Decimal("200")
    assert nisab == Decimal("5000")


# ===========================================================================
# app/api/v1/recurring.py – pure helpers
# ===========================================================================

def test_recurring_money():
    from app.api.v1.recurring import money
    assert money("99.9999") == "99.9999"


def test_recurring_clean_text_none():
    from app.api.v1.recurring import clean_text
    assert clean_text(None) is None


def test_recurring_clean_text_strips():
    from app.api.v1.recurring import clean_text
    assert clean_text("  Salary  ") == "Salary"


def test_recurring_can_use_wallet_owner():
    from app.api.v1.recurring import can_use_wallet
    member = SimpleNamespace(id="m1", role="OWNER")
    wallet = SimpleNamespace(owner_member_id="x", is_shared_family=False, is_owner_wallet=False)
    assert can_use_wallet(member, wallet) is True


def test_recurring_can_use_wallet_child_denied():
    from app.api.v1.recurring import can_use_wallet
    member = SimpleNamespace(id="m1", role="CHILD")
    wallet = SimpleNamespace(owner_member_id="other", is_shared_family=False, is_owner_wallet=False)
    assert can_use_wallet(member, wallet) is False


def test_recurring_get_wallet_not_found_raises():
    from app.api.v1.recurring import get_wallet
    db = Db(got=None)
    member = SimpleNamespace(id="m1", role="OWNER")
    with pytest.raises(HTTPException) as exc:
        get_wallet(db, "fam1", "wal1", member)
    assert exc.value.status_code == 404


# ===========================================================================
# app/api/v1/dashboard.py – get_rate_to_base
# ===========================================================================

def test_dashboard_get_rate_same_currency():
    from app.api.v1.dashboard import get_rate_to_base
    db = Db()
    rate = get_rate_to_base(db, "BDT", "BDT")
    assert rate == Decimal("1")


def test_dashboard_get_rate_different_currency_no_rate():
    from app.api.v1.dashboard import get_rate_to_base
    from app.models.currency import ExchangeRate
    db = Db(query_map={ExchangeRate: Query(first_row=None)})
    rate = get_rate_to_base(db, "USD", "BDT")
    # fallback when no rate found – dashboard returns 0 (unknown rate)
    assert rate == Decimal("0") or rate == Decimal("1")


def test_dashboard_get_rate_different_with_rate():
    from app.api.v1.dashboard import get_rate_to_base
    from app.models.currency import ExchangeRate
    mock_rate = SimpleNamespace(rate="110.5")
    db = Db(query_map={ExchangeRate: Query(first_row=mock_rate)})
    rate = get_rate_to_base(db, "USD", "BDT")
    assert rate == Decimal("110.5")


# ===========================================================================
# app/api/v1/notifications.py – template & helper code
# ===========================================================================

def test_notifications_templates_keys_present():
    from app.api.v1.notifications import NOTIFICATION_TEMPLATES
    for key in ("BUDGET_OVER", "BUDGET_WARNING", "RECURRING_DUE", "LOAN_ACTIVE"):
        assert key in NOTIFICATION_TEMPLATES


def test_notifications_template_fields():
    from app.api.v1.notifications import NOTIFICATION_TEMPLATES
    template = NOTIFICATION_TEMPLATES["BUDGET_OVER"]
    assert "title" in template
    assert "severity" in template
    assert "message" in template


# ===========================================================================
# app/core/errors.py – register_exception_handlers coverage
# ===========================================================================

def test_errors_register_exception_handlers_callable():
    from app.core.errors import register_exception_handlers
    from fastapi import FastAPI
    app = FastAPI()
    register_exception_handlers(app)  # should not raise


def test_errors_http_exception_handler_with_code_in_detail(monkeypatch):
    """HTTP exc handler returns custom code when detail is a dict with 'code'."""
    from app.core.errors import register_exception_handlers
    from fastapi import FastAPI, HTTPException
    from starlette.testclient import TestClient

    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/test-err")
    async def _err():
        raise HTTPException(401, detail={"code": "AUTH_001", "message": "No access"})

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/test-err")
    assert resp.status_code == 401
    body = resp.json()
    assert body.get("code") == "AUTH_001" or body.get("error", {}).get("code") == "AUTH_001"


# ===========================================================================
# app/core/rate_limit.py
# ===========================================================================

def test_rate_limit_constants():
    from app.core.rate_limit import AUTH_LOGIN_LIMIT, AUTH_REGISTER_LIMIT, API_USER_LIMIT
    assert AUTH_LOGIN_LIMIT == "5/minute"
    assert AUTH_REGISTER_LIMIT == "3/hour"
    assert API_USER_LIMIT == "60/minute"


def test_rate_limit_storage_uri_memory(monkeypatch):
    from app.core import rate_limit as rl
    monkeypatch.setattr(rl.settings, "REDIS_URL", "", raising=False)
    assert rl._storage_uri() == "memory://"


def test_rate_limit_storage_uri_redis(monkeypatch):
    from app.core import rate_limit as rl
    monkeypatch.setattr(rl.settings, "REDIS_URL", "redis://localhost:6379", raising=False)
    assert rl._storage_uri() == "redis://localhost:6379"


def test_rate_limit_key_fallback_to_ip(monkeypatch):
    from app.core.rate_limit import rate_limit_key
    req = SimpleNamespace(
        headers={},
        client=SimpleNamespace(host="1.2.3.4"),
        url=SimpleNamespace(path="/"),
    )
    # No authorization header – should fall back to remote address (via slowapi)
    # We mock get_remote_address to verify fallback
    with patch("app.core.rate_limit.get_remote_address", return_value="1.2.3.4"):
        result = rate_limit_key(req)
    assert result == "1.2.3.4"


def test_rate_limit_key_bearer_invalid_token(monkeypatch):
    from app.core.rate_limit import rate_limit_key
    req = SimpleNamespace(
        headers={"authorization": "Bearer invalidtoken"},
        client=SimpleNamespace(host="5.5.5.5"),
        url=SimpleNamespace(path="/"),
    )
    with patch("app.core.rate_limit.get_remote_address", return_value="5.5.5.5"):
        result = rate_limit_key(req)
    assert result == "5.5.5.5"  # falls back when token decode fails


# ===========================================================================
# app/core/permissions.py – re-exports
# ===========================================================================

def test_permissions_module_reexports():
    import app.core.permissions as pmod
    for name in ("get_active_member_or_403", "has_permission", "normalize_role",
                 "require_owner", "require_permission"):
        assert hasattr(pmod, name)
