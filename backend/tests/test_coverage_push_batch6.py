"""Batch-6 coverage push: accounting API, architecture modules API, redis cache."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


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
    def __init__(self, query_map=None, got=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.added = []
        self.commit_count = 0
        self.refresh_count = 0
        self._bind = MagicMock()

    @property
    def bind(self):
        return self._bind

    def query(self, model):
        payload = self.query_map.get(model)
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


def _user(uid="u1"):
    return SimpleNamespace(id=uid, email="u@example.com")


def _member(mid="m1"):
    return SimpleNamespace(id=mid, family_id="fam-1", user_id="u1", role="OWNER")


# ---------------------------------------------------------------------------
# accounting API
# ---------------------------------------------------------------------------


def test_accounting_api_create_journal(monkeypatch):
    from app.api.v1 import accounting as mod

    member = _member()
    monkeypatch.setattr(mod, "require_permission", lambda **k: member)
    tx = SimpleNamespace(
        id="tx-1",
        status="POSTED",
        transaction_type="JOURNAL",
        amount=Decimal("100"),
        currency="BDT",
    )
    monkeypatch.setattr(mod.accounting_service, "validate_balance", lambda lines: (Decimal("100"), Decimal("100")))
    monkeypatch.setattr(mod.accounting_service, "create_transaction", lambda *a, **k: tx)

    db = Db()
    payload = mod.CreateJournalRequest(
        family_id="fam-1",
        amount="100",
        currency="bdt",
        lines=[
            mod.AccountingLineIn(account_id="a1", debit="100", credit="0"),
            mod.AccountingLineIn(account_id="a2", debit="0", credit="100"),
        ],
    )
    out = mod.create_transaction(payload=payload, db=db, current_user=_user())
    assert out["id"] == "tx-1"
    assert out["currency"] == "BDT"
    assert db.commit_count == 1


def test_accounting_api_reports_and_balance(monkeypatch):
    from app.api.v1 import accounting as mod

    monkeypatch.setattr(mod, "require_permission", lambda **k: None)
    monkeypatch.setattr(
        mod.accounting_service,
        "generate_trial_balance",
        lambda db, fid, currency=None: {"family_id": fid, "rows": []},
    )
    monkeypatch.setattr(
        mod.accounting_service,
        "generate_income_statement",
        lambda db, fid, currency=None: {"family_id": fid, "income": "0"},
    )
    monkeypatch.setattr(
        mod.accounting_service,
        "generate_cash_flow",
        lambda db, fid, currency=None: {"family_id": fid, "net": "0"},
    )
    monkeypatch.setattr(
        mod.accounting_service,
        "calculate_account_balance",
        lambda db, aid, family_id=None: Decimal("250.5000"),
    )

    db = Db()
    user = _user()
    assert mod.trial_balance("fam-1", None, db, user)["family_id"] == "fam-1"
    assert mod.income_statement("fam-1", "USD", db, user)["income"] == "0"
    assert mod.cash_flow("fam-1", None, db, user)["net"] == "0"
    bal = mod.account_balance("fam-1", "a1", db, user)
    assert bal["balance"] == "250.5000"


def test_accounting_api_rollback_and_repair(monkeypatch):
    from app.api.v1 import accounting as mod

    member = _member()
    monkeypatch.setattr(mod, "require_permission", lambda **k: member)
    monkeypatch.setattr(
        mod.accounting_service,
        "rollback_transaction",
        lambda *a, **k: {"rollback_id": "rb-1", "status": "VOID"},
    )

    db = Db()
    payload = mod.RollbackRequest(family_id="fam-1", reason="duplicate")
    out = mod.rollback_transaction("tx-1", payload=payload, db=db, current_user=_user())
    assert out["rollback_id"] == "rb-1"
    assert db.commit_count == 1

    def boom(**k):
        raise ValueError("cannot rollback")

    monkeypatch.setattr(mod.accounting_service, "rollback_transaction", boom)
    with pytest.raises(HTTPException) as bad:
        mod.rollback_transaction("tx-2", payload=payload, db=db, current_user=_user())
    assert bad.value.status_code == 400

    acct = SimpleNamespace(id="coa-1")
    monkeypatch.setattr(
        "app.services.chart_of_accounts.ensure_family_chart",
        lambda *a, **k: {"opening_equity": acct},
    )
    monkeypatch.setattr(
        mod.accounting_service,
        "repair_legacy_null_account_lines",
        lambda *a, **k: {"repaired": 2},
    )
    repair = mod.repair_legacy_lines("fam-1", db=Db(), current_user=_user())
    assert repair["chart_accounts"]["opening_equity"] == "coa-1"
    assert repair["legacy_repair"]["repaired"] == 2
    assert repair["complete"] is True


# ---------------------------------------------------------------------------
# architecture_modules_api helpers + life modules
# ---------------------------------------------------------------------------


def test_architecture_modules_money_and_date_parse():
    from app.api.v1 import architecture_modules_api as mod

    assert mod.money(Decimal("1.23456")) == "1.2346"
    assert mod.money(None) == "0.0000"
    assert mod._parse_module_date("2026-08-12") == date(2026, 8, 12)
    assert mod._parse_module_date("bad-date") is None
    assert mod._parse_module_date(None) is None


def test_architecture_modules_life_summary_and_upcoming(monkeypatch):
    from app.api.v1 import architecture_modules_api as mod
    from app.models.architecture_modules import (
        Document,
        EducationFund,
        HealthExpense,
        Investment,
        Property,
        Subscription,
        VehicleExpense,
    )

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    today = mod._now().date()

    inv = SimpleNamespace(
        id="i1",
        family_id="fam-1",
        status="ACTIVE",
        principal=Decimal("1000"),
        deleted_at=None,
    )
    sub_monthly = SimpleNamespace(
        id="s1",
        family_id="fam-1",
        status="ACTIVE",
        amount=Decimal("120"),
        cycle="MONTHLY",
        deleted_at=None,
    )
    sub_yearly = SimpleNamespace(
        id="s2",
        family_id="fam-1",
        status="ACTIVE",
        amount=Decimal("1200"),
        cycle="YEARLY",
        deleted_at=None,
    )
    health = SimpleNamespace(
        id="h1",
        family_id="fam-1",
        status="ACTIVE",
        amount=Decimal("50"),
        expense_date=(today + __import__("datetime").timedelta(days=5)).isoformat(),
        name="Checkup",
        currency="BDT",
        deleted_at=None,
    )
    doc = SimpleNamespace(
        id="d1",
        family_id="fam-1",
        status="ACTIVE",
        expiry_date=(today + __import__("datetime").timedelta(days=3)).isoformat(),
        name="Passport",
        deleted_at=None,
    )

    db = Db(
        {
            Investment: [inv],
            HealthExpense: [health],
            VehicleExpense: [],
            EducationFund: [],
            Subscription: [sub_monthly, sub_yearly],
            Document: [doc],
            Property: [],
        }
    )
    summary = mod.life_modules_summary("fam-1", db, _user())
    assert summary["modules"]["INVESTMENT"]["active"] == 1
    assert summary["modules"]["INVESTMENT"]["total_amount"] == "1000.0000"
    sub_mod = summary["modules"]["SUBSCRIPTION"]
    assert sub_mod["monthly_cost_total"] == "220.0000"  # 120 + 1200/12

    db_upcoming = Db(
        {
            Investment: [],
            HealthExpense: [health],
            VehicleExpense: [],
            EducationFund: [],
            Subscription: [],
            Document: [doc],
            Property: [],
        }
    )
    upcoming = mod.life_modules_upcoming("fam-1", days=30, db=db_upcoming, user=_user())
    assert len(upcoming["items"]) >= 2
    assert upcoming["items"] == sorted(upcoming["items"], key=lambda r: r["due_date"])


def test_architecture_modules_investment_routes(monkeypatch):
    from app.api.v1 import architecture_modules_api as mod
    from app.models.architecture_modules import Investment, InvestmentReturn

    member = _member()
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: member)
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)

    db = Db()
    payload = mod.InvestmentIn(
        family_id="fam-1",
        name=" Gold FD ",
        type="fd",
        principal=Decimal("5000"),
        rate=Decimal("8.5"),
        start_date="2026-01-01",
        maturity="2028-01-01",
        currency="usd",
    )
    created = mod.create_investment(payload=payload, db=db, user=_user())
    assert created["name"] == "Gold FD"
    assert db.commit_count == 1

    inv = SimpleNamespace(
        id="inv-1",
        family_id="fam-1",
        name="Gold FD",
        type="FD",
        principal=Decimal("5000"),
        rate=Decimal("8.5"),
        start_date="2026-01-01",
        maturity="2028-01-01",
        currency="USD",
        status="ACTIVE",
        note=None,
        member_id=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        deleted_at=None,
    )
    db2 = Db({Investment: [inv]})
    listed = mod.list_investments("fam-1", db2, _user())
    assert listed[0]["module_type"] == "INVESTMENT"
    assert listed[0]["principal"] == "5000.0000"

    ret_row = SimpleNamespace(
        id="ret-1",
        amount=Decimal("100"),
        return_date="2026-06-01",
        notes="dividend",
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        deleted_at=None,
    )
    db3 = Db({Investment: inv, InvestmentReturn: [ret_row]})
    calc = mod.investment_return_calculator("inv-1", "fam-1", db3, _user())
    assert calc["realized_returns"] == "100.0000"
    assert calc["expected_interest"] != "0.0000"

    portfolio = mod.investment_portfolio_summary("fam-1", db3, _user())
    assert portfolio["active_count"] == 1
    assert portfolio["total_principal"] == "5000.0000"

    db4 = Db({Investment: inv})
    ret_payload = mod.InvestmentReturnIn(
        family_id="fam-1",
        amount=Decimal("50"),
        return_date="2026-07-01",
    )
    added = mod.add_investment_return("inv-1", payload=ret_payload, db=db4, user=_user())
    assert added["amount"] == "50.0000"
    assert db4.commit_count == 1

    with pytest.raises(HTTPException) as missing:
        mod.add_investment_return(
            "missing",
            payload=ret_payload,
            db=Db({Investment: None}),
            user=_user(),
        )
    assert missing.value.status_code == 404


def test_architecture_modules_subscription_presets_and_status(monkeypatch):
    from app.api.v1 import architecture_modules_api as mod
    from app.models.architecture_modules import Subscription

    member = _member()
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: member)
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.services.document_vault_service.object_storage_status",
        lambda: {"backend": "local", "s3_configured": False, "local_root": "/vault"},
    )
    monkeypatch.setattr(
        "app.services.architecture_readiness_service.architecture_readiness",
        lambda: {"architecture_feature_completeness_pct": 100, "modules": []},
    )

    presets = mod.subscription_brand_presets(user=_user())
    assert any(p["key"] == "NETFLIX" for p in presets["presets"])

    db = Db()
    sub_payload = mod.SubscriptionIn(
        family_id="fam-1",
        name="STREAMING",
        amount=Decimal("0"),
        brand_preset="netflix",
        currency="bdt",
    )
    created = mod.create_subscription(payload=sub_payload, db=db, user=_user())
    assert created["name"] == "Netflix"
    assert db.added[-1].amount == Decimal("1100")
    assert db.added[-1].currency == "BDT"

    sub_row = SimpleNamespace(
        id="sub-1",
        family_id="fam-1",
        name="Netflix",
        amount=Decimal("1100"),
        cycle="MONTHLY",
        next_due=None,
        status="ACTIVE",
        auto_remind=True,
        currency="BDT",
        notes="preset:NETFLIX",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        deleted_at=None,
    )
    listed = mod.list_subscriptions("fam-1", Db({Subscription: [sub_row]}), _user())
    assert listed[0]["module_type"] == "SUBSCRIPTION"

    vault = mod.document_vault_status(user=_user())
    assert vault["encrypted_at_rest"] is True
    assert vault["architecture_status"] == "DONE"

    readiness = mod.system_architecture_readiness(user=_user())
    assert readiness["architecture_feature_completeness_pct"] == 100


def test_architecture_modules_health_vehicle_property_document(monkeypatch):
    from app.api.v1 import architecture_modules_api as mod
    from app.models.architecture_modules import Document, HealthExpense, Property, VehicleExpense

    member = _member()
    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: member)
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)

    db = Db()
    health = mod.create_health(
        payload=mod.HealthIn(
            family_id="fam-1",
            type="checkup",
            doctor="Dr. Khan",
            amount=Decimal("800"),
            expense_date="2026-08-01",
            currency="bdt",
        ),
        db=db,
        user=_user(),
    )
    assert health["amount"] == "800.0000"
    assert db.added[-1].year == "2026"

    db2 = Db()
    vehicle = mod.create_vehicle(
        payload=mod.VehicleIn(
            family_id="fam-1",
            vehicle_name=" Corolla ",
            amount=Decimal("1500"),
            km_reading=Decimal("42000"),
            expense_date="2026-08-05",
        ),
        db=db2,
        user=_user(),
    )
    assert vehicle["vehicle_name"] == "Corolla"

    db3 = Db()
    prop = mod.create_property(
        payload=mod.PropertyIn(
            family_id="fam-1",
            name=" Flat A ",
            value=Decimal("5000000"),
            rent_income=Decimal("15000"),
            currency="bdt",
        ),
        db=db3,
        user=_user(),
    )
    assert prop["name"] == "Flat A"

    doc_row = SimpleNamespace(
        id="doc-1",
        family_id="fam-1",
        name="NID",
        type="ID",
        file_url="/vault/nid",
        expiry_date="2027-01-01",
        encrypted=True,
        member_id=None,
        status="ACTIVE",
        notes=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        deleted_at=None,
    )
    listed_docs = mod.list_documents("fam-1", Db({Document: [doc_row]}), _user())
    assert listed_docs[0]["module_type"] == "DOCUMENT"
    assert listed_docs[0]["encrypted"] is True

    health_row = SimpleNamespace(
        id="h1",
        family_id="fam-1",
        module_type="HEALTH",
        type="CHECKUP",
        doctor="Dr. Khan",
        amount=Decimal("800"),
        expense_date="2026-08-01",
        year="2026",
        currency="BDT",
        status="ACTIVE",
        member_id=None,
        notes=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        deleted_at=None,
    )
    assert mod.list_health("fam-1", Db({HealthExpense: [health_row]}), _user())[0]["amount"] == "800.0000"
    assert mod.list_vehicle("fam-1", Db({VehicleExpense: []}), _user()) == []
    assert mod.list_properties("fam-1", Db({Property: []}), _user()) == []


# ---------------------------------------------------------------------------
# redis_cache (memory backend)
# ---------------------------------------------------------------------------


def test_redis_cache_memory_backend(monkeypatch):
    from app.services import redis_cache as rc

    monkeypatch.setattr(rc.settings, "REDIS_URL", "")
    rc._client = None
    rc._memory.clear()

    assert rc.cache_status()["backend"] == "memory"
    rc.cache_set("k1", {"value": 42}, ttl_seconds=60)
    assert rc.cache_get("k1") == {"value": 42}
    rc.cache_delete("k1")
    assert rc.cache_get("k1") is None

    rc.cache_set("k2", "plain-text", ttl_seconds=1)
    assert rc.cache_get("k2") == "plain-text"

    rc._memory["bad"] = (9999999999.0, "not-json")
    assert rc.cache_get("bad") is None


def test_redis_cache_connected_path(monkeypatch):
    from app.services import redis_cache as rc

    store = {}

    class FakeRedis:
        def ping(self):
            return True

        def get(self, key):
            return store.get(key)

        def setex(self, key, ttl, raw):
            store[key] = raw

        def delete(self, key):
            store.pop(key, None)

    fake_redis_mod = SimpleNamespace(Redis=SimpleNamespace(from_url=lambda *a, **k: FakeRedis()))
    monkeypatch.setitem(__import__("sys").modules, "redis", fake_redis_mod)
    monkeypatch.setattr(rc.settings, "REDIS_URL", "redis://localhost:6379/0")
    rc._client = None
    status = rc.cache_status()
    assert status["backend"] == "redis"
    rc.cache_set("rk", {"ok": True}, ttl_seconds=30)
    assert rc.cache_get("rk") == {"ok": True}
    rc.cache_delete("rk")
    assert rc.cache_get("rk") is None
