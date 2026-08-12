"""Batch-11 coverage push: sync_apply, offline_sync_hardened, grocery — mock-only."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Shared Query / Db helpers (batch2 pattern)
# ---------------------------------------------------------------------------


class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def group_by(self, *args, **kwargs):
        return self

    def scalar(self):
        row = self._first
        if isinstance(row, tuple):
            return row[0] if len(row) == 1 else row
        return row

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

    def query(self, model):
        payload = self.query_map.get(model)
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


class AggregateDb(Db):
    """Db that supports db.query(col, func.count(...)) aggregate queries."""

    def __init__(self, aggregate_results=None, **kwargs):
        super().__init__(**kwargs)
        self._aggregate_results = list(aggregate_results or [])

    def query(self, model, *args):
        if args or not isinstance(model, type):
            payload = self._aggregate_results.pop(0) if self._aggregate_results else 0
            if isinstance(payload, list):
                return Query(rows=payload)
            return Query(first_row=payload)
        return super().query(model)


def _scalar_result(value):
    result = MagicMock()
    result.scalar.return_value = value
    return result


def _mapping_all_result(rows):
    result = MagicMock()
    result.mappings.return_value.all.return_value = rows
    return result


def _mapping_first_result(row):
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    return result


def _first_result(value):
    result = MagicMock()
    result.first.return_value = value
    return result


# ---------------------------------------------------------------------------
# sync_apply — pure helpers + apply_* paths
# ---------------------------------------------------------------------------


def test_sync_apply_json_helpers_round_trip():
    from app.services import sync_apply as sa

    assert sa._load_json('{"x": 1}') == {"x": 1}
    assert sa._load_json(None) is None
    assert sa._dec("bad", "5") == Decimal("5")
    assert sa._clean("  hi ") == "hi"
    text = sa._json_text({"n": Decimal("1.5")})
    assert "1.5" in text


def test_sync_apply_server_snapshot_iso_and_decimal():
    from app.services import sync_apply as sa

    row = SimpleNamespace(
        id="a1",
        name="Cash",
        current_balance=Decimal("99.50"),
        updated_at=datetime(2026, 1, 15, 12, 0, 0),
        hidden_field="skip",
    )
    snap = sa._server_snapshot(row)
    assert snap["current_balance"] == 99.5
    assert snap["updated_at"] == "2026-01-15T12:00:00"
    assert "hidden_field" not in snap


def test_sync_apply_check_version_bought_only_merge():
    from app.services import sync_apply as sa

    row = SimpleNamespace(sync_version=9, updated_at="2026-08-12", last_client_updated_at=None)
    assert sa._check_version(row, {"is_bought": True, "actual_price": "10"}) is None


def test_sync_apply_check_version_expected_mismatch():
    from app.services import sync_apply as sa

    row = SimpleNamespace(sync_version=4, id="x", name="A", updated_at=None)
    conflict = sa._check_version(row, {"name": "B", "expected_sync_version": 2})
    assert conflict["code"] == "SYNC_CONFLICT"
    assert conflict["server_sync_version"] == 4


def test_sync_apply_find_grocery_list_by_entity_id():
    from app.models.grocery import GroceryList
    from app.services import sync_apply as sa

    lst = SimpleNamespace(id="l1", family_id="f1")
    db = Db(query_map={GroceryList: lst})
    found = sa._find_grocery_list(db, "f1", "l1", {})
    assert found is lst


def test_sync_apply_apply_account_create_and_idempotent():
    from app.models.account import Account
    from app.services import sync_apply as sa

    db = Db()
    missing = sa._apply_account(
        db, family_id="f1", operation="CREATE", entity_id=None,
        payload={"name": "Cash"}, member_id=None,
    )
    assert missing["status"] == "FAILED"

    created = sa._apply_account(
        db, family_id="f1", operation="CREATE", entity_id="acc-1",
        payload={"name": "Wallet", "opening_balance": "100", "currency": "BDT"},
        member_id="m1",
    )
    assert created["status"] == "SYNCED"
    assert created["entity_id"] == "acc-1"
    assert db.added[0].current_balance == Decimal("100")

    existing = SimpleNamespace(id="acc-1", family_id="f1")
    db2 = Db(query_map={Account: existing})
    again = sa._apply_account(
        db2, family_id="f1", operation="UPSERT", entity_id="acc-1",
        payload={"name": "Wallet"}, member_id="m1",
    )
    assert again["note"] == "idempotent"


def test_sync_apply_apply_account_client_key_idempotent():
    from app.models.account import Account
    from app.services import sync_apply as sa

    dup = SimpleNamespace(
        id="acc-dup",
        institution_name="Bank [client_request_id:req-99]",
    )
    db = Db(query_map={Account: Query(rows=[dup])})
    result = sa._apply_account(
        db, family_id="f1", operation="CREATE", entity_id=None,
        payload={"name": "X", "client_request_id": "req-99"},
        member_id="m1",
    )
    assert result["note"] == "idempotent_client_key"


def test_sync_apply_apply_account_soft_delete_and_already_deleted():
    from app.models.account import Account
    from app.services import sync_apply as sa

    row = SimpleNamespace(id="a1", family_id="f1", deleted_at=None, is_active=True)
    db = Db(query_map={Account: row})
    deleted = sa._apply_account(
        db, family_id="f1", operation="DELETE", entity_id="a1", payload={},
    )
    assert deleted["status"] == "SYNCED"
    assert row.is_active is False
    assert row.deleted_at is not None

    gone = SimpleNamespace(id="a2", family_id="f1", deleted_at=datetime.now(timezone.utc))
    db2 = Db(query_map={Account: gone})
    again = sa._apply_account(
        db2, family_id="f1", operation="DELETE", entity_id="a2", payload={},
    )
    assert again["note"] == "already_deleted"


def test_sync_apply_apply_account_update_deleted_opens_conflict(monkeypatch):
    from app.models.account import Account
    from app.services import sync_apply as sa

    row = SimpleNamespace(
        id="a1", family_id="f1", deleted_at=datetime.now(timezone.utc),
        name="Old", account_type="CASH", institution_name=None,
        is_active=False, is_shared_family=True,
    )
    db = Db(query_map={Account: row})
    monkeypatch.setattr(sa, "_open_conflict", lambda *a, **k: "c-del")
    result = sa._apply_account(
        db, family_id="f1", operation="UPDATE", entity_id="a1",
        payload={"name": "New"}, device_id="d1",
    )
    assert result["status"] == "CONFLICT"
    assert result["conflict_id"] == "c-del"


def test_sync_apply_apply_account_update_metadata():
    from app.models.account import Account
    from app.services import sync_apply as sa

    row = SimpleNamespace(
        id="a1", family_id="f1", deleted_at=None,
        name="Cash", account_type="CASH", institution_name=None,
        is_active=True, is_shared_family=False,
    )
    db = Db(query_map={Account: row})
    result = sa._apply_account(
        db, family_id="f1", operation="UPDATE", entity_id="a1",
        payload={"name": "Petty Cash", "account_type": "bank", "is_shared_family": True},
    )
    assert result["status"] == "SYNCED"
    assert row.name == "Petty Cash"
    assert row.account_type == "BANK"
    assert row.is_shared_family is True


def test_sync_apply_apply_budget_create_update_delete():
    from app.services import sync_apply as sa
    from app.models.budget import Budget

    db = Db()
    fail = sa._apply_budget(
        db, family_id="f1", operation="CREATE", entity_id=None,
        payload={"name": "Food"}, member_id=None,
    )
    assert "member_id" in fail["error"]

    fail2 = sa._apply_budget(
        db, family_id="f1", operation="CREATE", entity_id=None,
        payload={"name": "Food"}, member_id="m1",
    )
    assert "category_id" in fail2["error"]

    created = sa._apply_budget(
        db, family_id="f1", operation="CREATE", entity_id=None,
        payload={"category_id": "c1", "budget_amount": "500", "name": "Groceries"},
        member_id="m1",
    )
    assert created["status"] == "SYNCED"
    assert db.added[0].budget_amount == Decimal("500")

    budget = SimpleNamespace(
        id="b1", family_id="f1", name="Old", budget_amount=Decimal("100"),
        note=None, status="ACTIVE",
    )
    db2 = Db(got=budget)
    updated = sa._apply_budget(
        db2, family_id="f1", operation="UPDATE", entity_id="b1",
        payload={"name": "New", "budget_amount": "200", "status": "ACTIVE"},
        member_id="m1",
    )
    assert updated["status"] == "SYNCED"
    assert budget.name == "New"

    closed = sa._apply_budget(
        db2, family_id="f1", operation="DELETE", entity_id="b1",
        payload={}, member_id="m1",
    )
    assert closed["status"] == "SYNCED"
    assert budget.status == "CLOSED"


def test_sync_apply_grocery_list_delete_edit_race(monkeypatch):
    from app.services import sync_apply as sa

    monkeypatch.setattr(sa, "_find_grocery_list", lambda *a, **k: None)
    monkeypatch.setattr(sa, "_open_conflict", lambda *a, **k: "race-1")
    db = Db()
    result = sa._apply_grocery_list(
        db, family_id="f1", device_id="d1", operation="UPDATE", entity_id="l-missing",
        payload={"name": "Late edit"}, member_id="m1",
    )
    assert result["status"] == "CONFLICT"
    assert result["conflict_id"] == "race-1"


def test_sync_apply_grocery_item_create_requires_list():
    from app.models.grocery import GroceryList
    from app.services import sync_apply as sa

    db = Db()
    missing_list = sa._apply_grocery_item(
        db, family_id="f1", device_id="d1", operation="CREATE", entity_id=None,
        payload={"grocery_list_id": "missing", "name": "Rice"}, member_id="m1",
    )
    assert missing_list["error"] == "grocery_list not found for item"

    glist = SimpleNamespace(id="l1", family_id="f1")
    db2 = Db(query_map={GroceryList: glist})
    created = sa._apply_grocery_item(
        db2, family_id="f1", device_id="d1", operation="CREATE", entity_id="i1",
        payload={"grocery_list_id": "l1", "name": "Milk", "quantity": "2"},
        member_id="m1",
    )
    assert created["status"] == "SYNCED"
    assert db2.added[0].name == "Milk"


def test_sync_apply_grocery_item_lww_server_newer(monkeypatch):
    from app.services import sync_apply as sa

    row = SimpleNamespace(
        id="i1", sync_version=5, updated_at="2026-08-12T12:00:00",
        last_client_updated_at=None, name="Rice", category="FOOD",
        quantity=Decimal("1"), unit="kg", estimated_price=Decimal("0"),
        actual_price=Decimal("0"), vendor_name=None, barcode=None,
        note=None, is_bought=False, mobile_sync_key=None,
    )
    db = Db()
    monkeypatch.setattr(sa, "_find_grocery_item", lambda *a, **k: row)
    result = sa._apply_grocery_item(
        db, family_id="f1", device_id="d1", operation="UPDATE", entity_id="i1",
        payload={"name": "Stale", "client_updated_at": "2026-08-11T12:00:00"},
        member_id="m1",
    )
    assert result["note"] == "lww_server_wins"


def test_sync_apply_grocery_vendor_update():
    from app.models.grocery import GroceryVendor
    from app.services import sync_apply as sa

    row = SimpleNamespace(
        id="v1", family_id="f1", name="Old", phone=None, address=None,
        category="GENERAL", note=None, is_active=True,
    )
    db = Db(query_map={GroceryVendor: row})
    result = sa._apply_grocery_vendor(
        db, family_id="f1", device_id="d1", operation="UPDATE", entity_id="v1",
        payload={"name": "Market", "phone": "123", "is_active": False},
        member_id="m1",
    )
    assert result["status"] == "SYNCED"
    assert row.name == "Market"
    assert row.is_active is False


def test_sync_apply_force_apply_grocery_list_and_vendor():
    from app.models.grocery import GroceryList, GroceryVendor
    from app.services import sync_apply as sa

    lst = SimpleNamespace(
        id="l1", name="Old", status="OPEN", budget_amount=Decimal("10"),
        vendor_name=None, note=None, sync_version=1, last_client_updated_at=None,
    )
    db = Db(query_map={GroceryList: lst})
    out = sa._force_apply_payload(
        db, family_id="f1", entity_type="grocery_lists", entity_id="l1",
        payload={"title": "New List", "budget_amount": "25"},
    )
    assert out["status"] == "SYNCED"
    assert lst.name == "New List"
    assert lst.sync_version == 2

    vendor = SimpleNamespace(
        id="v1", name="V", phone=None, address=None, category="GENERAL", is_active=True,
    )
    db2 = Db(query_map={GroceryVendor: vendor})
    out2 = sa._force_apply_payload(
        db2, family_id="f1", entity_type="grocery_vendors", entity_id="v1",
        payload={"name": "Shop", "phone": "999"},
    )
    assert out2["status"] == "SYNCED"
    assert vendor.phone == "999"


def test_sync_apply_apply_one_change_unsupported_and_transaction_tags(monkeypatch):
    from app.services import sync_apply as sa

    db = Db()
    bad = sa.apply_one_change(
        db, family_id="f1", device_id="d1", entity_type="not_real",
        operation="CREATE", entity_id=None, payload={}, member_id="m1",
    )
    assert bad["status"] == "FAILED"

    called = MagicMock(return_value={"status": "SYNCED", "entity_id": "t1"})
    monkeypatch.setattr(sa, "_apply_architecture_entity", called)
    ok = sa.apply_one_change(
        db, family_id="f1", device_id="d1", entity_type="transaction_tags",
        operation="CREATE", entity_id="t1", payload={"tag_id": "x"}, member_id="m1",
    )
    assert ok["status"] == "SYNCED"
    assert called.call_args.kwargs["entity_type"] == "transaction_tags"


def test_sync_apply_process_pending_outbox_without_filters(monkeypatch):
    from app.services import sync_apply as sa

    rows = [
        {"id": "o1", "device_id": "d1", "entity_type": "grocery_lists",
         "operation": "CREATE", "entity_id": None, "payload": "{}"},
    ]
    db = Db(execute_results=[_mapping_all_result(rows)])
    monkeypatch.setattr(
        sa, "apply_one_change",
        lambda *a, **k: {"status": "SYNCED", "entity_id": "l-new"},
    )
    set_status = MagicMock()
    monkeypatch.setattr(sa, "_set_outbox_status", set_status)

    summary = sa.process_pending_outbox(db, family_id="f1", member_id="m1")
    sql = str(db.executed[0][0])
    assert "device_id" not in sql
    assert summary["processed"] == 1
    assert summary["synced_count"] == 1
    set_status.assert_called_once_with(db, "o1", "SYNCED")


def test_sync_apply_conflict_resolution_keep_server_and_merge(monkeypatch):
    from app.services import sync_apply as sa

    db = Db()
    conflict = {
        "entity_type": "grocery_lists",
        "entity_id": "l1",
        "local_payload": {"name": "local"},
        "remote_payload": {"name": "server", "sync_version": 2},
    }
    keep = sa.apply_conflict_resolution(
        db, family_id="f1", device_id="d1", conflict_row=conflict,
        body={"strategy": "discard_local"}, member_id="m1",
    )
    assert keep["applied"] is False
    assert keep["strategy"] == "keep_server"

    apply = MagicMock(return_value={"status": "SYNCED", "entity_id": "l1"})
    monkeypatch.setattr(sa, "apply_one_change", apply)
    merged = sa.apply_conflict_resolution(
        db, family_id="f1", device_id="d1", conflict_row=conflict,
        body={"strategy": "merge", "chosen": {"name": "merged"}}, member_id="m1",
    )
    assert merged["applied"] is True
    assert apply.call_args.kwargs["payload"]["name"] == "merged"


# ---------------------------------------------------------------------------
# offline_sync_hardened — helpers + endpoints
# ---------------------------------------------------------------------------


def test_phase10b_first_and_rows_helpers():
    from app.api.v1 import offline_sync_hardened as mod

    cols = {"ID": {"name": "ID"}, "family_id": {"name": "family_id"}}
    assert mod._phase10b_first(cols, ["id", "missing"]) == "ID"
    assert mod._phase10b_first({"x": {}}, ["y"]) is None

    result = MagicMock()
    row = MagicMock()
    row._mapping = {"id": "1"}
    result.fetchall.return_value = [row]
    assert mod._phase10b_rows(result) == [{"id": "1"}]


def test_phase10b_tables_and_columns(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["accounts", "sync_outbox"]
    inspector.get_columns.return_value = [{"name": "id"}, {"name": "family_id"}]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    db = Db()
    assert mod._phase10b_tables(db) == {"accounts", "sync_outbox"}
    assert "family_id" in mod._phase10b_columns(db, "accounts")
    assert mod._phase10b_columns(db, "missing") == {}


def test_phase10b_get_current_member_id_paths(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: set())
    assert mod._phase10b_get_current_member_id(Db(), "f1", SimpleNamespace(id="u1")) is None

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: {"family_members"})
    monkeypatch.setattr(
        mod, "_phase10b_columns",
        lambda db, table: {
            "id": {}, "family_id": {}, "user_id": {},
        },
    )
    db = Db(execute_results=[_first_result(("mem-42",))])
    mid = mod._phase10b_get_current_member_id(db, "f1", SimpleNamespace(id="u9"))
    assert mid == "mem-42"


def test_phase10b_insert_audit_skips_missing_table(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: set())
    mod._phase10b_insert_audit(
        Db(), "f1", SimpleNamespace(id="u1"), "SYNC", "t", "d",
    )

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: {"audit_logs"})
    monkeypatch.setattr(
        mod, "_phase10b_columns",
        lambda db, table: {
            "id": {}, "family_id": {}, "action_type": {}, "title": {}, "description": {},
        },
    )
    monkeypatch.setattr(mod, "_phase10b_get_current_member_id", lambda *a, **k: "m1")
    db = Db()
    mod._phase10b_insert_audit(
        db, "f1", SimpleNamespace(id="u1"), "SYNC_PUSH", "Push", "ok",
    )
    assert db.commit_count == 1
    assert db.executed


def test_phase10b_register_device_insert_and_update(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_ensure_sync_tables", lambda db: None)

    db = Db(execute_results=[
        _first_result(None),   # no existing device
        MagicMock(),           # insert device
        _first_result(None),   # no existing state
        MagicMock(),           # insert state
    ])
    mod._phase10b_register_device(db, "f1", "dev-1", device_name="Phone")
    assert db.commit_count == 1

    db2 = Db(execute_results=[
        _first_result(("existing-id",)),  # device exists → update
        _first_result(("state-id",)),     # state exists → skip insert
    ])
    mod._phase10b_register_device(db2, "f1", "dev-1", platform="android")
    assert len(db2.executed) >= 2


def test_phase10b_family_rows_empty_when_no_family_col(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(mod, "_phase10b_tables", lambda db: {"accounts"})
    monkeypatch.setattr(mod, "_phase10b_columns", lambda db, table: {"id": {}})
    assert mod._phase10b_family_rows(Db(), "accounts", "f1", None, 10) == []


def test_phase10b_sync_push_validation_errors(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(
        mod, "_phase10b_require_any_permission",
        lambda *a, **k: SimpleNamespace(ok=True),
    )
    monkeypatch.setattr(mod, "_phase10b_ensure_sync_tables", lambda db: None)

    with pytest.raises(HTTPException) as exc:
        mod.phase10b_sync_push("f1", body={"changes": "bad"}, db=Db(), current_user=SimpleNamespace(id="u1"))
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc2:
        mod.phase10b_sync_push(
            "f1", body={"changes": [{"entity_type": "", "operation": "CREATE"}]},
            db=Db(), current_user=SimpleNamespace(id="u1"),
        )
    assert exc2.value.status_code == 422

    with pytest.raises(HTTPException) as exc3:
        mod.phase10b_sync_push(
            "f1", body={"changes": [{"entity_type": "bogus", "operation": "CREATE"}]},
            db=Db(), current_user=SimpleNamespace(id="u1"),
        )
    assert exc3.value.status_code == 422


def test_phase10b_sync_push_accepts_change(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(
        mod, "_phase10b_require_any_permission",
        lambda *a, **k: SimpleNamespace(ok=True),
    )
    monkeypatch.setattr(mod, "_phase10b_ensure_sync_tables", lambda db: None)
    monkeypatch.setattr(mod, "_phase10b_register_device", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_phase10b_get_current_member_id", lambda *a, **k: "m1")
    monkeypatch.setattr(
        mod, "process_pending_outbox",
        lambda *a, **k: {"synced_count": 1, "synced": ["o1"], "failed": [], "conflict_ids": []},
    )
    monkeypatch.setattr(mod, "_phase10b_insert_audit", lambda *a, **k: None)

    db = Db()
    out = mod.phase10b_sync_push(
        "f1",
        body={
            "device_id": "d1",
            "changes": [{
                "entity_type": "grocery_lists",
                "operation": "CREATE",
                "entity_id": "l1",
                "payload": {"name": "Weekly"},
            }],
        },
        db=db,
        current_user=SimpleNamespace(id="u1"),
    )
    assert out["status"] == "accepted"
    assert out["accepted_count"] == 1
    assert out["applied"]["synced_count"] == 1


def test_phase10b_sync_status_returns_counts(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(
        mod, "_phase10b_require_any_permission",
        lambda *a, **k: SimpleNamespace(ok=True),
    )
    monkeypatch.setattr(mod, "_phase10b_register_device", lambda *a, **k: None)

    scalars = []
    for _table in mod.SYNC_TABLES:
        scalars.append(_scalar_result(0))
    scalars.extend([
        _scalar_result(1),  # pending_outbox
        _scalar_result(0),  # conflicted_outbox
        _scalar_result(3),  # open_conflicts
        _mapping_first_result({"device_id": "d1", "last_sync_token": "tok"}),
    ])

    db = Db(execute_results=scalars)
    out = mod.phase10b_sync_status(
        "f1", device_id="d1", db=db, current_user=SimpleNamespace(id="u1"),
    )
    assert out["status"] == "ok"
    assert out["pending_outbox"] == 1
    assert out["offline_first"] is True


def test_phase10b_sync_pull_returns_server_changes(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(
        mod, "_phase10b_require_any_permission",
        lambda *a, **k: SimpleNamespace(ok=True),
    )
    monkeypatch.setattr(mod, "_phase10b_register_device", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_phase10b_family_rows", lambda *a, **k: [{"id": "x"}])
    monkeypatch.setattr(mod, "_phase10b_transaction_line_rows", lambda *a, **k: [])

    db = Db()
    out = mod.phase10b_sync_pull(
        "f1", device_id="d1", since_token=None, limit=50,
        db=db, current_user=SimpleNamespace(id="u1"),
    )
    assert out["family_id"] == "f1"
    assert out["changes"]["accounts"] == [{"id": "x"}]
    assert "sync_token" in out
    assert db.commit_count == 1


# ---------------------------------------------------------------------------
# grocery.py — helpers + endpoint functions
# ---------------------------------------------------------------------------


def test_grocery_get_helpers_raise_404():
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryList, GroceryItem, GroceryVendor

    db = Db(query_map={GroceryList: None, GroceryItem: None, GroceryVendor: None})
    with pytest.raises(HTTPException) as exc:
        gr.get_list(db, "f1", "missing")
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException):
        gr.get_item(db, "f1", "missing")

    with pytest.raises(HTTPException):
        gr.get_vendor(db, "f1", "missing")


def test_grocery_require_expected_version_and_bump_sync():
    from app.api.v1 import grocery as gr

    row = SimpleNamespace(sync_version=3, updated_at=datetime(2026, 1, 1))
    with pytest.raises(HTTPException) as exc:
        gr.require_expected_version(row, 2)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "SYNC_CONFLICT"

    gr.require_expected_version(row, 3)
    gr.bump_sync(row, " 2026-08-12 ")
    assert row.sync_version == 4
    assert row.last_client_updated_at == "2026-08-12"


def test_grocery_dual_write_skips_or_adds():
    from app.api.v1 import grocery as gr
    from app.models.architecture_feature import GroceryListItem, VendorContact

    vendor = SimpleNamespace(
        id="v1", family_id="f1", name="Shop", phone=None, address=None,
        category="GENERAL", note=None, is_active=True,
    )
    db = Db(query_map={VendorContact: SimpleNamespace(id="existing")})
    gr._dual_write_vendor(db, vendor)
    assert len(db.added) == 0

    db2 = Db(query_map={VendorContact: None})
    gr._dual_write_vendor(db2, vendor)
    assert len(db2.added) == 1
    assert db2.added[0].legacy_grocery_vendor_id == "v1"

    item = SimpleNamespace(
        id="i1", family_id="f1", grocery_list_id="l1", created_by_member_id="m1",
        name="Rice", quantity=Decimal("2"), unit="kg",
        actual_price=Decimal("10"), estimated_price=Decimal("12"),
        is_bought=False, barcode=None, category="FOOD", mobile_sync_key=None,
    )
    db3 = Db(query_map={GroceryListItem: None})
    gr._dual_write_grocery_item(db3, item)
    assert db3.added[0].name == "Rice"


def test_grocery_budget_compare_over_budget(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryList, GroceryItem

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: None)
    glist = SimpleNamespace(id="l1", family_id="f1", budget_amount=Decimal("50"), currency="BDT")
    items = [
        SimpleNamespace(
            estimated_price=Decimal("60"), actual_price=Decimal("80"),
            quantity=Decimal("1"), is_bought=True, updated_at=None,
        ),
        SimpleNamespace(
            estimated_price=Decimal("30"), actual_price=Decimal("0"),
            quantity=Decimal("1"), is_bought=False, updated_at=None,
        ),
    ]
    db = Db(query_map={GroceryList: glist, GroceryItem: Query(rows=items)})
    out = gr.grocery_budget_compare("f1", "l1", db=db, current_user=SimpleNamespace(id="u1"))
    assert out["over_budget"] is True
    assert out["bought_count"] == 1
    assert out["item_count"] == 2


def test_grocery_barcode_lookup_paths(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryItem

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: None)

    with pytest.raises(HTTPException) as exc:
        gr.grocery_barcode_lookup("f1", "  ", db=Db(), current_user=SimpleNamespace(id="u1"))
    assert exc.value.status_code == 400

    item = SimpleNamespace(
        id="i1", family_id="f1", grocery_list_id="l1", posted_transaction_id=None,
        name="Cola", category="DRINK", quantity=Decimal("1"), unit="pcs",
        estimated_price=Decimal("2"), actual_price=Decimal("2"),
        vendor_name=None, barcode="123", mobile_sync_key=None, sync_version=1,
        last_client_updated_at=None, is_bought=True, note=None,
        created_at=None, updated_at=None,
    )
    db = Db(query_map={GroceryItem: Query(rows=[item])})
    out = gr.grocery_barcode_lookup("f1", "123", db=db, current_user=SimpleNamespace(id="u1"))
    assert out["found"] is True
    assert out["latest"]["name"] == "Cola"


def test_grocery_price_history_and_vendor_summary(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryItem

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: None)
    row = SimpleNamespace(
        id="i1", name="Rice", category="FOOD", quantity=Decimal("1"), unit="kg",
        actual_price=Decimal("50"), vendor_name="Shop", barcode=None, updated_at=None,
    )
    db = Db(query_map={GroceryItem: Query(rows=[row])})
    history = gr.grocery_price_history(
        "f1", name=" Rice ", db=db, current_user=SimpleNamespace(id="u1"),
    )
    assert history[0]["name"] == "Rice"

    db2 = AggregateDb(aggregate_results=[[("Shop", 3, Decimal("150"))]])
    summary = gr.grocery_vendor_summary("f1", db=db2, current_user=SimpleNamespace(id="u1"))
    assert summary[0]["vendor_name"] == "Shop"
    assert summary[0]["bought_count"] == 3


def test_grocery_activity_and_collaboration(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.audit_log import AuditLog
    from app.models.grocery import GroceryList, GroceryItem

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: None)
    audit = SimpleNamespace(
        id="a1", action_type="CREATE", entity_type="GROCERY_LIST",
        entity_id="l1", title="List", description="Weekly",
        member_id="m1", created_at=datetime(2026, 1, 1),
    )
    db = Db(query_map={AuditLog: Query(rows=[audit])})
    activity = gr.grocery_activity("f1", limit=10, db=db, current_user=SimpleNamespace(id="u1"))
    assert activity[0]["entity_type"] == "GROCERY_LIST"

    # collaboration uses func.count(...) aggregate queries
    db2 = AggregateDb(aggregate_results=[2, 5, 1])
    status = gr.grocery_collaboration_status("f1", db=db2, current_user=SimpleNamespace(id="u1"))
    assert status["open_lists"] == 2
    assert status["pending_items"] == 5
    assert status["mode"] == "websocket+polling"


def test_grocery_ocr_parse_paths(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.schemas.grocery import GroceryOcrParseRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: None)

    with pytest.raises(HTTPException) as exc:
        gr.grocery_ocr_parse(
            GroceryOcrParseRequest(family_id="f1", raw_text="  "),
            db=Db(), current_user=SimpleNamespace(id="u1"),
        )
    assert exc.value.status_code == 422

    monkeypatch.setattr(
        "app.services.ocr_service.grocery_ocr_parse",
        lambda **kw: {"items": [{"name": "Milk"}], "raw": kw.get("raw_text")},
    )
    out = gr.grocery_ocr_parse(
        GroceryOcrParseRequest(family_id="f1", raw_text="Milk 2L"),
        db=Db(), current_user=SimpleNamespace(id="u1"),
    )
    assert out["family_id"] == "f1"
    assert out["items"][0]["name"] == "Milk"
