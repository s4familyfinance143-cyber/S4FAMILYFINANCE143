"""Batch-5 coverage push: compat aliases, repositories, jobs, families, architecture contract."""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def with_for_update(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first

    def count(self):
        return len(self.rows)


class Db:
    def __init__(self, query_map=None, got=None, execute_results=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.execute_results = list(execute_results or [])
        self.added = []
        self.commit_count = 0
        self.refresh_count = 0
        self._bind = MagicMock()

    @property
    def bind(self):
        return self._bind

    def query(self, model):
        payload = self.query_map.pop(model, None)
        if isinstance(payload, Query):
            return payload
        if isinstance(payload, list):
            return Query(rows=payload)
        return Query(first_row=payload, rows=[] if payload is None else [payload])

    def get(self, model, key):
        if isinstance(self.got, dict):
            return self.got.get(key)
        return self.got

    def add(self, row):
        self.added.append(row)

    def flush(self):
        for i, row in enumerate(self.added):
            if getattr(row, "id", None) is None:
                row.id = f"id-{i + 1}"

    def commit(self):
        self.commit_count += 1

    def refresh(self, entity):
        self.refresh_count += 1
        return entity

    def execute(self, stmt, params=None):
        if self.execute_results:
            return self.execute_results.pop(0)
        return MagicMock()

    def rollback(self):
        pass

    def close(self):
        pass


def _run(coro):
    return asyncio.run(coro)


def _user(uid="u1"):
    return SimpleNamespace(id=uid, email="u@example.com")


def _member(mid="m1"):
    return SimpleNamespace(id=mid, family_id="fam-1", user_id="u1", role="OWNER")


# ---------------------------------------------------------------------------
# compat_aliases
# ---------------------------------------------------------------------------


def test_compat_alias_response_helpers():
    from app.api.v1 import compat_aliases as mod

    inv = SimpleNamespace(
        id="inv-1",
        family_id="fam-1",
        name="FD",
        type="FD",
        member_id="m1",
        principal=Decimal("1000"),
        rate=Decimal("0.05"),
        currency="BDT",
        maturity="2026-12-31",
        start_date="2026-01-01",
        status="ACTIVE",
        note="note",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    out = mod._investment_alias_response(inv)
    assert out["module_type"] == "INVESTMENT"
    assert out["amount"] == "1000.0000"
    assert out["secondary_amount"] == "0.0500"

    inv_no_rate = SimpleNamespace(**{**inv.__dict__, "rate": None})
    assert mod._investment_alias_response(inv_no_rate)["secondary_amount"] is None

    sub = SimpleNamespace(
        id="sub-1",
        family_id="fam-1",
        name="Netflix",
        amount=Decimal("499"),
        currency="BDT",
        next_due="2026-09-01",
        cycle="MONTHLY",
        payment_account_id="acc-1",
        status="ACTIVE",
        notes="monthly",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    sub_out = mod._subscription_alias_response(sub)
    assert sub_out["module_type"] == "SUBSCRIPTION"
    assert sub_out["billing_cycle"] == "MONTHLY"
    assert sub_out["amount"] == "499.0000"


def test_compat_alias_create_and_list_routes(monkeypatch):
    from app.api.v1 import compat_aliases as mod
    from app.models.architecture_modules import Investment, Subscription
    from app.models.transaction import Transaction

    member = _member()
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: member)
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(mod, "create_income", lambda **k: {"kind": "income"})
    monkeypatch.setattr(mod, "create_expense", lambda **k: {"kind": "expense"})

    db = Db()
    user = _user()
    inv_payload = mod.InvestmentAliasCreateRequest(
        family_id="fam-1", name="Gold", amount=Decimal("500"), currency="usd"
    )
    created = mod.create_investment_alias(payload=inv_payload, db=db, current_user=user)
    assert created["module_type"] == "INVESTMENT"
    assert created["currency"] == "USD"
    assert db.commit_count == 1

    tx = SimpleNamespace(
        id="tx-1",
        family_id="fam-1",
        category_id="c1",
        amount=Decimal("10"),
        currency="BDT",
        description="salary",
        status="POSTED",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db2 = Db({Transaction: [tx]})
    income_rows = mod.list_income_alias(family_id="fam-1", db=db2, current_user=user)
    assert income_rows[0]["amount"] == "10.0000"

    db3 = Db({Transaction: [tx]})
    expense_rows = mod.list_expense_alias(family_id="fam-1", db=db3, current_user=user)
    assert expense_rows[0]["description"] == "salary"

    inv_row = SimpleNamespace(
        id="i1",
        family_id="fam-1",
        name="FD",
        type="FD",
        member_id=None,
        principal=Decimal("1"),
        rate=None,
        currency="BDT",
        maturity=None,
        start_date=None,
        status="ACTIVE",
        note=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db4 = Db({Investment: [inv_row]})
    assert mod.list_investments_alias("fam-1", db4, user)[0]["id"] == "i1"

    sub_payload = mod.SubscriptionAliasCreateRequest(
        family_id="fam-1", name="Spotify", amount=Decimal("99"), reference="ref"
    )
    db5 = Db()
    sub_created = mod.create_subscription_alias(payload=sub_payload, db=db5, current_user=user)
    assert sub_created["module_type"] == "SUBSCRIPTION"
    assert db5.commit_count == 1

    sub_row = SimpleNamespace(
        id="s1",
        family_id="fam-1",
        name="Spotify",
        amount=Decimal("99"),
        currency="BDT",
        next_due=None,
        cycle="MONTHLY",
        payment_account_id=None,
        status="ACTIVE",
        notes=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db6 = Db({Subscription: [sub_row]})
    assert mod.list_subscriptions_alias("fam-1", db6, user)[0]["name"] == "Spotify"


# ---------------------------------------------------------------------------
# database + repositories
# ---------------------------------------------------------------------------


def test_build_engine_kwargs_branches(monkeypatch):
    from app.core import database as dbmod

    monkeypatch.setattr(dbmod.settings, "DATABASE_URL", "sqlite+pysqlite:///./test.db")
    monkeypatch.setattr(dbmod.settings, "DATABASE_ECHO", False)
    sqlite_kw = dbmod.build_engine_kwargs()
    assert sqlite_kw["connect_args"] == {"check_same_thread": False}
    assert "pool_size" not in sqlite_kw

    monkeypatch.setattr(
        dbmod.settings,
        "DATABASE_URL",
        "postgresql+psycopg://user:pass@localhost/db",
    )
    monkeypatch.setattr(dbmod.settings, "DB_POOL_SIZE", 5)
    monkeypatch.setattr(dbmod.settings, "DB_MAX_OVERFLOW", 10)
    monkeypatch.setattr(dbmod.settings, "DB_POOL_RECYCLE_SECONDS", 300)
    pg_kw = dbmod.build_engine_kwargs()
    assert pg_kw["pool_size"] == 5
    assert pg_kw["max_overflow"] == 10


def test_repository_entities_and_base():
    from app.models.account import Account
    from app.models.family import Family
    from app.models.family_member import FamilyMember
    from app.models.transaction import Transaction
    from app.models.user import User
    from app.repositories.base import BaseRepository
    from app.repositories import entities

    user_row = SimpleNamespace(id="u1", email="A@Example.COM", deleted_at=None)
    db = Db({User: user_row})
    repo = entities.UserRepository(db)
    assert repo.get_by_email("  A@Example.COM ") is user_row

    fam = SimpleNamespace(id="f1", is_active=True, deleted_at=None)
    db2 = Db({Family: [fam]})
    fam_repo = entities.FamilyRepository(db2)
    assert fam_repo.list_active_for_user("u1") == [fam]

    acct = SimpleNamespace(id="a1", family_id="fam-1", deleted_at=None)
    db3 = Db({Account: [acct]})
    acct_repo = entities.account_repo(db3)
    assert acct_repo.list_active_for_family("fam-1") == [acct]

    tx = SimpleNamespace(id="t1", family_id="fam-1", deleted_at=None, created_at=datetime(2026, 1, 1))
    db4 = Db({Transaction: [tx]})
    tx_repo = entities.transaction_repo(db4)
    assert tx_repo.list_for_family("fam-1", limit=10) == [tx]

    soft = SimpleNamespace(deleted_at=None)
    base = BaseRepository(db)
    base.model = User
    base.delete_soft(soft)
    assert soft.deleted_at is not None
    assert entities.user_repo(db) is not None
    assert entities.family_repo(db) is not None


# ---------------------------------------------------------------------------
# jobs routes
# ---------------------------------------------------------------------------


def test_jobs_export_reminder_and_report_routes(monkeypatch):
    from app.api.v1 import jobs as mod
    from app.models.infra_jobs import ExportJob, ReminderSchedule

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "enqueue_export_job", lambda job_id: {"queued": True, "job_id": job_id})
    monkeypatch.setattr(mod, "enqueue_report", lambda fam, rtype: {"family_id": fam, "report_type": rtype})

    db = Db()
    user = _user()
    payload = mod.ExportJobCreate(family_id="fam-1", report_type="monthly", format="pdf")
    out = mod.create_export_job(payload=payload, db=db, current_user=user)
    assert out["queue"]["queued"] is True
    assert db.commit_count == 1

    job = SimpleNamespace(
        id="j1",
        user_id="u1",
        report_type="monthly",
        format="pdf",
        status="DONE",
        file_path="/tmp/x.pdf",
        error=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db2 = Db({ExportJob: [job]})
    listed = mod.list_export_jobs("fam-1", db2, user)
    assert listed[0]["id"] == "j1"
    assert listed[0]["created_at"].startswith("2026")

    remind_at = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)
    db3 = Db()
    reminder = mod.create_reminder(
        payload=mod.ReminderCreate(family_id="fam-1", title=" Pay bill ", remind_at=remind_at, channel="email"),
        db=db3,
        current_user=user,
    )
    assert reminder["title"] == "Pay bill"
    assert db3.commit_count == 1

    rem = SimpleNamespace(
        id="r1",
        title="Bill",
        remind_at=remind_at,
        channel="PUSH",
        status="SCHEDULED",
    )
    db4 = Db({ReminderSchedule: [rem]})
    rem_list = mod.list_reminders("fam-1", db4, user)
    assert rem_list[0]["channel"] == "PUSH"

    report_out = mod.enqueue_report_job(
        payload=mod.ReportEnqueue(family_id="fam-1", report_type="overview"),
        db=Db(),
        current_user=user,
    )
    assert report_out["family_id"] == "fam-1"


# ---------------------------------------------------------------------------
# families routes
# ---------------------------------------------------------------------------


def test_families_memberships_and_settings(monkeypatch):
    from app.api.v1 import families as mod
    from app.models.family import Family
    from app.models.family_member import FamilyMember

    member = SimpleNamespace(id="m1", user_id="u1", family_id="fam-1", deleted_at=None)
    db = Db({FamilyMember: [member]})
    assert mod.get_my_memberships(db=db, current_user=_user()) == [member]

    family = SimpleNamespace(
        id="fam-1",
        default_currency="BDT",
        timezone="Asia/Dhaka",
        deleted_at=None,
    )
    db2 = Db(got=family)
    monkeypatch.setattr(mod, "require_permission", lambda **k: None)

    updated = mod.update_family_currency(
        family_id="fam-1",
        payload=mod.FamilyCurrencyUpdate(default_currency=" usd "),
        db=db2,
        current_user=_user(),
        _role=None,
    )
    assert updated["new_currency"] == "USD"
    assert db2.commit_count == 1

    with pytest.raises(HTTPException) as missing:
        mod.update_family_currency(
            family_id="fam-1",
            payload=mod.FamilyCurrencyUpdate(default_currency="X"),
            db=Db(got=SimpleNamespace(id="fam-1", default_currency="BDT", deleted_at=None)),
            current_user=_user(),
            _role=None,
        )
    assert missing.value.status_code == 400

    with pytest.raises(HTTPException) as not_found:
        mod.update_family_currency(
            family_id="missing",
            payload=mod.FamilyCurrencyUpdate(default_currency="USD"),
            db=Db(got=None),
            current_user=_user(),
            _role=None,
        )
    assert not_found.value.status_code == 404

    with pytest.raises(HTTPException) as empty:
        mod.update_family_settings(
            family_id="fam-1",
            payload=mod.FamilySettingsUpdate(),
            db=Db(got=family),
            current_user=_user(),
        )
    assert empty.value.status_code == 400

    settings_out = mod.update_family_settings(
        family_id="fam-1",
        payload=mod.FamilySettingsUpdate(default_currency="eur", timezone=" UTC "),
        db=Db(got=SimpleNamespace(**family.__dict__)),
        current_user=_user(),
    )
    assert settings_out["new_currency"] == "EUR"
    assert settings_out["new_timezone"] == "UTC"


def test_families_list_uses_repository(monkeypatch):
    from app.api.v1 import families as mod

    fam = SimpleNamespace(id="f1", name="Home")
    monkeypatch.setattr(
        "app.repositories.family_repo",
        lambda db: SimpleNamespace(list_active_for_user=lambda uid: [fam] if uid == "u1" else []),
    )
    rows = mod.get_my_families(db=Db(), current_user=_user())
    assert rows == [fam]


# ---------------------------------------------------------------------------
# architecture_api_contract
# ---------------------------------------------------------------------------


def test_architecture_contract_join_role_and_accounts(monkeypatch):
    from app.api.v1 import architecture_api_contract as mod
    from app.models.account import Account
    from app.models.family_member import FamilyMember
    from app.models.relationship_type import RelationshipType

    with pytest.raises(HTTPException) as reject_empty:
        mod.architecture_reject_join(
            request_id="jr-1",
            payload=mod.RejectBody(reason="   "),
            db=Db(),
            current_user=_user(),
        )
    assert reject_empty.value.status_code == 422

    monkeypatch.setattr(
        "app.api.v1.join_requests.approve_or_reject_request",
        lambda **k: {"ok": True},
    )
    out = mod.architecture_reject_join(
        request_id="jr-1",
        payload=mod.RejectBody(reason="invalid code"),
        db=Db(),
        current_user=_user(),
    )
    assert out["ok"] is True

    target = SimpleNamespace(id="m2", family_id="fam-1", role="MEMBER", deleted_at=None)
    db_role = Db(got=target)
    monkeypatch.setattr(mod, "require_owner_or_admin", lambda *a, **k: None)
    role_out = mod.architecture_put_member_role(
        member_id="m2",
        role="admin",
        family_id="fam-1",
        db=db_role,
        current_user=_user(),
    )
    assert role_out["role"] == "ADMIN"
    assert db_role.commit_count == 1

    with pytest.raises(HTTPException) as owner_block:
        mod.architecture_put_member_role(
            member_id="m2",
            role="MEMBER",
            family_id="fam-1",
            db=Db(got=SimpleNamespace(id="m2", family_id="fam-1", role="OWNER", deleted_at=None)),
            current_user=_user(),
        )
    assert owner_block.value.status_code == 422

    rel = SimpleNamespace(
        id="rt-1",
        name_en="Father",
        name_bn="Baba",
        group_name="FAMILY",
        needs_serial=False,
        is_system=True,
        is_active=True,
        deleted_at=None,
    )
    inactive = SimpleNamespace(**{**rel.__dict__, "id": "rt-2", "is_active": False})
    db_rel = Db({RelationshipType: [rel, inactive]})
    types = mod.architecture_relationship_types(db=db_rel, current_user=_user())
    assert len(types) == 1
    assert types[0]["name_en"] == "Father"

    acct = SimpleNamespace(
        id="a1",
        family_id="fam-1",
        name="Cash",
        account_type="ASSET",
        currency="BDT",
        current_balance=Decimal("100"),
        is_system=False,
        deleted_at=None,
        is_active=True,
    )
    db_acct = Db({Account: [acct]})
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.services.accounting_service.calculate_account_balance",
        lambda db, aid, family_id=None: Decimal("150.0000"),
    )
    bal = mod.architecture_accounts_balance(family_id="fam-1", db=db_acct, current_user=_user())
    assert bal["family_id"] == "fam-1"
    assert bal["accounts"][0]["balance"] == "150.0000"


def test_architecture_contract_transaction_and_export_delegates(monkeypatch):
    from app.api.v1 import architecture_api_contract as mod

    monkeypatch.setattr("app.api.v1.transactions.create_income", lambda **k: {"type": "income"})
    monkeypatch.setattr("app.api.v1.transactions.create_expense", lambda **k: {"type": "expense"})
    monkeypatch.setattr("app.api.v1.transactions.create_transfer", lambda **k: {"type": "transfer"})
    monkeypatch.setattr("app.api.v1.accounting.create_transaction", lambda **k: {"type": "journal"})

    db = Db()
    user = _user()
    income_payload = {
        "transaction_type": "INCOME",
        "family_id": "fam-1",
        "account_id": "a1",
        "category_id": "c1",
        "amount": "10",
        "currency": "BDT",
    }
    assert mod.architecture_create_transaction(income_payload, db, user)["type"] == "income"
    expense_payload = {**income_payload, "transaction_type": "EXPENSE"}
    assert mod.architecture_create_transaction(expense_payload, db, user)["type"] == "expense"
    transfer_payload = {
        "transaction_type": "TRANSFER",
        "family_id": "fam-1",
        "from_account_id": "a1",
        "to_account_id": "a2",
        "amount": "10",
        "currency": "BDT",
    }
    assert mod.architecture_create_transaction(transfer_payload, db, user)["type"] == "transfer"
    journal_payload = {
        "transaction_type": "JOURNAL",
        "family_id": "fam-1",
        "amount": "10",
        "currency": "BDT",
        "lines": [
            {"account_id": "a1", "debit": "10", "credit": "0"},
            {"account_id": "a2", "debit": "0", "credit": "10"},
        ],
    }
    assert mod.architecture_create_transaction(journal_payload, db, user)["type"] == "journal"

    monkeypatch.setattr(
        "app.api.v1.jobs.create_export_job",
        lambda **k: {"job": {"id": "j1"}},
    )
    pdf = mod.architecture_export_pdf(
        payload=mod.ExportJobBody(family_id="fam-1"),
        db=db,
        current_user=user,
    )
    assert pdf["job"]["id"] == "j1"
    excel = mod.architecture_export_excel(
        payload=mod.ExportJobBody(family_id="fam-1", report_type="cashflow"),
        db=db,
        current_user=user,
    )
    assert excel["job"]["id"] == "j1"

    monkeypatch.setattr(
        "app.api.v1.loans.loan_payment",
        lambda **k: {"paid": True},
    )
    from app.schemas.loan import LoanPaymentRequest

    paid = mod.architecture_loan_pay(
        loan_id="loan-1",
        payload=LoanPaymentRequest(
            loan_id="ignored",
            family_id="fam-1",
            wallet_account_id="w1",
            amount=Decimal("10"),
        ),
        db=db,
        current_user=user,
    )
    assert paid["paid"] is True


# ---------------------------------------------------------------------------
# celery_tasks (email + reminders)
# ---------------------------------------------------------------------------


def test_celery_send_email_and_reminders(monkeypatch):
    from app.workers import celery_tasks as ct

    sent_result = SimpleNamespace(sent=True, reason=None)
    monkeypatch.setattr("app.services.email_service.send_email", lambda **k: sent_result)

    class SessionStub:
        def __init__(self):
            self.rows = []
            self.commits = 0

        def add(self, row):
            self.rows.append(row)
            row.id = "outbox-1"

        def commit(self):
            self.commits += 1

        def refresh(self, row):
            pass

        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", SessionStub)
    ok = ct.send_email_task("a@b.com", "Hi", "body", html_body="<p>body</p>")
    assert ok["ok"] is True
    assert ok["email_outbox_id"] == "outbox-1"

    fail_result = SimpleNamespace(sent=False, reason="smtp down")
    monkeypatch.setattr("app.services.email_service.send_email", lambda **k: fail_result)
    fail = ct.send_email_task("a@b.com", "Hi", "body")
    assert fail["ok"] is False

    def boom(**k):
        raise RuntimeError("mail crash")

    monkeypatch.setattr("app.services.email_service.send_email", boom)
    err = ct.send_email_task("a@b.com", "Hi", "body")
    assert err["ok"] is False
    assert "mail crash" in err["error"]

    due_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
    reminder = SimpleNamespace(
        family_id="fam-1",
        title="Pay rent",
        remind_at=due_at,
        status="SCHEDULED",
        deleted_at=None,
    )

    class ReminderDb:
        def __init__(self):
            self.added = []
            self.commits = 0

        def query(self, model):
            return Query(rows=[reminder])

        def add(self, row):
            self.added.append(row)

        def commit(self):
            self.commits += 1

        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", ReminderDb)
    rem_out = ct.process_scheduled_reminders_task()
    assert rem_out["ok"] is True
    assert rem_out["sent"] == 1


# ---------------------------------------------------------------------------
# main endpoints
# ---------------------------------------------------------------------------


def test_main_root_health_and_debug_routes(monkeypatch):
    from app import main as main_mod

    root = main_mod.root()
    assert root["message"] == "S4 FAMILY FINANCE API Running"
    assert "database" in root

    health = main_mod.health_check()
    assert health["status"] == "ok"
    assert health["layers"]["response_formatter"] is True
    assert "celery_tasks" in health["layers"]

    monkeypatch.setattr(main_mod.settings, "ENVIRONMENT", "development")
    ws = main_mod.debug_ws_routes()
    assert isinstance(ws, list)

    monkeypatch.setattr(main_mod.settings, "ENVIRONMENT", "production")
    with pytest.raises(HTTPException) as prod:
        main_mod.debug_ws_routes()
    assert prod.value.status_code == 404


# ---------------------------------------------------------------------------
# zakat summary/list + grocery schema
# ---------------------------------------------------------------------------


def _zakat_record(**overrides):
    base = dict(
        id="z1",
        family_id="fam-1",
        calculation_year=2024,
        currency="BDT",
        cash_amount=Decimal("100"),
        gold_value=Decimal("0"),
        silver_value=Decimal("0"),
        investment_value=Decimal("0"),
        business_assets=Decimal("0"),
        receivables=Decimal("0"),
        deductible_debts=Decimal("0"),
        nisab_amount=Decimal("50"),
        zakatable_amount=Decimal("100"),
        zakat_due=Decimal("10"),
        status="CALCULATED",
        note=None,
        created_at=datetime(2024, 6, 1, tzinfo=timezone.utc),
        deleted_at=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_zakat_summary_and_list_routes(monkeypatch):
    from app.api.v1 import zakat as mod
    from app.models.zakat import ZakatRecord

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    older = _zakat_record(id="z1", zakat_due=Decimal("10"), calculation_year=2024)
    newer = _zakat_record(
        id="z2",
        zakat_due=Decimal("20"),
        calculation_year=2025,
        created_at=datetime(2025, 6, 1, tzinfo=timezone.utc),
    )
    db = Db({ZakatRecord: [older, newer]})
    summary = mod.zakat_summary("fam-1", db, _user())
    assert summary["record_count"] == 2
    assert summary["total_zakat_due"] == "30.0000"
    assert summary["latest"]["id"] == "z2"

    listed = mod.list_zakat_records("fam-1", Db({ZakatRecord: [older, newer]}), _user())
    assert len(listed) == 2


def test_grocery_schema_resolved_name():
    from app.schemas.grocery import GroceryListCreateRequest, GroceryListUpdateRequest

    assert GroceryListCreateRequest(family_id="f", title=" Weekly ").resolved_name() == "Weekly"
    assert GroceryListUpdateRequest(family_id="f", name="List").resolved_name() == "List"
    with pytest.raises(ValueError, match="name/title required"):
        GroceryListCreateRequest(family_id="f").resolved_name()


# ---------------------------------------------------------------------------
# response_formatter (asyncio.run — Py3.14 safe)
# ---------------------------------------------------------------------------


def test_response_formatter_middleware_branches():
    from app.middleware.response_formatter import ResponseFormatterMiddleware

    fmt = ResponseFormatterMiddleware(MagicMock())
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/v1/data",
        "raw_path": b"/api/v1/data",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }

    async def json_dict(request):
        return JSONResponse({"value": 1})

    async def json_list(request):
        return JSONResponse([1, 2, 3])

    async def json_err_nested(request):
        return JSONResponse({"error": {"message": "bad", "code": "E1"}}, status_code=403)

    req = Request(scope)
    req.state.request_id = "req-5"
    wrapped = _run(fmt.dispatch(req, json_dict))
    body = json.loads(wrapped.body)
    assert body["success"] is True
    assert body["data"]["value"] == 1

    listed = _run(fmt.dispatch(req, json_list))
    meta = json.loads(listed.body)["meta"]
    assert meta["total"] == 3

    err = _run(fmt.dispatch(req, json_err_nested))
    err_body = json.loads(err.body)
    assert err_body["success"] is False
    assert err_body["error"]["code"] == "E1"

    docs_scope = {**scope, "path": "/docs", "raw_path": b"/docs"}
    docs_req = Request(docs_scope)
    passthrough = _run(fmt.dispatch(docs_req, json_dict))
    assert json.loads(passthrough.body) == {"value": 1}


# ---------------------------------------------------------------------------
# accounting_service alias + balance cache
# ---------------------------------------------------------------------------


def test_accounting_ensure_balanced_and_sync_cache(monkeypatch):
    from app.models.transaction_line import TransactionLine
    from app.services import accounting_service as acct

    line_a = TransactionLine(account_id="a1", debit=Decimal("5"), credit=Decimal("0"))
    line_b = TransactionLine(account_id="a2", debit=Decimal("0"), credit=Decimal("5"))
    acct.ensure_balanced([line_a, line_b])

    account = SimpleNamespace(id="a1", family_id="fam-1", current_balance=Decimal("0"))
    monkeypatch.setattr(acct, "calculate_account_balance", lambda db, aid, family_id=None: Decimal("42.0000"))
    bal = acct.sync_account_balance_cache(Db(), account)
    assert bal == Decimal("42.0000")
    assert account.current_balance == Decimal("42.0000")
