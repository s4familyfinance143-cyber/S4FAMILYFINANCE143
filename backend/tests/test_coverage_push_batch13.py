"""Batch-13 coverage push: auth, loans, recurring, savings, goals, invites,
missing_features_api, architecture_features_api, main — mock-only route tests."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response


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

    def join(self, *args, **kwargs):
        return self

    def with_for_update(self):
        return self

    def limit(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first

    def count(self):
        return len(self.rows)


class Db:
    def __init__(self, query_map=None, got=None):
        self.query_map = dict(query_map or {})
        self._persistent = dict(query_map or {})
        self.got = got
        self.added = []
        self.commit_count = 0
        self.flush_count = 0
        self.refresh_count = 0

    def query(self, model):
        payload = self._persistent.get(model)
        if payload is None:
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


def _run(coro):
    return asyncio.run(coro)


def _user(uid="u1"):
    return SimpleNamespace(id=uid, email="u@example.com", is_active=True, is_email_verified=True)


def _member(mid="m1", role="OWNER"):
    return SimpleNamespace(id=mid, family_id="fam-1", user_id="u1", role=role)


def _request(**headers):
    hdrs = [(k.encode(), v.encode()) for k, v in headers.items()]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": hdrs,
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    return Request(scope)


# ===========================================================================
# auth.py
# ===========================================================================

def test_auth_get_device_label_explicit_header():
    from app.api.v1.auth import get_device_label

    req = _request(**{"x-device-id": "  my-device-123  "})
    assert get_device_label(req) == "my-device-123"


def test_auth_get_device_label_hashes_user_agent():
    from app.api.v1.auth import get_device_label

    req = _request(**{"user-agent": "TestAgent/1.0"})
    label = get_device_label(req)
    assert len(label) == 40


def test_auth_primary_family_claims_found_and_missing():
    from app.api.v1.auth import primary_family_claims
    from app.models.family_member import FamilyMember

    member = SimpleNamespace(family_id="fam-1", role="OWNER")
    db = Db(query_map={FamilyMember: Query(first_row=member)})
    fid, role = primary_family_claims(db, "u1")
    assert fid == "fam-1"
    assert role == "OWNER"

    db2 = Db(query_map={FamilyMember: Query(first_row=None)})
    assert primary_family_claims(db2, "u1") == (None, None)


def test_auth_get_requested_new_password_paths():
    from app.api.v1.auth import get_requested_new_password
    from app.schemas.auth import ResetPasswordRequest

    token = "valid-token-1"
    assert get_requested_new_password(ResetPasswordRequest(token=token, new_password="secret123")) == "secret123"
    assert get_requested_new_password(ResetPasswordRequest(token=token, password="legacy123")) == "legacy123"
    with pytest.raises(HTTPException) as exc:
        get_requested_new_password(ResetPasswordRequest(token=token))
    assert exc.value.status_code == 422


def test_auth_email_status_and_read_me(monkeypatch):
    from app.api.v1 import auth as mod
    from app.core import config as cfg

    monkeypatch.setattr(mod, "smtp_status", lambda: {"configured": False, "note": "no smtp"})
    monkeypatch.setattr(cfg.settings, "AUTH_EMAIL_ENABLED", False, raising=False)
    monkeypatch.setattr(cfg.settings, "NOTIFICATION_EMAIL_ENABLED", False, raising=False)
    status = mod.auth_email_status()
    assert status.can_send is False
    assert "SMTP" in status.note

    user = SimpleNamespace(
        id="u1",
        full_name="Test User",
        email="u@example.com",
        phone=None,
        preferred_language="bn",
        is_active=True,
        is_email_verified=True,
    )
    monkeypatch.setattr(mod, "avatar_url_for", lambda uid: None)
    resp = mod.read_me(current_user=user)
    assert resp.email == "u@example.com"


def test_auth_forgot_password_unknown_user_safe_message(monkeypatch):
    from app.api.v1 import auth as mod
    from app.models.user import User
    from app.schemas.auth import ForgotPasswordRequest

    db = Db(query_map={User: Query(first_row=None)})
    out = mod.forgot_password(
        payload=ForgotPasswordRequest(email="nobody@example.com"),
        request=_request(),
        response=Response(),
        db=db,
    )
    assert "If this email exists" in out.message
    assert out.reset_token is None


def test_auth_get_user_avatar_forbidden_and_not_found(monkeypatch):
    from app.api.v1 import auth as mod

    with pytest.raises(HTTPException) as exc:
        mod.get_user_avatar(user_id="other", current_user=_user("u1"))
    assert exc.value.status_code == 403

    monkeypatch.setattr(mod, "find_avatar_file", lambda uid: None)
    with pytest.raises(HTTPException) as exc2:
        mod.get_user_avatar(user_id="u1", current_user=_user("u1"))
    assert exc2.value.status_code == 404


# ===========================================================================
# loans.py
# ===========================================================================

def test_loans_loan_response_and_get_loan_not_found():
    from app.api.v1 import loans as mod
    from app.models.loan import Loan

    loan = SimpleNamespace(
        id="l1",
        family_id="fam-1",
        owner_member_id="m1",
        wallet_account_id="w1",
        loan_type="GIVEN",
        person_name="Alice",
        principal_amount=Decimal("1000"),
        paid_amount=Decimal("200"),
        remaining_amount=Decimal("800"),
        interest_rate=Decimal("0"),
        interest_type="NONE",
        installment_count=0,
        installment_amount=None,
        start_date="2026-01-01",
        next_due_date=None,
        end_date=None,
        currency="BDT",
        status="ACTIVE",
        note=None,
        created_at=None,
    )
    resp = mod.loan_response(loan, wallet_balance=Decimal("5000"))
    assert resp["principal_amount"] == "1000.0000"
    assert resp["wallet_balance"] == "5000.0000"

    db = Db(query_map={Loan: Query(first_row=None)})
    with pytest.raises(HTTPException) as exc:
        mod.get_loan(db, "fam-1", "missing")
    assert exc.value.status_code == 404


def test_loans_list_loans_route(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.loan import Loan

    loan = SimpleNamespace(
        id="l1",
        family_id="fam-1",
        owner_member_id="m1",
        wallet_account_id="w1",
        loan_type="TAKEN",
        person_name="Bob",
        principal_amount=Decimal("500"),
        paid_amount=Decimal("0"),
        remaining_amount=Decimal("500"),
        interest_rate=Decimal("0"),
        interest_type="NONE",
        installment_count=None,
        installment_amount=None,
        start_date="2026-01-01",
        next_due_date=None,
        end_date=None,
        currency="BDT",
        status="ACTIVE",
        note=None,
        created_at=None,
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    rows = mod.list_loans("fam-1", Db(query_map={Loan: [loan]}), _user())
    assert len(rows) == 1
    assert rows[0]["person_name"] == "Bob"


def test_loans_close_loan_remaining_balance(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.loan import Loan
    from app.schemas.loan import LoanCloseRequest

    loan = SimpleNamespace(
        id="l1",
        family_id="fam-1",
        owner_member_id="m1",
        wallet_account_id="w1",
        loan_type="GIVEN",
        person_name="Alice",
        principal_amount=Decimal("100"),
        paid_amount=Decimal("0"),
        remaining_amount=Decimal("50"),
        interest_rate=Decimal("0"),
        interest_type="NONE",
        installment_count=None,
        installment_amount=None,
        start_date="2026-01-01",
        next_due_date=None,
        end_date=None,
        currency="BDT",
        status="ACTIVE",
        note=None,
        created_at=None,
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    db = Db(query_map={Loan: Query(first_row=loan)})
    with pytest.raises(HTTPException) as exc:
        mod.close_loan(
            "l1",
            LoanCloseRequest(family_id="fam-1"),
            db=db,
            current_user=_user(),
        )
    assert "remaining balance" in str(exc.value.detail).lower()


def test_loans_get_wallet_inactive():
    from app.api.v1 import loans as mod
    from app.models.account import Account

    wallet = SimpleNamespace(
        id="w1",
        family_id="fam-1",
        deleted_at=None,
        is_active=False,
        owner_member_id="m1",
        is_shared_family=False,
        is_owner_wallet=False,
    )
    db = Db(query_map={Account: Query(first_row=wallet)})
    with pytest.raises(HTTPException) as exc:
        mod.get_wallet(db, "fam-1", "w1", _member())
    assert exc.value.status_code == 400


# ===========================================================================
# recurring.py
# ===========================================================================

def test_recurring_next_due_date_frequencies():
    from app.api.v1.recurring import next_due_date

    base = date(2026, 1, 15)
    assert next_due_date(base, "DAILY") == date(2026, 1, 16)
    assert next_due_date(base, "WEEKLY") == date(2026, 1, 22)
    assert next_due_date(base, "MONTHLY") == date(2026, 2, 15)
    assert next_due_date(base, "YEARLY") == date(2027, 1, 15)
    with pytest.raises(HTTPException):
        next_due_date(base, "QUARTERLY")


def test_recurring_serialize_and_list(monkeypatch):
    from app.api.v1 import recurring as mod
    from app.models.recurring import RecurringTransaction

    item = SimpleNamespace(
        id="r1",
        family_id="fam-1",
        account_id="w1",
        category_id="c1",
        title="Rent",
        transaction_type="EXPENSE",
        amount=Decimal("1000"),
        currency="BDT",
        frequency="MONTHLY",
        start_date=date(2026, 1, 1),
        end_date=None,
        next_due_date=date(2026, 2, 1),
        last_posted_at=None,
        status="ACTIVE",
        description="monthly rent",
        created_at=None,
    )
    serialized = mod.serialize_recurring(item)
    assert serialized["amount"] == "1000.0000"
    assert serialized["title"] == "Rent"

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    listed = mod.list_recurring("fam-1", Db(query_map={RecurringTransaction: [item]}), _user())
    assert len(listed) == 1


def test_recurring_pause_wrong_status(monkeypatch):
    from app.api.v1 import recurring as mod
    from app.models.recurring import RecurringTransaction
    from app.schemas.recurring import RecurringStatusRequest

    recurring = SimpleNamespace(
        id="r1",
        family_id="fam-1",
        status="PAUSED",
        title="Rent",
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: recurring)
    with pytest.raises(HTTPException) as exc:
        mod.pause_recurring(
            "r1",
            RecurringStatusRequest(family_id="fam-1"),
            db=Db(),
            current_user=_user(),
        )
    assert "active" in str(exc.value.detail).lower()


def test_recurring_get_category_inactive():
    from app.api.v1 import recurring as mod
    from app.models.category import Category

    category = SimpleNamespace(
        id="c1",
        family_id="fam-1",
        deleted_at=None,
        is_active=False,
        category_type="EXPENSE",
    )
    db = Db(got=category)
    with pytest.raises(HTTPException) as exc:
        mod.get_category(db, "fam-1", "c1", "EXPENSE")
    assert exc.value.status_code == 400


# ===========================================================================
# savings.py
# ===========================================================================

def test_savings_response_and_annual_plan(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.savings import SavingsGoal

    goal = SimpleNamespace(
        id="g1",
        family_id="fam-1",
        owner_member_id="m1",
        wallet_account_id="w1",
        name="Emergency",
        goal_type="EMERGENCY",
        target_amount=Decimal("12000"),
        current_amount=Decimal("3000"),
        currency="BDT",
        status="ACTIVE",
        note=None,
        deleted_at=None,
        created_at=None,
    )
    resp = mod.savings_response(goal)
    assert resp["progress_percent"] == "25.00"

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    plan = mod.savings_annual_plan("fam-1", year="2026", db=Db(query_map={SavingsGoal: [goal]}), current_user=_user())
    assert plan["emergency_fund_count"] == 1
    assert plan["year"] == "2026"


def test_savings_list_goals_route(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.savings import SavingsGoal

    goal = SimpleNamespace(
        id="g1",
        family_id="fam-1",
        owner_member_id="m1",
        wallet_account_id="w1",
        name="Trip",
        goal_type="GENERAL",
        target_amount=Decimal("5000"),
        current_amount=Decimal("0"),
        currency="BDT",
        status="ACTIVE",
        note=None,
        deleted_at=None,
        created_at=None,
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    rows = mod.list_savings_goals("fam-1", Db(query_map={SavingsGoal: [goal]}), _user())
    assert rows[0]["name"] == "Trip"


def test_savings_close_with_balance(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.savings import SavingsGoal
    from app.schemas.savings import SavingsGoalCloseRequest

    goal = SimpleNamespace(
        id="g1",
        family_id="fam-1",
        owner_member_id="m1",
        wallet_account_id="w1",
        name="Trip",
        goal_type="GENERAL",
        target_amount=Decimal("5000"),
        current_amount=Decimal("100"),
        currency="BDT",
        status="ACTIVE",
        note=None,
        deleted_at=None,
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "get_savings_goal", lambda db, fid, gid, lock=True: goal)
    with pytest.raises(HTTPException) as exc:
        mod.close_savings_goal(
            "g1",
            SavingsGoalCloseRequest(family_id="fam-1"),
            db=Db(),
            current_user=_user(),
        )
    assert "withdraw" in str(exc.value.detail).lower()


# ===========================================================================
# goals.py
# ===========================================================================

def test_goals_serialize_and_summary(monkeypatch):
    from app.api.v1 import goals as mod
    from app.models.goal import FinancialGoal

    goal = SimpleNamespace(
        id="g1",
        family_id="fam-1",
        linked_savings_goal_id=None,
        goal_name="House",
        goal_type="GENERAL",
        target_amount=Decimal("100000"),
        current_amount=Decimal("25000"),
        currency="BDT",
        target_date=date(2027, 12, 31),
        status="ACTIVE",
        note=None,
        created_at=None,
    )
    serialized = mod.serialize_goal(goal)
    assert serialized["goal_name"] == "House"
    assert serialized["progress_percent"] == "25.00"

    active = goal
    closed = SimpleNamespace(**{**goal.__dict__, "id": "g2", "status": "CLOSED"})
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    summary = mod.goal_summary("fam-1", Db(query_map={FinancialGoal: [active, closed]}), _user())
    assert summary["active_count"] == 1
    assert summary["closed_count"] == 1


def test_goals_get_goal_wrong_status():
    from app.api.v1 import goals as mod

    goal = SimpleNamespace(
        id="g1",
        family_id="fam-1",
        deleted_at=None,
        status="CLOSED",
    )
    db = Db(got=goal)
    with pytest.raises(HTTPException) as exc:
        mod.get_goal(db, "fam-1", "g1", allowed_statuses={"ACTIVE"})
    assert exc.value.status_code == 400


def test_goals_get_linked_savings_invalid():
    from app.api.v1 import goals as mod

    goal = SimpleNamespace(linked_savings_goal_id="s1", family_id="fam-1")
    db = Db(got=None)
    with pytest.raises(HTTPException) as exc:
        mod.get_linked_savings(db, goal)
    assert exc.value.status_code == 400


def test_goals_delete_route(monkeypatch):
    from app.api.v1 import goals as mod
    from app.schemas.goal import GoalCloseRequest

    goal = SimpleNamespace(
        id="g1",
        family_id="fam-1",
        goal_name="House",
        deleted_at=None,
        status="ACTIVE",
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "get_goal", lambda db, fid, gid, allowed_statuses=None: goal)
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    out = mod.delete_goal(
        "g1",
        GoalCloseRequest(family_id="fam-1", reason="done"),
        db=Db(),
        current_user=_user(),
    )
    assert out["deleted"] is True
    assert goal.status == "DELETED"


# ===========================================================================
# invites.py
# ===========================================================================

def test_invites_generate_bad_max_uses(monkeypatch):
    from app.api.v1 import invites as mod
    from app.schemas.invite import InviteCodeCreateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.generate_invite_code(
            "fam-1",
            InviteCodeCreateRequest(expires_in_days=7, max_uses=25),
            db=Db(),
            current_user=_user(),
        )
    assert exc.value.status_code == 400


def test_invites_email_invalid_address(monkeypatch):
    from app.api.v1 import invites as mod
    from app.schemas.invite import InviteEmailRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.invite_by_email(
            "fam-1",
            InviteEmailRequest(invitee_email="not-an-email", expires_in_days=7, max_uses=1),
            db=Db(),
            current_user=_user(),
        )
    assert exc.value.status_code == 400


def test_invites_revoke_not_found(monkeypatch):
    from app.api.v1 import invites as mod
    from app.models.invite_code import InviteCode

    db = Db(query_map={InviteCode: Query(first_row=None)})
    with pytest.raises(HTTPException) as exc:
        mod.revoke_invite_code("missing", db=db, current_user=_user())
    assert exc.value.status_code == 404


def test_invites_revoke_already_revoked(monkeypatch):
    from app.api.v1 import invites as mod
    from app.models.invite_code import InviteCode

    invite = SimpleNamespace(id="inv-1", family_id="fam-1", status="REVOKED")
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    out = mod.revoke_invite_code("inv-1", db=Db(query_map={InviteCode: Query(first_row=invite)}), current_user=_user())
    assert out["status"] == "REVOKED"
    assert "Already" in out["message"]


def test_invites_join_invalid_code(monkeypatch):
    from app.api.v1 import invites as mod
    from app.models.invite_code import InviteCode
    from app.schemas.invite import JoinByCodeRequest

    db = Db(query_map={InviteCode: Query(first_row=None)})
    with pytest.raises(HTTPException) as exc:
        mod.join_family_by_code(
            _request(),
            JoinByCodeRequest(invite_code="BAD-CODE", relationship_type="Brother"),
            db=db,
            current_user=_user(),
        )
    assert exc.value.status_code == 404


# ===========================================================================
# missing_features_api.py
# ===========================================================================

def test_missing_features_money_d_helper():
    from app.api.v1.missing_features_api import _money_d, money

    assert money("1.23456") == "1.2346"
    assert _money_d("10.5") == Decimal("10.5000")


def test_missing_features_list_metal_rates():
    from app.api.v1 import missing_features_api as mod
    from app.models.missing_features import MetalRate

    rows = [
        SimpleNamespace(
            id="r2",
            metal="GOLD",
            unit="GRAM",
            rate_bdt=Decimal("8100"),
            effective_date="2026-02-01",
            source="manual",
            deleted_at=None,
            created_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            id="r1",
            metal="GOLD",
            unit="GRAM",
            rate_bdt=Decimal("8000"),
            effective_date="2026-01-01",
            source="manual",
            deleted_at=None,
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        ),
    ]
    out = mod.list_metal_rates(db=Db(query_map={MetalRate: rows}), current_user=_user())
    assert len(out["rates"]) == 1
    assert out["rates"][0]["rate_bdt"] == "8100.0000"


def test_missing_features_nisab_from_rates_paths():
    from app.api.v1 import missing_features_api as mod
    from app.models.missing_features import MetalRate

    rate = SimpleNamespace(
        rate_bdt=Decimal("100"),
        unit="GRAM",
        effective_date="2026-01-01",
        deleted_at=None,
    )
    db = Db(query_map={MetalRate: Query(first_row=rate)})
    silver = mod.nisab_from_rates(metal="SILVER", db=db, current_user=_user())
    assert silver["metal"] == "SILVER"
    assert "nisab_amount" in silver

    with pytest.raises(HTTPException) as exc:
        mod.nisab_from_rates(metal="PLATINUM", db=db, current_user=_user())
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        mod.nisab_from_rates(metal="GOLD", db=Db(query_map={MetalRate: Query(first_row=None)}), current_user=_user())
    assert exc2.value.status_code == 404


def test_missing_features_get_expense_splits_tx_missing(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.transaction import Transaction

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        mod.get_expense_splits(
            "tx-missing",
            "fam-1",
            db=Db(query_map={Transaction: Query(first_row=None)}),
            current_user=_user(),
        )
    assert exc.value.status_code == 404


def test_missing_features_list_vehicles(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.missing_features import Vehicle

    vehicle = SimpleNamespace(
        id="v1",
        name="Family Car",
        vehicle_type="CAR",
        registration_no="DHK-123",
        current_km=Decimal("15000"),
        currency="BDT",
        status="ACTIVE",
        notes=None,
        deleted_at=None,
        created_at=None,
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    rows = mod.list_vehicles("fam-1", db=Db(query_map={Vehicle: [vehicle]}), user=_user())
    assert rows[0]["name"] == "Family Car"


# ===========================================================================
# architecture_features_api.py
# ===========================================================================

def test_architecture_list_tags(monkeypatch):
    from app.api.v1 import architecture_features_api as mod
    from app.models.architecture_feature import Tag

    tag = SimpleNamespace(id="t1", name="Food", color="#ff0000", deleted_at=None)
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    rows = mod.list_tags("fam-1", db=Db(query_map={Tag: [tag]}), user=_user())
    assert rows[0]["name"] == "Food"


def test_architecture_create_tag_duplicate(monkeypatch):
    from app.api.v1 import architecture_features_api as mod
    from app.models.architecture_feature import Tag

    existing = SimpleNamespace(id="t1", name="Food", color=None, deleted_at=None)
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.create_tag(
            mod.TagIn(family_id="fam-1", name="Food"),
            db=Db(query_map={Tag: Query(first_row=existing)}),
            user=_user(),
        )
    assert exc.value.status_code == 400


def test_architecture_attach_tag_tx_not_found(monkeypatch):
    from app.api.v1 import architecture_features_api as mod
    from app.models.transaction import Transaction

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.attach_tag(
            mod.TxTagIn(family_id="fam-1", transaction_id="tx1", tag_id="t1"),
            db=Db(query_map={Transaction: Query(first_row=None)}),
            user=_user(),
        )
    assert exc.value.status_code == 404


def test_architecture_list_loan_payments(monkeypatch):
    from app.api.v1 import architecture_features_api as mod
    from app.models.architecture_feature import LoanPayment

    payment = SimpleNamespace(
        id="p1",
        loan_id="l1",
        amount=Decimal("500"),
        payment_date="2026-01-15",
        notes="installment",
        payment_method="CASH",
        transaction_id="tx1",
        deleted_at=None,
        created_at=None,
    )
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    rows = mod.list_loan_payments("fam-1", loan_id="l1", db=Db(query_map={LoanPayment: [payment]}), user=_user())
    assert rows[0]["amount"] == "500.0000"


def test_architecture_delete_tag_not_found(monkeypatch):
    from app.api.v1 import architecture_features_api as mod
    from app.models.architecture_feature import Tag

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        mod.delete_tag("t-missing", "fam-1", db=Db(query_map={Tag: Query(first_row=None)}), user=_user())
    assert exc.value.status_code == 404


# ===========================================================================
# main.py
# ===========================================================================

def test_main_root_and_health():
    from app import main as main_mod

    root = main_mod.root()
    assert "S4 FAMILY FINANCE API" in root["message"]

    health = main_mod.health_check()
    assert health["status"] == "ok"
    assert health["layers"]["prometheus_metrics"] is True


def test_main_debug_ws_routes_production(monkeypatch):
    from app import main as main_mod

    monkeypatch.setattr(main_mod.settings, "ENVIRONMENT", "production", raising=False)
    with pytest.raises(HTTPException) as exc:
        main_mod.debug_ws_routes()
    assert exc.value.status_code == 404


def test_main_create_development_tables_skips_when_disabled(monkeypatch):
    from app import main as main_mod

    called = {"create": False}
    monkeypatch.setattr(main_mod.settings, "AUTO_CREATE_TABLES", False, raising=False)
    monkeypatch.setattr(main_mod.Base.metadata, "create_all", lambda **kw: called.__setitem__("create", True))
    main_mod.create_development_tables()
    assert called["create"] is False


async def _noop_next(request):
    return Response(status_code=200)


def test_main_deprecation_middleware(monkeypatch):
    from app import main as main_mod

    mw = main_mod.mark_unversioned_api_deprecated
    req = _request()
    req.scope["path"] = "/legacy/accounts"
    resp = _run(mw(req, _noop_next))
    assert resp.headers.get("Deprecation") == "true"
    assert "successor-version" in resp.headers.get("Link", "")


def test_main_worker_loops_handle_errors(monkeypatch):
    from app import main as main_mod

    calls = {"recurring": 0, "backup": 0}

    def boom_recurring():
        calls["recurring"] += 1
        raise RuntimeError("boom")

    def boom_backup():
        calls["backup"] += 1
        raise RuntimeError("backup fail")

    monkeypatch.setattr(main_mod, "process_recurring_transactions", boom_recurring)
    monkeypatch.setattr(main_mod, "process_auto_backup", boom_backup)

    async def instant_sleep(_seconds):
        raise asyncio.CancelledError()

    monkeypatch.setattr(main_mod.asyncio, "sleep", instant_sleep)

    with pytest.raises(asyncio.CancelledError):
        _run(main_mod.recurring_worker())
    with pytest.raises(asyncio.CancelledError):
        _run(main_mod.auto_backup_worker())

    assert calls["recurring"] == 1
    assert calls["backup"] == 1
