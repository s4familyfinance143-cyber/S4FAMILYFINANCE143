"""Batch-16 coverage push: missing_features_api, phase16, currency,
architecture_system_api, offline_sync_hardened, sync_apply, auth, main — mock-only."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response


# ---------------------------------------------------------------------------
# Shared Query / Db helpers (batch2 / batch13 pattern)
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

    def offset(self, *args, **kwargs):
        return self

    def group_by(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first

    def count(self):
        return len(self.rows)

    def scalar(self):
        row = self._first
        if isinstance(row, tuple):
            return row[0] if len(row) == 1 else row
        return row


class Db:
    def __init__(self, query_map=None, got=None, execute_results=None):
        self.query_map = dict(query_map or {})
        self._persistent = dict(query_map or {})
        self.got = got
        self.execute_results = list(execute_results or [])
        self.executed = []
        self.added = []
        self.deleted = []
        self.commit_count = 0
        self.flush_count = 0
        self.refresh_count = 0
        self.rollback_count = 0
        self._bind = MagicMock()

    @property
    def bind(self):
        return self._bind

    def query(self, model, *args):
        key = model if not args else (model, args)
        payload = self._persistent.get(key)
        if payload is None:
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

    def execute(self, stmt, params=None):
        self.executed.append((stmt, params))
        if self.execute_results:
            return self.execute_results.pop(0)
        result = MagicMock()
        result.mappings.return_value.first.return_value = None
        result.mappings.return_value.all.return_value = []
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        result.first.return_value = None
        return result

    def add(self, row):
        self.added.append(row)

    def delete(self, row):
        self.deleted.append(row)

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

    def rollback(self):
        self.rollback_count += 1


def _unwrap(fn):
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


def _run(coro):
    return asyncio.run(coro)


def _user(uid="u1"):
    return SimpleNamespace(
        id=uid,
        email="u@example.com",
        full_name="Test User",
        phone=None,
        preferred_language="bn",
        is_active=True,
        is_email_verified=True,
        password_hash="hashed",
    )


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


def _mapping_first_result(row):
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    return result


def _rows_result(rows):
    result = MagicMock()
    mapped = []
    for row in rows:
        item = MagicMock()
        item._mapping = row
        mapped.append(item)
    result.fetchall.return_value = mapped
    return result


def _p16_item(**overrides):
    soon = (date.today() + timedelta(days=5)).isoformat()
    base = dict(
        id="p1",
        family_id="fam-1",
        module_type="SUBSCRIPTION",
        name="Netflix",
        category="GENERAL",
        sub_type=None,
        provider="NF",
        member_id=None,
        amount=Decimal("120"),
        secondary_amount=None,
        currency="BDT",
        renewal_or_expiry_date=soon,
        secondary_date=None,
        billing_cycle="YEARLY",
        payment_account_id=None,
        reference=None,
        status="ACTIVE",
        note=None,
        created_at=None,
        file_name=None,
        file_mime=None,
        file_size=None,
        file_sha256=None,
        file_encrypted=False,
        file_path=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# ===========================================================================
# missing_features_api.py
# ===========================================================================


def test_mf_create_split_invalid_member(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.family_member import FamilyMember

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    payload = mod.SplitExpenseIn(
        family_id="fam-1",
        account_id="a1",
        category_id="c1",
        amount=Decimal("100"),
        splits=[mod.SplitShareIn(member_id="ghost", share_amount=Decimal("100"))],
    )
    with pytest.raises(HTTPException) as exc:
        mod.create_split_expense(
            payload,
            db=Db(query_map={FamilyMember: Query(first_row=None)}),
            current_user=_user(),
        )
    assert exc.value.status_code == 400
    assert "Invalid member_id" in str(exc.value.detail)


def test_mf_create_split_needs_amount_or_percent(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.family_member import FamilyMember

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    payload = mod.SplitExpenseIn(
        family_id="fam-1",
        account_id="a1",
        category_id="c1",
        amount=Decimal("50"),
        splits=[mod.SplitShareIn(member_id="m1")],
    )
    with pytest.raises(HTTPException) as exc:
        mod.create_split_expense(
            payload,
            db=Db(query_map={FamilyMember: Query(first_row=_member())}),
            current_user=_user(),
        )
    assert "share_amount or share_percent" in str(exc.value.detail)


def test_mf_create_split_success_with_percent(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.family_member import FamilyMember

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "write_audit_log", lambda **k: None)
    tx = SimpleNamespace(id="tx-1", amount=Decimal("100"), is_split=False)
    monkeypatch.setattr(mod, "post_expense_flush", lambda *a, **k: tx)
    payload = mod.SplitExpenseIn(
        family_id="fam-1",
        account_id="a1",
        category_id="c1",
        amount=Decimal("100"),
        splits=[
            mod.SplitShareIn(member_id="m1", share_percent=Decimal("60")),
            mod.SplitShareIn(member_id="m2", share_percent=Decimal("40")),
        ],
    )
    db = Db(query_map={FamilyMember: Query(first_row=_member())})
    out = mod.create_split_expense(payload, db=db, current_user=_user())
    assert out["is_split"] is True
    assert out["transaction_id"] == "tx-1"
    assert len(out["splits"]) == 2
    assert tx.is_split is True
    assert db.commit_count == 1


def test_mf_get_expense_splits_ok(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.missing_features import ExpenseSplit
    from app.models.transaction import Transaction

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    tx = SimpleNamespace(id="tx-1", is_split=True, deleted_at=None)
    split = SimpleNamespace(
        id="s1", member_id="m1", share_amount=Decimal("40"), share_percent=Decimal("40"), is_paid=True
    )
    db = Db(query_map={Transaction: Query(first_row=tx), ExpenseSplit: [split]})
    out = mod.get_expense_splits("tx-1", "fam-1", db=db, current_user=_user())
    assert out["is_split"] is True
    assert out["splits"][0]["share_amount"] == "40.0000"


def test_mf_upsert_metal_rate_forbidden_and_owner(monkeypatch):
    from app.api.v1 import missing_features_api as mod

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member(role="MEMBER"))
    payload = mod.MetalRateIn(metal="GOLD", rate_bdt=Decimal("8000"))
    with pytest.raises(HTTPException) as exc:
        mod.upsert_metal_rate(payload, "fam-1", db=Db(), current_user=_user())
    assert exc.value.status_code == 403

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member(role="OWNER"))
    monkeypatch.setattr(mod, "write_audit_log", lambda **k: None)
    db = Db()
    out = mod.upsert_metal_rate(payload, "fam-1", db=db, current_user=_user())
    assert out["metal"] == "GOLD"
    assert out["rate_bdt"] == "8000.0000"
    assert db.commit_count == 1


def test_mf_create_vehicle_master(monkeypatch):
    from app.api.v1 import missing_features_api as mod

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    payload = mod.VehicleIn(family_id="fam-1", name="  Family Car  ", vehicle_type="van", current_km=Decimal("10"))
    db = Db()
    out = mod.create_vehicle_master(payload, db=db, user=_user())
    assert out["name"] == "Family Car"
    assert db.added[0].vehicle_type == "VAN"
    assert db.added[0].status == "ACTIVE"


def test_mf_vehicle_cost_per_km_no_expenses(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.architecture_modules import VehicleExpense
    from app.models.missing_features import Vehicle

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    db = Db(query_map={Vehicle: Query(first_row=None), VehicleExpense: Query(rows=[])})
    with pytest.raises(HTTPException) as exc:
        mod.vehicle_cost_per_km("v-missing", "fam-1", db=db, user=_user())
    assert exc.value.status_code == 404


def test_mf_vehicle_cost_per_km_with_span(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.architecture_modules import VehicleExpense
    from app.models.missing_features import Vehicle

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    vehicle = SimpleNamespace(id="v1", name="Car", current_km=Decimal("200"), deleted_at=None)
    rows = [
        SimpleNamespace(amount=Decimal("100"), km_reading=Decimal("100"), currency="BDT", vehicle_name="Car"),
        SimpleNamespace(amount=Decimal("50"), km_reading=Decimal("200"), currency="BDT", vehicle_name="Car"),
    ]
    db = Db(query_map={Vehicle: Query(first_row=vehicle), VehicleExpense: Query(rows=rows)})
    out = mod.vehicle_cost_per_km("v1", "fam-1", db=db, user=_user())
    assert out["expense_count"] == 2
    assert out["cost_per_km"] == "1.5000"
    assert out["vehicle_name"] == "Car"


def test_mf_vehicle_expenses_by_name_and_empty(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.architecture_modules import VehicleExpense

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        mod.vehicle_expenses_cost_per_km_by_name(
            "fam-1", "Ghost", db=Db(query_map={VehicleExpense: Query(rows=[])}), user=_user()
        )
    assert exc.value.status_code == 404

    rows = [
        SimpleNamespace(amount=Decimal("80"), km_reading=Decimal("10"), currency="BDT"),
        SimpleNamespace(amount=Decimal("20"), km_reading=Decimal("30"), currency="BDT"),
    ]
    out = mod.vehicle_expenses_cost_per_km_by_name(
        "fam-1", "Car", db=Db(query_map={VehicleExpense: Query(rows=rows)}), user=_user()
    )
    assert out["expense_count"] == 2
    assert out["cost_per_km"] == "5.0000"


def test_mf_health_budgets_list_and_create(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.architecture_modules import HealthExpense
    from app.models.missing_features import HealthAnnualBudget

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    budget = SimpleNamespace(
        id="hb1",
        family_id="fam-1",
        member_id=None,
        year="2026",
        budget_amount=Decimal("1000"),
        spent_amount=Decimal("250"),
        currency="BDT",
        notes=None,
        deleted_at=None,
    )
    listed = mod.list_health_budgets(
        "fam-1", year="2026", db=Db(query_map={HealthAnnualBudget: [budget]}), user=_user()
    )
    assert listed[0]["remaining_amount"] == "750.0000"

    expense = SimpleNamespace(year="2026", expense_date="2026-03-01", member_id=None, amount=Decimal("100"), status="ACTIVE")
    created = mod.create_health_budget(
        mod.HealthBudgetIn(family_id="fam-1", year="2026", budget_amount=Decimal("500")),
        db=Db(query_map={HealthExpense: [expense]}),
        user=_user(),
    )
    assert created["year"] == "2026"
    assert created["spent_amount"] == "100.0000"
    assert created["remaining_amount"] == "400.0000"


def test_mf_property_repairs_mismatch_missing_and_create(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.architecture_modules import Property
    from app.models.missing_features import PropertyRepair

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    payload = mod.PropertyRepairIn(family_id="fam-1", property_id="p1", title="Roof", amount=Decimal("200"))
    with pytest.raises(HTTPException) as exc:
        mod.create_property_repair("other", payload, db=Db(), user=_user())
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        mod.create_property_repair(
            "p1", payload, db=Db(query_map={Property: Query(first_row=None)}), user=_user()
        )
    assert exc2.value.status_code == 404

    prop = SimpleNamespace(id="p1", family_id="fam-1", repair_cost=Decimal("10"), deleted_at=None)
    db = Db(query_map={Property: Query(first_row=prop)})
    out = mod.create_property_repair("p1", payload, db=db, user=_user())
    assert out["title"] == "Roof"
    assert out["property_repair_cost_total"] == "210.0000"

    listed = mod.list_property_repairs(
        "p1",
        "fam-1",
        db=Db(
            query_map={
                PropertyRepair: [
                    SimpleNamespace(
                        id="r1", title="Roof", amount=Decimal("200"), repair_date="2026-01-01", currency="BDT", notes=None
                    )
                ]
            }
        ),
        user=_user(),
    )
    assert listed[0]["title"] == "Roof"


def test_mf_expense_ocr_parse_paths(monkeypatch):
    from app.api.v1 import missing_features_api as mod

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        mod.expense_ocr_parse(mod.ExpenseOcrTextIn(raw_text="  "), "fam-1", db=Db(), current_user=_user())
    assert exc.value.status_code == 422

    monkeypatch.setattr(
        "app.services.ocr_service.expense_bill_ocr_parse",
        lambda **kw: {"items": [{"name": "Rice"}], "raw": kw.get("raw_text")},
    )
    out = mod.expense_ocr_parse(
        mod.ExpenseOcrTextIn(raw_text="Rice 2kg"), "fam-1", db=Db(), current_user=_user()
    )
    assert out["items"][0]["name"] == "Rice"


def test_mf_upload_transaction_attachment(monkeypatch):
    from app.api.v1 import missing_features_api as mod
    from app.models.transaction import Transaction

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "write_audit_log", lambda **k: None)
    monkeypatch.setattr(
        mod,
        "store_document_file",
        lambda **k: {"file_path": "/vault/a.bin", "file_name": "bill.jpg", "file_mime": "image/jpeg"},
    )
    with pytest.raises(HTTPException) as exc:
        _run(
            mod.upload_transaction_attachment(
                "missing",
                family_id="fam-1",
                file=SimpleNamespace(filename="x", content_type="image/jpeg", read=AsyncMock(return_value=b"abc")),
                db=Db(query_map={Transaction: Query(first_row=None)}),
                current_user=_user(),
            )
        )
    assert exc.value.status_code == 404

    tx = SimpleNamespace(id="tx-1", attachment_url=None, attachment_name=None, attachment_mime=None, deleted_at=None)
    out = _run(
        mod.upload_transaction_attachment(
            "tx-1",
            family_id="fam-1",
            file=SimpleNamespace(filename="bill.jpg", content_type="image/jpeg", read=AsyncMock(return_value=b"abc")),
            db=Db(query_map={Transaction: Query(first_row=tx)}),
            current_user=_user(),
        )
    )
    assert out["attachment_name"] == "bill.jpg"
    assert tx.attachment_url == "/vault/a.bin"


# ===========================================================================
# phase16.py
# ===========================================================================


def test_p16_parse_date_clean_text_and_due_soon():
    from app.api.v1 import phase16 as p16

    assert p16.clean_text("  ") is None
    assert p16.clean_text(None, "GENERAL") == "GENERAL"
    assert p16.clean_currency(None) == "BDT"
    assert p16.parse_date(None) is None
    assert p16.parse_date("bad") is None
    assert p16.parse_date("2026-08-12") == date(2026, 8, 12)
    soon = (date.today() + timedelta(days=3)).isoformat()
    assert p16.is_due_soon(soon) is True
    assert p16.is_due_soon("1999-01-01") is False


def test_p16_get_item_not_found():
    from app.api.v1 import phase16 as p16
    from app.models.phase16 import Phase16Item

    with pytest.raises(HTTPException) as exc:
        p16.get_item(Db(query_map={Phase16Item: Query(first_row=None)}), "fam-1", "missing")
    assert exc.value.status_code == 404


def test_p16_create_item_and_summary(monkeypatch):
    from app.api.v1 import phase16 as p16
    from app.models.phase16 import Phase16Item
    from app.schemas.phase16 import Phase16ItemCreateRequest

    monkeypatch.setattr(p16, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(p16, "write_audit_log", lambda **k: None)
    payload = Phase16ItemCreateRequest(
        family_id="fam-1",
        module_type="SUBSCRIPTION",
        name="Netflix",
        amount=Decimal("120"),
        billing_cycle="YEARLY",
        renewal_or_expiry_date="2026-12-01",
    )
    created = p16.create_phase16_item(payload, db=Db(), current_user=_user())
    assert created["name"] == "Netflix"
    assert created["module_type"] == "SUBSCRIPTION"

    item = _p16_item()
    summary = p16.phase16_summary(
        "fam-1", db=Db(query_map={Phase16Item: [item]}), current_user=_user()
    )
    assert summary["total_items"] == 1
    assert "SUBSCRIPTION" in summary["modules"]
    assert summary["upcoming"]


def test_p16_upcoming_list_and_vault(monkeypatch):
    from app.api.v1 import phase16 as p16
    from app.models.phase16 import Phase16Item

    monkeypatch.setattr(p16, "require_permission", lambda *a, **k: None)
    monkeypatch.setattr(p16, "object_storage_status", lambda: {"backend": "local"})
    monkeypatch.setattr(p16, "ensure_s3_bucket", lambda: {"ok": True})
    item = _p16_item()
    upcoming = p16.phase16_upcoming("fam-1", db=Db(query_map={Phase16Item: [item]}), current_user=_user())
    assert upcoming["items"][0]["name"] == "Netflix"

    listed = p16.list_phase16_items(
        "fam-1", module_type="subscription", db=Db(query_map={Phase16Item: [item]}), current_user=_user()
    )
    assert listed[0]["id"] == "p1"
    assert p16.phase16_vault_status(_user())["backend"] == "local"
    assert p16.phase16_vault_ensure_bucket(_user())["ok"] is True


def test_p16_update_and_close(monkeypatch):
    from app.api.v1 import phase16 as p16
    from app.schemas.phase16 import Phase16ItemCloseRequest, Phase16ItemUpdateRequest

    monkeypatch.setattr(p16, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(p16, "write_audit_log", lambda **k: None)
    item = _p16_item()
    monkeypatch.setattr(p16, "get_item", lambda db, fid, iid: item)
    updated = p16.update_phase16_item(
        "p1",
        Phase16ItemUpdateRequest(
            family_id="fam-1",
            name="Disney+",
            amount=Decimal("99"),
            billing_cycle="MONTHLY",
            renewal_or_expiry_date="2026-09-01",
        ),
        db=Db(),
        current_user=_user(),
    )
    assert updated["name"] == "Disney+"
    closed = p16.close_phase16_item(
        "p1",
        Phase16ItemCloseRequest(family_id="fam-1", reason="done"),
        db=Db(),
        current_user=_user(),
    )
    assert closed["status"] == "CLOSED"
    assert item.status == "CLOSED"


def test_p16_upload_rejects_non_document(monkeypatch):
    from app.api.v1 import phase16 as p16

    monkeypatch.setattr(p16, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(p16, "get_item", lambda db, fid, iid: _p16_item(module_type="SUBSCRIPTION"))
    with pytest.raises(HTTPException) as exc:
        _run(
            p16.upload_phase16_document(
                "p1",
                family_id="fam-1",
                file=SimpleNamespace(filename="x.pdf", content_type="application/pdf", read=AsyncMock(return_value=b"x")),
                db=Db(),
                current_user=_user(),
            )
        )
    assert exc.value.status_code == 400


def test_p16_upload_and_download_document(monkeypatch):
    from app.api.v1 import phase16 as p16

    monkeypatch.setattr(p16, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(p16, "write_audit_log", lambda **k: None)
    item = _p16_item(module_type="DOCUMENT", file_path=None, file_name=None)
    monkeypatch.setattr(p16, "get_item", lambda db, fid, iid: item)
    monkeypatch.setattr(
        p16,
        "store_document_file",
        lambda **k: {
            "file_name": "pass.pdf",
            "file_path": "/vault/pass.pdf",
            "file_mime": "application/pdf",
            "file_size": 12,
            "file_sha256": "abc",
            "file_encrypted": False,
        },
    )
    out = _run(
        p16.upload_phase16_document(
            "p1",
            family_id="fam-1",
            file=SimpleNamespace(filename="pass.pdf", content_type="application/pdf", read=AsyncMock(return_value=b"pdf")),
            db=Db(),
            current_user=_user(),
        )
    )
    assert out["has_file"] is True
    assert item.file_name == "pass.pdf"

    monkeypatch.setattr(p16, "load_document_file", lambda *a, **k: b"pdf-bytes")
    resp = p16.download_phase16_document("p1", "fam-1", db=Db(), current_user=_user())
    assert resp.body == b"pdf-bytes"

    item.file_path = None
    with pytest.raises(HTTPException) as exc:
        p16.download_phase16_document("p1", "fam-1", db=Db(), current_user=_user())
    assert exc.value.status_code == 404


# ===========================================================================
# currency.py
# ===========================================================================


def test_cur_list_and_create_currency(monkeypatch):
    from app.api.v1 import currency as cur
    from app.models.currency import Currency
    from app.schemas.currency import CurrencyCreate

    member = _member()
    monkeypatch.setattr(cur, "get_any_active_member", lambda **k: member)
    monkeypatch.setattr(cur, "require_any_permission", lambda **k: member)
    row = SimpleNamespace(id="c1", code="EUR", name="Euro", symbol="€", decimal_places=2, is_active=True)
    listed = cur.list_currencies(db=Db(query_map={Currency: [row]}), current_user=_user())
    assert listed[0]["code"] == "EUR"

    db = Db(query_map={Currency: Query(first_row=None)})
    created = cur.create_currency(
        CurrencyCreate(code="eur", name="Euro", symbol="€"), db=db, current_user=_user()
    )
    assert created["code"] == "EUR"
    assert db.added[0].is_active is True


def test_cur_create_currency_duplicate(monkeypatch):
    from app.api.v1 import currency as cur
    from app.models.currency import Currency
    from app.schemas.currency import CurrencyCreate

    monkeypatch.setattr(cur, "require_any_permission", lambda **k: _member())
    with pytest.raises(HTTPException) as exc:
        cur.create_currency(
            CurrencyCreate(code="USD", name="US Dollar"),
            db=Db(query_map={Currency: Query(first_row=SimpleNamespace(code="USD"))}),
            current_user=_user(),
        )
    assert exc.value.status_code == 400


def test_cur_exchange_rate_same_currency_rejected(monkeypatch):
    from app.api.v1 import currency as cur
    from app.schemas.currency import ExchangeRateCreate

    monkeypatch.setattr(cur, "require_any_permission", lambda **k: _member())
    with pytest.raises(HTTPException) as exc:
        cur.create_exchange_rate(
            ExchangeRateCreate(from_currency="USD", to_currency="usd", rate=Decimal("1"), rate_date=date(2026, 1, 1)),
            db=Db(),
            current_user=_user(),
        )
    assert "cannot be same" in str(exc.value.detail)


def test_cur_exchange_rate_create_and_update(monkeypatch):
    from app.api.v1 import currency as cur
    from app.models.currency import ExchangeRate
    from app.schemas.currency import ExchangeRateCreate

    monkeypatch.setattr(cur, "require_any_permission", lambda **k: _member())
    payload = ExchangeRateCreate(
        from_currency="USD", to_currency="BDT", rate=Decimal("110"), rate_date=date(2026, 1, 1), source="manual"
    )
    created = cur.create_exchange_rate(
        payload, db=Db(query_map={ExchangeRate: Query(first_row=None)}), current_user=_user()
    )
    assert created["from_currency"] == "USD"
    assert created["rate"] == "110.0000"

    existing = SimpleNamespace(
        id="r1", from_currency="USD", to_currency="BDT", rate=Decimal("100"), rate_date=date(2026, 1, 1), source=None, is_active=False
    )
    updated = cur.create_exchange_rate(
        payload, db=Db(query_map={ExchangeRate: Query(first_row=existing)}), current_user=_user()
    )
    assert existing.rate == Decimal("110")
    assert existing.is_active is True
    assert updated["id"] == "r1"


def test_cur_list_rates_convert_and_latest(monkeypatch):
    from app.api.v1 import currency as cur
    from app.models.currency import ExchangeRate
    from app.schemas.currency import ConvertAmountRequest

    monkeypatch.setattr(cur, "get_any_active_member", lambda **k: _member())
    rate = SimpleNamespace(
        id="r1",
        from_currency="USD",
        to_currency="BDT",
        rate=Decimal("110.5"),
        rate_date=date(2026, 1, 1),
        source="manual",
        is_active=True,
    )
    listed = cur.list_exchange_rates(db=Db(query_map={ExchangeRate: [rate]}), current_user=_user())
    assert listed[0]["rate"] == "110.5000"

    assert cur.get_latest_rate(Db(), "BDT", "bdt") == Decimal("1")
    with pytest.raises(HTTPException) as exc:
        cur.get_latest_rate(Db(query_map={ExchangeRate: Query(first_row=None)}), "USD", "BDT")
    assert exc.value.status_code == 404

    converted = cur.convert_amount(
        ConvertAmountRequest(amount=Decimal("2"), from_currency="USD", to_currency="BDT"),
        db=Db(query_map={ExchangeRate: Query(first_row=rate)}),
        current_user=_user(),
    )
    assert converted["converted_amount"] == "221.0000"


def test_cur_family_currency_summary(monkeypatch):
    from app.api.v1 import currency as cur
    from app.models.account import Account
    from app.models.family import Family

    monkeypatch.setattr(cur, "require_permission", lambda **k: None)
    with pytest.raises(HTTPException) as exc:
        cur.family_currency_summary("missing", db=Db(got=None), current_user=_user())
    assert exc.value.status_code == 404

    family = SimpleNamespace(id="fam-1", default_currency="BDT")
    wallets = [
        SimpleNamespace(id="w1", name="Cash", currency="BDT", current_balance=Decimal("100"), is_active=True, deleted_at=None),
        SimpleNamespace(id="w2", name="USD Wallet", currency="USD", current_balance=Decimal("10"), is_active=True, deleted_at=None),
    ]
    monkeypatch.setattr(cur, "get_latest_rate", lambda **k: Decimal("110"))
    out = cur.family_currency_summary(
        "fam-1",
        db=Db(got={ "fam-1": family} if False else family, query_map={Account: wallets, Family: family}),
        current_user=_user(),
    )
    assert out["wallet_count"] == 2
    assert out["base_currency"] == "BDT"
    assert out["total_converted_balance"] == "1200.0000"


# ===========================================================================
# architecture_system_api.py
# ===========================================================================


def test_asa_patch_user_preferences(monkeypatch):
    from app.api.v1 import architecture_system_api as asa

    pref = SimpleNamespace(id="p1", user_id="u1", theme="light", language="en", notification_on=True, currency="BDT")
    monkeypatch.setattr(asa, "ensure_user_preference", lambda db, user: pref)
    out = asa.patch_user_preferences(
        asa.UserPreferencePatch(theme="DARK", language="BN", currency="usd", notification_on=False),
        db=Db(),
        user=_user(),
    )
    assert pref.theme == "dark"
    assert pref.language == "bn"
    assert pref.currency == "USD"
    assert pref.notification_on is False
    assert out["theme"] == "dark"


def test_asa_list_sync_logs(monkeypatch):
    from app.api.v1 import architecture_system_api as asa
    from app.models.architecture_system import SyncLog

    monkeypatch.setattr(asa, "require_permission", lambda *a, **k: None)
    rows = [
        SimpleNamespace(id="s1", device_id="d1", family_id="fam-1", synced_at=None, items_synced=3, success=True, error_msg=None),
        SimpleNamespace(id="s2", device_id="d1", family_id="fam-1", synced_at=None, items_synced=0, success=False, error_msg="fail"),
    ]
    out = asa.list_sync_logs("fam-1", limit=50, db=Db(query_map={SyncLog: rows}), user=_user())
    assert out["summary"]["total"] == 2
    assert out["summary"]["fail_count"] == 1
    assert out["summary"]["success_rate"] == 0.5


def test_asa_list_api_logs(monkeypatch):
    from app.api.v1 import architecture_system_api as asa
    from app.models.architecture_system import ApiLog
    from app.models.family_member import FamilyMember

    monkeypatch.setattr(asa, "require_permission", lambda *a, **k: None)
    log = SimpleNamespace(
        id="l1", user_id="u1", endpoint="/x", method="GET", status_code=200, duration_ms=800, created_at=None
    )
    db = Db(query_map={FamilyMember.user_id: Query(rows=[("u1",)]), ApiLog: [log]})
    out = asa.list_api_logs("fam-1", min_ms=100, limit=20, db=db, user=_user())
    assert out["summary"]["row_count"] == 1
    assert out["summary"]["slow_count_ge_500ms"] == 1
    assert out["summary"]["avg_duration_ms"] == 800


def test_asa_list_devices_and_templates():
    from app.api.v1 import architecture_system_api as asa
    from app.models.architecture_system import DeviceRegistry, NotificationTemplate

    device = SimpleNamespace(
        id="d1", device_fingerprint="fp", platform="android", app_version="1.0", registered_at=None, family_id="fam-1"
    )
    devices = asa.list_device_registry(db=Db(query_map={DeviceRegistry: [device]}), user=_user())
    assert devices[0]["platform"] == "android"

    tmpl = SimpleNamespace(
        id="t1", type="BUDGET", title_bn="বাজেট", title_en="Budget", body_bn="ব", body_en="b", variables="[]"
    )
    templates = asa.list_notification_templates(db=Db(query_map={NotificationTemplate: [tmpl]}), user=_user())
    assert templates[0]["type"] == "BUDGET"


# ===========================================================================
# offline_sync_hardened.py
# ===========================================================================


def test_p10b_json_helpers():
    from app.api.v1 import offline_sync_hardened as mod

    token = mod._phase10b_now_token()
    assert token.endswith("Z")
    assert mod._phase10b_q('na"me') == '"na""me"'
    payload = {"n": Decimal("1.5"), "t": datetime(2026, 1, 1, 12, 0, 0), "xs": [Decimal("2")]}
    encoded = mod._phase10b_json(payload)
    assert encoded["n"] == 1.5
    assert "2026-01-01" in encoded["t"]
    text = mod._phase10b_json_text({"a": 1})
    assert '"a"' in text
    assert mod._phase10b_load_json(None) is None
    assert mod._phase10b_load_json({"x": 1}) == {"x": 1}
    assert mod._phase10b_load_json('{"y": 2}') == {"y": 2}
    assert mod._phase10b_load_json("not-json") == "not-json"


def test_p10b_ensure_sync_tables_and_line_rows(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    db = Db()
    mod._phase10b_ensure_sync_tables(db)
    assert db.commit_count == 1
    assert len(db.executed) >= 5

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: set())
    assert mod._phase10b_transaction_line_rows(Db(), "fam-1", None, 10) == []

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: {"transaction_lines", "transactions"})
    monkeypatch.setattr(mod, "_phase10b_columns", lambda db, table: {"id": {}, "family_id": {}})
    assert mod._phase10b_transaction_line_rows(Db(), "fam-1", None, 10) == []


def test_p10b_family_rows_with_since(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: {"accounts"})
    monkeypatch.setattr(
        mod,
        "_phase10b_columns",
        lambda db, table: {"id": {}, "family_id": {}, "updated_at": {}, "deleted_at": {}},
    )
    db = Db(execute_results=[_rows_result([{"id": "a1"}])])
    rows = mod._phase10b_family_rows(db, "accounts", "fam-1", "2026-01-01", 10)
    assert rows == [{"id": "a1"}]
    sql = str(db.executed[0][0])
    assert "since_token" in sql or ":since_token" in sql


def test_p10b_sync_conflicts(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_require_any_permission", lambda *a, **k: SimpleNamespace(ok=True))
    monkeypatch.setattr(mod, "_phase10b_ensure_sync_tables", lambda db: None)
    db = Db(
        execute_results=[
            _rows_result(
                [{"id": "c1", "local_payload": '{"n":1}', "remote_payload": "{}", "resolution_payload": None}]
            )
        ]
    )
    out = mod.phase10b_sync_conflicts("fam-1", status="OPEN", limit=10, db=db, current_user=_user())
    assert out["conflict_count"] == 1
    assert out["conflicts"][0]["local_payload"] == {"n": 1}


def test_p10b_resolve_conflict_paths(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_require_any_permission", lambda *a, **k: SimpleNamespace(ok=True))
    monkeypatch.setattr(mod, "_phase10b_ensure_sync_tables", lambda db: None)
    monkeypatch.setattr(mod, "_phase10b_get_current_member_id", lambda *a, **k: "m1")
    monkeypatch.setattr(mod, "_phase10b_insert_audit", lambda *a, **k: None)

    with pytest.raises(HTTPException) as exc:
        mod.phase10b_resolve_conflict(
            "fam-1", "missing", body={}, db=Db(execute_results=[_mapping_first_result(None)]), current_user=_user()
        )
    assert exc.value.status_code == 404

    already = mod.phase10b_resolve_conflict(
        "fam-1",
        "c1",
        body={},
        db=Db(execute_results=[_mapping_first_result({"id": "c1", "status": "RESOLVED"})]),
        current_user=_user(),
    )
    assert already["status"] == "already_resolved"

    monkeypatch.setattr(mod, "apply_conflict_resolution", lambda *a, **k: {"applied": True, "strategy": "keep_local"})
    db = Db(execute_results=[_mapping_first_result({"id": "c1", "status": "OPEN", "device_id": "d1"})])
    resolved = mod.phase10b_resolve_conflict(
        "fam-1", "c1", body={"strategy": "keep_local"}, db=db, current_user=_user()
    )
    assert resolved["status"] == "resolved"
    assert db.commit_count >= 1


# ===========================================================================
# sync_apply remaining helpers
# ===========================================================================


def test_sa_open_conflict_and_set_outbox(monkeypatch):
    from app.models.sync_tables import SyncConflict, SyncOutbox
    from app.services import sync_apply as sa

    monkeypatch.setattr("app.api.v1.notifications.create_notification", lambda *a, **k: None)
    db = Db()
    cid = sa._open_conflict(
        db,
        family_id="fam-1",
        device_id="d1",
        entity_type="grocery_lists",
        entity_id="l1",
        local_payload={"name": "local"},
        remote_payload={"name": "server"},
        reason="DELETE_EDIT_RACE",
        notify=True,
    )
    assert isinstance(cid, str) and len(cid) > 8
    assert len(db.added) == 1
    assert isinstance(db.added[0], SyncConflict)

    outbox_row = SimpleNamespace(
        id="o1",
        status="PENDING",
        error_message=None,
        updated_at=None,
        synced_at=None,
    )
    db_outbox = Db(query_map={SyncOutbox: outbox_row})
    sa._set_outbox_status(db_outbox, "o1", "SYNCED", error_message=None)
    assert outbox_row.status == "SYNCED"
    assert outbox_row.synced_at is not None


def test_sa_find_item_bump_and_gate(monkeypatch):
    from app.models.grocery import GroceryItem
    from app.services import sync_apply as sa

    item = SimpleNamespace(id="i1", family_id="fam-1", mobile_sync_key="k1", sync_version=2, last_client_updated_at=None)
    db = Db(query_map={GroceryItem: item})
    assert sa._find_grocery_item(db, "fam-1", "i1", {}) is item
    assert sa._find_grocery_item(Db(query_map={GroceryItem: Query(first_row=None)}), "fam-1", None, {}) is None
    found = sa._find_grocery_item(
        Db(query_map={GroceryItem: Query(first_row=item)}), "fam-1", None, {"mobile_sync_key": "k1"}
    )
    assert found is item

    sa._bump(item, {"client_updated_at": "2026-08-12"})
    assert item.sync_version == 3
    assert item.last_client_updated_at == "2026-08-12"

    row = SimpleNamespace(id="x", sync_version=4, updated_at="2026-08-12", last_client_updated_at=None)
    lww = sa._gate_version_or_conflict(
        Db(),
        family_id="fam-1",
        device_id="d1",
        entity_type="grocery_items",
        row=row,
        payload={"name": "stale", "client_updated_at": "2026-08-01"},
        operation="UPDATE",
    )
    assert lww["note"] == "lww_server_wins"

    monkeypatch.setattr(sa, "_open_conflict", lambda *a, **k: "cid-9")
    conflicted = sa._gate_version_or_conflict(
        Db(),
        family_id="fam-1",
        device_id="d1",
        entity_type="grocery_items",
        row=row,
        payload={"name": "x", "expected_sync_version": 1},
        operation="DELETE",
    )
    assert conflicted["status"] == "CONFLICT"
    assert conflicted["conflict_id"] == "cid-9"


def test_sa_parse_date_and_savings_create_close():
    from app.models.account import Account
    from app.models.savings import SavingsGoal
    from app.services import sync_apply as sa

    assert sa._parse_date(None) is None
    assert sa._parse_date("") is None
    assert sa._parse_date(date(2026, 1, 2)) == date(2026, 1, 2)
    assert sa._parse_date("2026-03-04") == date(2026, 3, 4)
    assert sa._parse_date("nope") is None

    wallet = SimpleNamespace(id="w1", family_id="fam-1", currency="BDT", deleted_at=None)
    created = sa._apply_savings_goal(
        Db(query_map={Account: wallet}),
        family_id="fam-1",
        operation="CREATE",
        entity_id=None,
        payload={"wallet_account_id": "w1", "name": "Emergency", "target_amount": "500"},
        member_id="m1",
    )
    assert created["status"] == "SYNCED"

    goal = SimpleNamespace(id="g1", family_id="fam-1", current_amount=Decimal("10"), status="ACTIVE")
    blocked = sa._apply_savings_goal(
        Db(got=goal),
        family_id="fam-1",
        operation="DELETE",
        entity_id="g1",
        payload={},
        member_id="m1",
    )
    assert "cannot close" in blocked["error"]

    goal.current_amount = Decimal("0")
    closed = sa._apply_savings_goal(
        Db(got=goal), family_id="fam-1", operation="DELETE", entity_id="g1", payload={}, member_id="m1"
    )
    assert closed["status"] == "SYNCED"
    assert goal.status == "CLOSED"


def test_sa_recurring_pause_resume_and_create():
    from app.models.account import Account
    from app.models.recurring import RecurringTransaction
    from app.services import sync_apply as sa

    row = SimpleNamespace(id="r1", family_id="fam-1", status="ACTIVE", title="Rent", amount=Decimal("10"), frequency="MONTHLY")
    paused = sa._apply_recurring_transaction(
        Db(got=row), family_id="fam-1", operation="PAUSE", entity_id="r1", payload={}, member_id="m1"
    )
    assert paused["status"] == "SYNCED"
    assert row.status == "PAUSED"
    resumed = sa._apply_recurring_transaction(
        Db(got=row), family_id="fam-1", operation="RESUME", entity_id="r1", payload={}, member_id="m1"
    )
    assert row.status == "ACTIVE"
    assert resumed["status"] == "SYNCED"

    wallet = SimpleNamespace(id="w1", family_id="fam-1", currency="BDT", deleted_at=None)
    created = sa._apply_recurring_transaction(
        Db(query_map={Account: wallet}),
        family_id="fam-1",
        operation="CREATE",
        entity_id=None,
        payload={
            "account_id": "w1",
            "title": "Salary",
            "transaction_type": "INCOME",
            "amount": "1000",
            "frequency": "MONTHLY",
            "start_date": "2026-01-01",
        },
        member_id="m1",
    )
    assert created["status"] == "SYNCED"


def test_sa_zakat_phase15_phase16_apply():
    from app.models.phase15 import Phase15Item
    from app.models.phase16 import Phase16Item
    from app.services import sync_apply as sa

    zakat = sa._apply_zakat_record(
        Db(),
        family_id="fam-1",
        operation="CREATE",
        payload={"cash_amount": "1000", "nisab_amount": "500", "calculation_year": "1447"},
        member_id="m1",
    )
    assert zakat["status"] == "SYNCED"

    p15 = sa._apply_phase15_item(
        Db(),
        family_id="fam-1",
        operation="CREATE",
        entity_id=None,
        payload={"name": "Car", "module_type": "VEHICLE", "amount": "10"},
        member_id="m1",
    )
    assert p15["status"] == "SYNCED"

    existing = SimpleNamespace(
        id="p1", family_id="fam-1", name="Old", module_type="SUBSCRIPTION", status="ACTIVE",
        amount=Decimal("1"), note=None, provider=None, category="GENERAL", sub_type=None,
        billing_cycle="MONTHLY", reference=None, renewal_or_expiry_date=None, payment_account_id=None,
        file_name=None,
    )
    updated = sa._apply_phase16_item(
        Db(got=existing),
        family_id="fam-1",
        operation="UPDATE",
        entity_id="p1",
        payload={"name": "New Sub", "amount": "20", "note": "n"},
        member_id="m1",
    )
    assert updated["status"] == "SYNCED"
    assert existing.name == "New Sub"

    closed = sa._apply_phase16_item(
        Db(got=existing), family_id="fam-1", operation="DELETE", entity_id="p1", payload={}, member_id="m1"
    )
    assert existing.status == "CLOSED"
    assert closed["status"] == "SYNCED"
    _ = Phase15Item, Phase16Item


def test_sa_architecture_tags_investments_and_routing():
    from app.services import sync_apply as sa

    tags = sa._apply_architecture_entity(
        Db(), family_id="fam-1", entity_type="tags", operation="CREATE", entity_id=None,
        payload={"name": "Food", "color": "#f00"}, member_id="m1",
    )
    assert tags["status"] == "SYNCED"

    missing_name = sa._apply_architecture_entity(
        Db(), family_id="fam-1", entity_type="tags", operation="CREATE", entity_id=None,
        payload={"name": "  "}, member_id="m1",
    )
    assert missing_name["status"] == "FAILED"

    inv = sa._apply_architecture_entity(
        Db(), family_id="fam-1", entity_type="investments", operation="CREATE", entity_id=None,
        payload={"name": "DPS", "amount": "1000"}, member_id="m1",
    )
    assert inv["status"] == "SYNCED"

    routed = sa.apply_one_change(
        Db(), family_id="fam-1", device_id="d1", entity_type="zakat_records",
        operation="CREATE", entity_id=None, payload={"cash_amount": "10", "nisab_amount": "1"}, member_id="m1",
    )
    assert routed["status"] == "SYNCED"


def test_sa_conflict_unknown_and_force_grocery_item():
    from app.models.grocery import GroceryItem
    from app.services import sync_apply as sa

    unknown = sa.apply_conflict_resolution(
        Db(), family_id="fam-1", device_id="d1",
        conflict_row={"entity_type": "grocery_lists", "entity_id": "l1"},
        body={"strategy": "nope"}, member_id="m1",
    )
    assert unknown["applied"] is False
    assert unknown["error"] == "unknown strategy"

    item = SimpleNamespace(
        id="i1", family_id="fam-1", name="Rice", category="FOOD", quantity=Decimal("1"), unit="kg",
        estimated_price=Decimal("10"), actual_price=Decimal("0"), is_bought=False, note=None,
        vendor_name=None, sync_version=1, last_client_updated_at=None,
    )
    out = sa._force_apply_payload(
        Db(query_map={GroceryItem: item}),
        family_id="fam-1",
        entity_type="grocery_items",
        entity_id="i1",
        payload={"name": "Milk", "is_bought": True, "expected_sync_version": 99},
    )
    assert out["status"] == "SYNCED"
    assert item.name == "Milk"
    assert item.is_bought is True
    assert item.sync_version == 2


# ===========================================================================
# auth.py remaining routes
# ===========================================================================


def test_auth_utc_now_and_to_user_response(monkeypatch):
    from app.api.v1 import auth as mod

    now = mod.utc_now()
    assert now.tzinfo is None
    monkeypatch.setattr(mod, "avatar_url_for", lambda uid: "/avatars/u1.jpg")
    monkeypatch.setattr("app.core.field_encryption.decrypt_field", lambda v: v)
    resp = mod.to_user_response(_user())
    assert resp.email == "u@example.com"
    assert resp.avatar_url == "/avatars/u1.jpg"


def test_auth_register_duplicate_email(monkeypatch):
    from app.api.v1 import auth as mod
    from app.models.user import User
    from app.schemas.auth import UserRegisterRequest

    monkeypatch.setattr(mod.AuthSecurityService, "validate_password_strength", lambda *a, **k: [])
    with pytest.raises(HTTPException) as exc:
        _unwrap(mod.register_user)(
            UserRegisterRequest(full_name="Ada Lovelace", email="ada@example.com", password="Secret123!"),
            _request(),
            Response(),
            Db(query_map={User: Query(first_row=_user())}),
        )
    assert exc.value.status_code == 409


def test_auth_login_failure_paths(monkeypatch):
    from app.api.v1 import auth as mod
    from app.models.user import User
    from app.schemas.auth import UserLoginRequest

    payload = UserLoginRequest(email="u@example.com", password="Secret123")
    login = _unwrap(mod.login_user)
    with pytest.raises(HTTPException) as exc:
        login(payload, _request(), Response(), db=Db(query_map={User: Query(first_row=None)}))
    assert exc.value.status_code == 401

    locked = _user()
    monkeypatch.setattr(mod.AuthSecurityService, "is_user_locked", lambda u: True)
    with pytest.raises(HTTPException) as exc2:
        login(payload, _request(), Response(), db=Db(query_map={User: Query(first_row=locked)}))
    assert exc2.value.status_code == 423

    monkeypatch.setattr(mod.AuthSecurityService, "is_user_locked", lambda u: False)
    monkeypatch.setattr(mod, "verify_password", lambda p, h: False)
    monkeypatch.setattr(mod.AuthSecurityService, "record_failed_login", lambda u: None)
    with pytest.raises(HTTPException) as exc3:
        login(payload, _request(), Response(), db=Db(query_map={User: Query(first_row=locked)}))
    assert exc3.value.status_code == 401

    monkeypatch.setattr(mod, "verify_password", lambda p, h: True)
    inactive = _user()
    inactive.is_active = False
    with pytest.raises(HTTPException) as exc4:
        login(payload, _request(), Response(), db=Db(query_map={User: Query(first_row=inactive)}))
    assert exc4.value.status_code == 403

    unverified = _user()
    unverified.is_email_verified = False
    with pytest.raises(HTTPException) as exc5:
        login(payload, _request(), Response(), db=Db(query_map={User: Query(first_row=unverified)}))
    assert exc5.value.status_code == 403


def test_auth_verify_reset_logout_and_refresh(monkeypatch):
    from app.api.v1 import auth as mod
    from app.models.user import User
    from app.schemas.auth import EmailVerifyRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest

    monkeypatch.setattr(mod.AuthSecurityService, "verify_email_token", lambda db, token: None)
    with pytest.raises(HTTPException) as exc:
        mod.verify_email(EmailVerifyRequest(token="bad-token-1"), db=Db())
    assert exc.value.status_code == 400

    monkeypatch.setattr(mod, "avatar_url_for", lambda uid: None)
    monkeypatch.setattr("app.core.field_encryption.decrypt_field", lambda v: v)
    monkeypatch.setattr(mod.AuthSecurityService, "verify_email_token", lambda db, token: _user())
    verified = mod.verify_email(EmailVerifyRequest(token="good-token1"), db=Db())
    assert "verified" in verified.message.lower()

    monkeypatch.setattr(mod.AuthSecurityService, "consume_password_reset_token", lambda db, token: None)
    with pytest.raises(HTTPException) as exc2:
        mod.reset_password(ResetPasswordRequest(token="bad-token-1", new_password="Secret123"), db=Db())
    assert exc2.value.status_code == 400

    out = mod.logout_user(_request(), Response(), payload=None, db=Db())
    assert "Logged out" in out.message

    with pytest.raises(HTTPException) as exc3:
        mod.refresh_access_token(_request(), Response(), payload=RefreshTokenRequest(), db=Db())
    assert exc3.value.status_code == 401

    monkeypatch.setattr(mod, "read_refresh_token", lambda req, body: "refresh-token-value-123")
    monkeypatch.setattr(mod.AuthSecurityService, "rotate_refresh_session", lambda *a, **k: None)
    monkeypatch.setattr(mod, "clear_refresh_cookie", lambda resp: None)
    with pytest.raises(HTTPException) as exc4:
        mod.refresh_access_token(_request(), Response(), payload=None, db=Db())
    assert exc4.value.status_code == 401
    _ = User


def test_auth_resend_and_avatar_routes(monkeypatch):
    from app.api.v1 import auth as mod
    from app.models.user import User
    from app.schemas.auth import ResendEmailVerificationRequest

    resend = _unwrap(mod.resend_email_verification)
    unknown = resend(
        ResendEmailVerificationRequest(email="nobody@example.com"),
        _request(),
        Response(),
        Db(query_map={User: Query(first_row=None)}),
    )
    assert unknown.verification_token is None

    already = resend(
        ResendEmailVerificationRequest(email="u@example.com"),
        _request(),
        Response(),
        Db(query_map={User: Query(first_row=_user())}),
    )
    assert "already verified" in already.message.lower()

    monkeypatch.setattr(mod, "to_user_response", lambda u: SimpleNamespace(id=u.id, email=u.email))
    monkeypatch.setattr(mod, "delete_avatar", lambda uid: True)
    removed = mod.remove_my_avatar(current_user=_user())
    assert removed.id == "u1"

    monkeypatch.setattr(mod, "save_avatar", AsyncMock(return_value=None))
    uploaded = _run(mod.upload_my_avatar(file=SimpleNamespace(), current_user=_user()))
    assert uploaded.id == "u1"


# ===========================================================================
# main.py remaining paths
# ===========================================================================


def test_main_lifespan_celery_enabled(monkeypatch):
    from app import main as main_mod

    hub = SimpleNamespace(bind_loop=lambda loop: None)
    monkeypatch.setattr("app.services.grocery_realtime.grocery_realtime_hub", hub, raising=False)
    monkeypatch.setattr(main_mod.settings, "CELERY_ENABLED", True, raising=False)
    monkeypatch.setattr(main_mod.settings, "ENABLE_RECURRING_WORKER", True, raising=False)
    monkeypatch.setattr(main_mod.settings, "ENABLE_AUTO_BACKUP_WORKER", True, raising=False)

    async def _go():
        async with main_mod.lifespan(SimpleNamespace()):
            return True

    assert _run(_go()) is True


def test_main_deprecation_skips_versioned_and_health():
    from app import main as main_mod

    async def _next(request):
        return Response(status_code=200)

    req = _request()
    req.scope["path"] = "/api/v1/accounts"
    resp = _run(main_mod.mark_unversioned_api_deprecated(req, _next))
    assert "Deprecation" not in resp.headers

    req2 = _request()
    req2.scope["path"] = "/health"
    resp2 = _run(main_mod.mark_unversioned_api_deprecated(req2, _next))
    assert "Deprecation" not in resp2.headers


def test_main_debug_staging_and_health_fields(monkeypatch):
    from app import main as main_mod

    monkeypatch.setattr(main_mod.settings, "ENVIRONMENT", "staging", raising=False)
    with pytest.raises(HTTPException) as exc:
        main_mod.debug_ws_routes()
    assert exc.value.status_code == 404

    health = main_mod.health_check()
    assert health["service"] == "s4-family-finance-api"
    assert "/api/v1" in health["api_versions"]
    assert health["layers"]["auth_middleware"] is True
    assert "sync_processor" in health["layers"]["celery_tasks"]
