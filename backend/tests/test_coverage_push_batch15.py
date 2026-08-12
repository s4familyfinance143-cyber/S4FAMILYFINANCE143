"""Batch-15 coverage push: family_governance_hardened, grocery, life_planner,
transactions, loans, recurring, savings — mock-only endpoint + helper tests.

Does not duplicate batch10–13 cases.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import Column, Integer, MetaData, String, Table


# ---------------------------------------------------------------------------
# Shared Query / Db helpers (same pattern as batch2 / batch12 / batch13)
# ---------------------------------------------------------------------------


class Query:
    def __init__(self, rows=None, first_row=None, first_queue=None, count_value=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)
        self._first_queue = list(first_queue) if first_queue is not None else None
        self._count = count_value

    def filter(self, *args, **kwargs):
        return self

    def filter_by(self, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def group_by(self, *args, **kwargs):
        return self

    def with_for_update(self, *args, **kwargs):
        return self

    def scalar(self):
        row = self._first
        if isinstance(row, tuple):
            return row[0] if len(row) == 1 else row
        return row

    def all(self):
        return list(self.rows)

    def first(self):
        if self._first_queue is not None:
            return self._first_queue.pop(0) if self._first_queue else None
        return self._first

    def count(self):
        if self._count is not None:
            return self._count
        return len(self.rows)


class Db:
    def __init__(self, query_map=None, got=None, execute_results=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.execute_results = list(execute_results or [])
        self.executed = []
        self.added = []
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
        result.all.return_value = []
        result.scalar.return_value = 0
        result.inserted_primary_key = ["id-1"]
        return result

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

    def rollback(self):
        self.rollback_count += 1

    def get_bind(self):
        return self._bind


def _ns(**kwargs):
    return SimpleNamespace(**kwargs)


def _user(uid="u1"):
    return SimpleNamespace(id=uid, email="u@example.com", is_active=True)


def _member(mid="m1", role="OWNER"):
    return SimpleNamespace(id=mid, family_id="f1", user_id="u1", role=role, status="ACTIVE", deleted_at=None)


def _run(coro):
    return asyncio.run(coro)


def _mapping_result(row):
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    result.all.return_value = []
    return result


def _mapping_all_result(rows):
    result = MagicMock()
    result.mappings.return_value.all.return_value = rows
    result.mappings.return_value.first.return_value = rows[0] if rows else None
    result.all.return_value = []
    return result


def _all_result(rows):
    result = MagicMock()
    result.all.return_value = rows
    result.mappings.return_value.first.return_value = None
    result.mappings.return_value.all.return_value = []
    return result


def _mock_phase5b_inspector(monkeypatch, mod, table_names=None, column_map=None):
    inspector = MagicMock()
    inspector.get_table_names.return_value = table_names or [
        "family_members",
        "member_permissions",
        "audit_logs",
    ]
    default_cols = [
        {"name": "id"},
        {"name": "family_id"},
        {"name": "user_id"},
        {"name": "role"},
        {"name": "deleted_at"},
        {"name": "permission_key"},
        {"name": "allow"},
        {"name": "scope"},
        {"name": "created_at"},
        {"name": "updated_at"},
        {"name": "member_id"},
    ]

    def _cols(table):
        if column_map and table in column_map:
            return column_map[table]
        return default_cols

    inspector.get_columns.side_effect = _cols
    monkeypatch.setattr(mod, "_phase5b_inspect", lambda bind: inspector)
    return inspector


def _wallet(**kwargs):
    data = dict(
        id="w1",
        family_id="f1",
        deleted_at=None,
        is_active=True,
        owner_member_id="m1",
        is_shared_family=True,
        is_owner_wallet=False,
        currency="BDT",
        current_balance=Decimal("5000"),
        name="Cash",
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _loan(**kwargs):
    data = dict(
        id="l1",
        family_id="f1",
        owner_member_id="m1",
        wallet_account_id="w1",
        loan_type="GIVEN",
        person_name="Alice",
        principal_amount=Decimal("1000"),
        paid_amount=Decimal("0"),
        remaining_amount=Decimal("1000"),
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
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _goal(**kwargs):
    data = dict(
        id="g1",
        family_id="f1",
        owner_member_id="m1",
        wallet_account_id="w1",
        name="Emergency",
        goal_type="GENERAL",
        target_amount=Decimal("5000"),
        current_amount=Decimal("0"),
        currency="BDT",
        status="ACTIVE",
        note=None,
        deleted_at=None,
        created_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _glist(**kwargs):
    data = dict(
        id="gl1",
        family_id="f1",
        name="Weekly",
        status="OPEN",
        budget_amount=Decimal("100"),
        currency="BDT",
        vendor_name=None,
        shopping_date=None,
        mobile_sync_key="k1",
        sync_version=1,
        last_client_updated_at=None,
        note=None,
        created_at=None,
        updated_at=None,
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _gitem(**kwargs):
    data = dict(
        id="gi1",
        family_id="f1",
        grocery_list_id="gl1",
        posted_transaction_id=None,
        name="Rice",
        category="FOOD",
        quantity=Decimal("1"),
        unit="kg",
        estimated_price=Decimal("50"),
        actual_price=Decimal("0"),
        vendor_name=None,
        barcode=None,
        mobile_sync_key=None,
        sync_version=1,
        last_client_updated_at=None,
        is_bought=False,
        note=None,
        created_at=None,
        updated_at=None,
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _gvendor(**kwargs):
    data = dict(
        id="gv1",
        family_id="f1",
        name="Market",
        phone="123",
        address="Addr",
        category="GENERAL",
        note=None,
        is_active=True,
        created_at=None,
        updated_at=None,
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _task(**kwargs):
    data = dict(
        id="t1",
        family_id="f1",
        created_by_member_id="m1",
        assigned_to_member_id=None,
        title="Pay bills",
        description=None,
        due_date=None,
        priority="MEDIUM",
        status="OPEN",
        reminder_at=None,
        created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        updated_at=None,
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _event(**kwargs):
    data = dict(
        id="e1",
        family_id="f1",
        created_by_member_id="m1",
        title="Birthday",
        description=None,
        event_date=date(2026, 8, 12),
        start_time=None,
        end_time=None,
        event_type="GENERAL",
        status="SCHEDULED",
        reminder_at=None,
        created_at=None,
        updated_at=None,
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


def _recurring(**kwargs):
    data = dict(
        id="r1",
        family_id="f1",
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
        deleted_at=None,
    )
    data.update(kwargs)
    return SimpleNamespace(**data)


# ===========================================================================
# family_governance_hardened — remaining helpers + endpoints
# ===========================================================================


def test_fg_pk_name_fallbacks_and_first_col_missing():
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    with_id = Table("t_id", metadata, Column("id", String), Column("name", String))
    assert fg.pk_name(with_id) == "id"

    no_id = Table("t_code", metadata, Column("code", String), Column("name", String))
    assert fg.pk_name(no_id) == "code"
    assert fg.first_col(no_id, ["missing", "nope"]) is None


def test_fg_default_value_remaining_branches():
    from app.api.v1 import family_governance_hardened as fg

    col_exp = SimpleNamespace(name="expires_at", type=SimpleNamespace(python_type=datetime))
    assert fg.default_value(col_exp, {"expires_in_days": 3}) is not None

    col_del = SimpleNamespace(name="is_deleted", type=SimpleNamespace(python_type=bool))
    assert fg.default_value(col_del, {}) is False

    col_ns = SimpleNamespace(name="needs_serial", type=SimpleNamespace(python_type=bool))
    assert fg.default_value(col_ns, {"needs_serial": True}) is True

    col_tz = SimpleNamespace(name="timezone", type=SimpleNamespace(python_type=str))
    assert fg.default_value(col_tz, {}) == "Asia/Dhaka"

    col_grp = SimpleNamespace(name="group_name", type=SimpleNamespace(python_type=str))
    assert fg.default_value(col_grp, {}) == "FAMILY"

    col_float = SimpleNamespace(name="rate", type=SimpleNamespace(python_type=float))
    assert fg.default_value(col_float, {}) == 0.0

    col_sort = SimpleNamespace(name="sort_order", type=SimpleNamespace(python_type=str))
    assert fg.default_value(col_sort, {}) == 0

    col_ctx = SimpleNamespace(name="custom", type=SimpleNamespace(python_type=str))
    assert fg.default_value(col_ctx, {"custom": "hit"}) == "hit"


def test_fg_insert_dynamic_and_fetch_query_helpers():
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    tbl = Table(
        "sample",
        metadata,
        Column("id", String, primary_key=True),
        Column("name", String, nullable=False),
    )
    db = Db()
    pk = fg.insert_dynamic(db, tbl, {"id": "x1", "name": "N"})
    assert pk == "x1"
    assert db.executed

    db2 = Db(execute_results=[_mapping_result({"id": "x1", "name": "N"})])
    assert fg.fetch_by_id(db2, tbl, "x1")["name"] == "N"

    db3 = Db(execute_results=[_mapping_result(None)])
    assert fg.fetch_by_id(db3, tbl, "missing") is None

    db4 = Db(execute_results=[_mapping_all_result([{"id": "1"}, {"id": "2"}])])
    assert len(fg.query_all(db4, tbl, [tbl.c.id == "1"])) == 2


def test_fg_relationship_and_permission_none_tables():
    from app.api.v1 import family_governance_hardened as fg

    assert fg.get_or_create_relationship(Db(), None, "Brother") is None
    fg.create_default_permissions(Db(), "f1", "m1", "u1", {"permissions": None}, "OWNER")
    assert fg.relationship_needs_serial(Db(), "r1", {"relationships": None}) is False
    fg.mark_relationship_type_needs_serial(Db(), "r1", {"relationships": None})
    fg.assert_relationship_serial_available(Db(), "f1", "r1", None, {})


def test_fg_is_owner_and_require_member_owner_bypass(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    fam = Table(
        "families",
        metadata,
        Column("id", String, primary_key=True),
        Column("owner_user_id", String),
    )
    mem = Table(
        "family_members",
        metadata,
        Column("id", String, primary_key=True),
        Column("family_id", String),
        Column("user_id", String),
        Column("role", String),
    )
    t = {"families": fam, "members": mem}
    monkeypatch.setattr(fg, "query_one", lambda db, table, cond: {"id": "f1", "owner_user_id": "u1"})
    assert fg.is_owner(Db(), "f1", "u1", t) is True
    assert fg.is_owner_or_admin(Db(), "f1", "u1", t) is True
    fg.require_family_member(Db(), "f1", "u1", t)


def test_fg_get_invite_by_code_hashes(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    inv = Table(
        "invites",
        metadata,
        Column("id", String, primary_key=True),
        Column("code_hash", String),
    )
    seen = {}

    def _query_one(db, table, conditions):
        seen["called"] = True
        return {"id": "inv-1"}

    monkeypatch.setattr(fg, "query_one", _query_one)
    out = fg.get_invite_by_code(Db(), inv, "s4f-abc")
    assert out["id"] == "inv-1"
    assert seen["called"] is True


def test_fg_generate_invite_missing_table(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    monkeypatch.setattr(
        fg,
        "tables",
        lambda db: {
            "families": None,
            "members": None,
            "invites": None,
            "join_requests": None,
            "relationships": None,
            "permissions": None,
        },
    )
    with pytest.raises(HTTPException) as exc:
        fg.generate_invite_hardened("f1", db=Db(), current_user=_user())
    assert exc.value.status_code == 500


def test_fg_list_my_families_hardened(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    fam = Table("families", metadata, Column("id", String, primary_key=True), Column("name", String))
    mem = Table(
        "family_members",
        metadata,
        Column("id", String, primary_key=True),
        Column("family_id", String),
        Column("user_id", String),
    )
    monkeypatch.setattr(
        fg,
        "tables",
        lambda db: {
            "families": fam,
            "members": mem,
            "invites": None,
            "join_requests": None,
            "relationships": None,
            "permissions": None,
        },
    )
    db = Db(
        execute_results=[
            _all_result([("f1",)]),
            _mapping_result({"id": "f1", "name": "Test Family"}),
        ]
    )
    out = fg.list_my_families_hardened(db=db, current_user=_user())
    assert out["hardened"] is True
    assert out["count"] == 1
    assert out["families"][0]["id"] == "f1"


def test_fg_phase5b_require_permission_denied(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    member = {"id": "m1", "role": "MEMBER"}
    db = Db(execute_results=[_mapping_result(member), _mapping_result(None)])
    with pytest.raises(HTTPException) as exc:
        fg._phase5b_require_permission(db, "f1", _ns(id="u1"), "wallet.delete")
    assert exc.value.status_code == 403
    assert "wallet.delete" in str(exc.value.detail)


def test_fg_phase5b_set_member_permission_not_found(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    owner = {"id": "m-owner", "role": "OWNER"}
    db = Db(execute_results=[_mapping_result(owner), _mapping_result(None)])
    with pytest.raises(HTTPException) as exc:
        fg.phase5b_set_member_permission(
            family_id="f1",
            member_id="missing",
            permission_key="wallet.read",
            payload=fg.Phase5BPermissionSetRequest(allow=True),
            db=db,
            current_user=_ns(id="u1"),
        )
    assert exc.value.status_code == 404


def test_fg_phase5b_set_permission_update_existing(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    monkeypatch.setattr(fg, "_phase5b_now", lambda: "2024-01-01T00:00:00")
    db = Db(
        execute_results=[
            _mapping_result({"id": "p1"}),
            MagicMock(),
            _mapping_result({"id": "p1", "permission_key": "wallet.read", "allow": False, "scope": "FAMILY"}),
        ]
    )
    row = fg._phase5b_set_permission(db, "m1", "wallet.read", allow=False, scope="FAMILY")
    assert row["allow"] is False
    assert db.commit_count == 1


# ===========================================================================
# grocery.py — remaining CRUD / expense / ocr-image paths
# ===========================================================================


def test_grocery_create_and_list_vendors(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryVendor
    from app.schemas.grocery import GroceryVendorCreateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(gr, "_dual_write_vendor", lambda *a, **k: None)
    monkeypatch.setattr(gr, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(gr, "publish_grocery_event", lambda *a, **k: None)

    db = Db()
    out = gr.create_grocery_vendor(
        GroceryVendorCreateRequest(family_id="f1", name="  Corner Shop  ", phone="  "),
        db=db,
        current_user=_user(),
    )
    assert out["name"] == "Corner Shop"
    assert db.commit_count == 1
    assert len(db.added) == 1

    listed = gr.list_grocery_vendors(
        "f1",
        active_only=True,
        db=Db(query_map={GroceryVendor: [_gvendor()]}),
        current_user=_user(),
    )
    assert listed[0]["name"] == "Market"


def test_grocery_update_and_deactivate_vendor(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryVendor
    from app.schemas.grocery import GroceryVendorUpdateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(gr, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(gr, "publish_grocery_event", lambda *a, **k: None)

    vendor = _gvendor()
    db = Db(query_map={GroceryVendor: Query(first_row=vendor)})
    updated = gr.update_grocery_vendor(
        "gv1",
        GroceryVendorUpdateRequest(family_id="f1", name="New Market", is_active=True),
        db=db,
        current_user=_user(),
    )
    assert updated["name"] == "New Market"
    assert vendor.name == "New Market"

    vendor2 = _gvendor()
    out = gr.deactivate_grocery_vendor(
        "gv1",
        GroceryVendorUpdateRequest(family_id="f1", name="Market"),
        db=Db(query_map={GroceryVendor: Query(first_row=vendor2)}),
        current_user=_user(),
    )
    assert vendor2.is_active is False
    assert out["is_active"] is False


def test_grocery_create_list_idempotent_sync_key(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryList
    from app.schemas.grocery import GroceryListCreateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    existing = _glist(name="Existing")
    db = Db(query_map={GroceryList: Query(first_row=existing)})
    out = gr.create_grocery_list(
        GroceryListCreateRequest(family_id="f1", name="Weekly", mobile_sync_key="k1"),
        db=db,
        current_user=_user(),
    )
    assert out["name"] == "Existing"
    assert db.commit_count == 0


def test_grocery_create_list_and_list_lists(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryList
    from app.schemas.grocery import GroceryListCreateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(gr, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(gr, "publish_grocery_event", lambda *a, **k: None)

    db = Db()
    created = gr.create_grocery_list(
        GroceryListCreateRequest(family_id="f1", title=" Weekend Shop "),
        db=db,
        current_user=_user(),
    )
    assert created["name"] == "Weekend Shop"
    assert db.commit_count == 1

    rows = gr.list_grocery_lists(
        "f1",
        status_filter="open",
        db=Db(query_map={GroceryList: [_glist()]}),
        current_user=_user(),
    )
    assert rows[0]["title"] == "Weekly"


def test_grocery_update_and_close_list(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryList
    from app.schemas.grocery import GroceryListUpdateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(gr, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(gr, "publish_grocery_event", lambda *a, **k: None)

    row = _glist()
    updated = gr.update_grocery_list(
        "gl1",
        GroceryListUpdateRequest(family_id="f1", name="Renamed", budget_amount=Decimal("80")),
        db=Db(query_map={GroceryList: Query(first_row=row)}),
        current_user=_user(),
    )
    assert updated["name"] == "Renamed"
    assert row.sync_version == 2

    row2 = _glist()
    closed = gr.close_grocery_list(
        "gl1",
        GroceryListUpdateRequest(family_id="f1"),
        db=Db(query_map={GroceryList: Query(first_row=row2)}),
        current_user=_user(),
    )
    assert row2.status == "CLOSED"
    assert closed["status"] == "CLOSED"


def test_grocery_create_item_and_list_items(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryItem, GroceryList
    from app.schemas.grocery import GroceryItemCreateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(gr, "_dual_write_grocery_item", lambda *a, **k: None)
    monkeypatch.setattr(gr, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(gr, "publish_grocery_event", lambda *a, **k: None)

    db = Db(query_map={GroceryList: Query(first_row=_glist())})
    created = gr.create_grocery_item(
        GroceryItemCreateRequest(family_id="f1", grocery_list_id="gl1", name="Milk"),
        db=db,
        current_user=_user(),
    )
    assert created["name"] == "Milk"
    assert db.commit_count == 1

    items = gr.list_grocery_items(
        "f1",
        "gl1",
        db=Db(query_map={GroceryList: Query(first_row=_glist()), GroceryItem: [_gitem()]}),
        current_user=_user(),
    )
    assert items[0]["name"] == "Rice"


def test_grocery_update_item_and_mark_bought(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryItem
    from app.schemas.grocery import GroceryItemBuyRequest, GroceryItemUpdateRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(gr, "write_audit_log", lambda *a, **k: None)
    monkeypatch.setattr(gr, "publish_grocery_event", lambda *a, **k: None)

    item = _gitem()
    updated = gr.update_grocery_item(
        "gi1",
        GroceryItemUpdateRequest(family_id="f1", name="Basmati", quantity=Decimal("2")),
        db=Db(query_map={GroceryItem: Query(first_row=item)}),
        current_user=_user(),
    )
    assert updated["name"] == "Basmati"
    assert item.sync_version == 2

    item2 = _gitem()
    bought = gr.mark_grocery_item_bought(
        "gi1",
        GroceryItemBuyRequest(family_id="f1", actual_price=Decimal("55"), vendor_name="Shop"),
        db=Db(query_map={GroceryItem: Query(first_row=item2)}),
        current_user=_user(),
    )
    assert item2.is_bought is True
    assert bought["is_bought"] is True
    assert item2.vendor_name == "Shop"


def test_grocery_post_expense_not_bought_and_already_posted(monkeypatch):
    from app.api.v1 import grocery as gr
    from app.models.grocery import GroceryItem
    from app.schemas.grocery import GroceryPostExpenseRequest

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: _member())
    payload = GroceryPostExpenseRequest(family_id="f1", account_id="w1", category_id="c1")

    with pytest.raises(HTTPException) as exc:
        gr.post_grocery_item_expense(
            "gi1",
            payload,
            db=Db(query_map={GroceryItem: Query(first_row=_gitem(is_bought=False))}),
            current_user=_user(),
        )
    assert exc.value.status_code == 400
    assert "bought" in str(exc.value.detail).lower()

    with pytest.raises(HTTPException) as exc2:
        gr.post_grocery_item_expense(
            "gi1",
            payload,
            db=Db(query_map={GroceryItem: Query(first_row=_gitem(is_bought=True, posted_transaction_id="tx1"))}),
            current_user=_user(),
        )
    assert "already posted" in str(exc2.value.detail).lower()


def test_grocery_ocr_parse_image_empty_and_success(monkeypatch):
    from app.api.v1 import grocery as gr

    monkeypatch.setattr(gr, "require_permission", lambda *a, **k: None)

    empty = MagicMock()
    empty.read = AsyncMock(return_value=b"")
    empty.filename = "blank.jpg"
    with pytest.raises(HTTPException) as exc:
        _run(gr.grocery_ocr_parse_image("f1", file=empty, db=Db(), current_user=_user()))
    assert exc.value.status_code == 422

    monkeypatch.setattr(
        "app.services.ocr_service.grocery_ocr_parse",
        lambda **kw: {"items": [{"name": "Oil"}]},
    )
    ok = MagicMock()
    ok.read = AsyncMock(return_value=b"fake-image")
    ok.filename = "receipt.jpg"
    out = _run(gr.grocery_ocr_parse_image("f1", file=ok, db=Db(), current_user=_user()))
    assert out["family_id"] == "f1"
    assert out["filename"] == "receipt.jpg"
    assert out["items"][0]["name"] == "Oil"


# ===========================================================================
# life_planner — remaining calendar / ownership / role paths
# ===========================================================================


def test_lp_complete_and_update_task_success(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import FamilyTask
    from app.schemas.life_planner import TaskUpdateRequest

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    task = _task()
    out = lp.complete_task("t1", "f1", db=Db(query_map={FamilyTask: Query(first_row=task)}), current_user=_user())
    assert out["status"] == "DONE"
    assert task.status == "DONE"

    task2 = _task()
    updated = lp.update_task(
        "t1",
        TaskUpdateRequest(title="Pay rent", priority="high", status="open"),
        "f1",
        db=Db(query_map={FamilyTask: Query(first_row=task2)}),
        current_user=_user(),
    )
    assert updated["title"] == "Pay rent"
    assert updated["priority"] == "HIGH"
    assert updated["status"] == "OPEN"


def test_lp_create_calendar_event(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.schemas.life_planner import CalendarEventCreateRequest

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    db = Db(query_map={FamilyMember: Query(first_row=_member())})
    out = lp.create_calendar_event(
        CalendarEventCreateRequest(family_id="f1", title="  Anniversary  ", event_date=date(2026, 9, 1), event_type="family"),
        db=db,
        current_user=_user(),
    )
    assert out["title"] == "Anniversary"
    assert out["event_type"] == "FAMILY"
    assert out["status"] == "SCHEDULED"
    assert db.commit_count == 1


def test_lp_update_calendar_not_found_and_delete(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import CalendarEvent
    from app.schemas.life_planner import CalendarEventUpdateRequest

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        lp.update_calendar_event(
            "missing",
            CalendarEventUpdateRequest(title="X"),
            "f1",
            db=Db(query_map={CalendarEvent: Query(first_row=None)}),
            current_user=_user(),
        )
    assert exc.value.status_code == 404

    event = _event()
    out = lp.delete_calendar_event(
        "e1",
        "f1",
        db=Db(query_map={CalendarEvent: Query(first_row=event)}),
        current_user=_user(),
    )
    assert out["success"] is True
    assert event.status == "CANCELLED"
    assert event.deleted_at is not None


def test_lp_list_ownership_transfers(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import OwnershipTransferRequest

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    row = _ns(
        id="tr1",
        family_id="f1",
        from_member_id="m1",
        to_member_id="m2",
        status="PENDING_ACCEPT",
        note="handover",
        admin_approved_by_member_id="m3",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    rows = lp.list_ownership_transfers(
        "f1",
        db=Db(query_map={OwnershipTransferRequest: [row]}),
        current_user=_user(),
    )
    assert rows[0]["status"] == "PENDING_ACCEPT"
    assert rows[0]["note"] == "handover"


def test_lp_create_ownership_transfer_success(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.models.life_planner import OwnershipTransferRequest
    from app.schemas.life_planner import OwnershipTransferCreateRequest

    owner = _member("m1", "OWNER")
    target = _member("m2", "ADMIN")
    db = Db(
        query_map={
            FamilyMember: Query(first_queue=[owner, target], count_value=0),
            OwnershipTransferRequest: Query(first_row=None),
        }
    )
    out = lp.create_ownership_transfer(
        "f1",
        OwnershipTransferCreateRequest(to_member_id="m2", note="  retiring  "),
        db=db,
        current_user=_user(),
    )
    assert out["status"] == "PENDING_ACCEPT"
    assert out["to_member_id"] == "m2"
    assert db.commit_count == 1


def test_lp_admin_approve_not_admin_and_accept_not_found():
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.models.life_planner import OwnershipTransferRequest

    with pytest.raises(HTTPException) as exc:
        lp.admin_approve_ownership_transfer(
            "f1",
            "tr1",
            db=Db(query_map={FamilyMember: Query(first_row=_member("m1", "MEMBER"))}),
            current_user=_user(),
        )
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc2:
        lp.accept_ownership_transfer(
            "f1",
            "tr1",
            db=Db(
                query_map={
                    FamilyMember: Query(first_row=_member("m2", "ADMIN")),
                    OwnershipTransferRequest: Query(first_row=None),
                }
            ),
            current_user=_user(),
        )
    assert exc2.value.status_code == 404


def test_lp_cancel_transfer_and_set_member_role():
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.models.life_planner import OwnershipTransferRequest
    from app.schemas.life_planner import MemberRoleUpdateRequest

    owner = _member("m1", "OWNER")
    transfer = _ns(
        id="tr1",
        family_id="f1",
        from_member_id="m1",
        to_member_id="m2",
        status="PENDING_ADMIN",
        note=None,
        admin_approved_by_member_id=None,
        created_at=None,
    )
    cancelled = lp.cancel_ownership_transfer(
        "f1",
        "tr1",
        db=Db(
            query_map={
                FamilyMember: Query(first_row=owner),
                OwnershipTransferRequest: Query(first_row=transfer),
            }
        ),
        current_user=_user(),
    )
    assert cancelled["status"] == "CANCELLED"

    target = _member("m2", "MEMBER")
    out = lp.set_member_role(
        "f1",
        "m2",
        MemberRoleUpdateRequest(role="admin"),
        db=Db(query_map={FamilyMember: Query(first_queue=[owner, target])}),
        current_user=_user(),
    )
    assert out["role"] == "ADMIN"
    assert target.role == "ADMIN"


def test_lp_remove_member_not_found_and_deactivate_pending():
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.models.life_planner import OwnershipTransferRequest

    owner = _member("m1", "OWNER")
    with pytest.raises(HTTPException) as exc:
        lp.remove_family_member(
            "f1",
            "missing",
            db=Db(query_map={FamilyMember: Query(first_queue=[owner])}),
            current_user=_user(),
        )
    assert exc.value.status_code == 404

    pending = _ns(id="tr1", status="PENDING_ADMIN")
    with pytest.raises(HTTPException) as exc2:
        lp.deactivate_family(
            "f1",
            db=Db(
                query_map={
                    FamilyMember: Query(first_row=owner),
                    OwnershipTransferRequest: Query(first_row=pending),
                }
            ),
            current_user=_user(),
        )
    assert exc2.value.status_code == 409


# ===========================================================================
# transactions.py — remaining create / list / void paths
# ===========================================================================


def test_tx_can_use_wallet_owner_wallet_and_viewer():
    from app.api.v1 import transactions as tx

    member = SimpleNamespace(id="m2", role="MEMBER")
    viewer = SimpleNamespace(id="m3", role="VIEWER")
    owner_wallet = SimpleNamespace(owner_member_id="x", is_shared_family=False, is_owner_wallet=True)
    other = SimpleNamespace(owner_member_id="x", is_shared_family=False, is_owner_wallet=False)
    assert tx.can_use_wallet(member, owner_wallet) is True
    assert tx.can_use_wallet(viewer, other) is False
    assert tx.can_use_wallet(viewer, SimpleNamespace(owner_member_id="m3", is_shared_family=False, is_owner_wallet=False)) is True


def test_tx_get_category_inactive():
    from app.api.v1 import transactions as tx
    from app.models.category import Category

    cat = SimpleNamespace(id="c1", family_id="f1", deleted_at=None, is_active=False, category_type="EXPENSE")
    db = Db(got=cat)
    with pytest.raises(HTTPException) as exc:
        tx.get_category_or_404(db, "f1", "c1", "EXPENSE")
    assert exc.value.status_code == 400
    assert "inactive" in str(exc.value.detail).lower()


def test_tx_find_duplicate_transfer_none():
    from app.api.v1 import transactions as tx
    from app.models.transaction import Transaction

    db = Db(query_map={Transaction: Query(rows=[])})
    assert (
        tx.find_duplicate_transfer(db, "f1", "m1", "w1", "w2", Decimal("10"), "BDT", "note") is None
    )


def test_tx_create_income_idempotent_replay(monkeypatch):
    from app.api.v1 import transactions as tx
    from app.models.account import Account
    from app.schemas.transaction import IncomeCreateRequest

    existing = _ns(
        id="tx1",
        family_id="f1",
        category_id="c1",
        transaction_type="INCOME",
        amount=Decimal("100"),
        currency="BDT",
        description="salary",
        status="POSTED",
    )
    monkeypatch.setattr(tx, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(tx, "find_by_client_request_id", lambda *a, **k: existing)
    account = _wallet(current_balance=Decimal("200"))
    out = tx.create_income(
        IncomeCreateRequest(
            family_id="f1",
            account_id="w1",
            category_id="c1",
            amount=Decimal("100"),
            client_request_id="req-1",
        ),
        db=Db(query_map={Account: Query(first_row=account)}),
        current_user=_user(),
    )
    assert out["idempotent_replay"] is True
    assert out["id"] == "tx1"


def test_tx_create_expense_insufficient_and_transfer_same_wallet(monkeypatch):
    from app.api.v1 import transactions as tx
    from app.models.account import Account
    from app.schemas.transaction import ExpenseCreateRequest, TransferCreateRequest

    monkeypatch.setattr(tx, "require_permission", lambda *a, **k: _member())
    poor = _wallet(current_balance=Decimal("10"))
    with pytest.raises(HTTPException) as exc:
        tx.create_expense(
            ExpenseCreateRequest(family_id="f1", account_id="w1", category_id="c1", amount=Decimal("100")),
            db=Db(query_map={Account: Query(first_row=poor)}),
            current_user=_user(),
        )
    assert exc.value.status_code == 400
    assert "Insufficient" in str(exc.value.detail)

    with pytest.raises(HTTPException) as exc2:
        tx.create_transfer(
            TransferCreateRequest(
                family_id="f1",
                from_account_id="w1",
                to_account_id="w1",
                amount=Decimal("10"),
            ),
            db=Db(),
            current_user=_user(),
        )
    assert "same wallet" in str(exc2.value.detail).lower()


def test_tx_list_transactions_and_void_not_found(monkeypatch):
    from app.api.v1 import transactions as tx
    from app.models.transaction import Transaction

    monkeypatch.setattr(tx, "require_permission", lambda *a, **k: _member())
    posted = _ns(
        id="tx1",
        family_id="f1",
        category_id="c1",
        loan_id=None,
        goal_id=None,
        transaction_type="EXPENSE",
        amount=Decimal("20"),
        currency="BDT",
        description="food",
        status="POSTED",
        created_at=None,
    )
    voided = _ns(**{**posted.__dict__, "id": "tx2", "status": "VOID"})
    monkeypatch.setattr(
        "app.repositories.transaction_repo",
        lambda db: SimpleNamespace(list_for_family=lambda family_id, limit=200: [posted, voided]),
    )
    rows = tx.list_transactions("f1", db=Db(), current_user=_user())
    assert len(rows) == 1
    assert rows[0]["id"] == "tx1"

    with pytest.raises(HTTPException) as exc:
        tx.void_transaction(
            "missing",
            "f1",
            db=Db(query_map={Transaction: Query(first_row=None)}),
            current_user=_user(),
        )
    assert exc.value.status_code == 404


# ===========================================================================
# loans.py — remaining create / update / history / schedule paths
# ===========================================================================


def test_loans_create_given_insufficient_balance(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.account import Account
    from app.schemas.loan import LoanCreateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    wallet = _wallet(current_balance=Decimal("10"))
    with pytest.raises(HTTPException) as exc:
        mod.create_loan(
            LoanCreateRequest(
                family_id="f1",
                wallet_account_id="w1",
                loan_type="GIVEN",
                person_name="Ali",
                principal_amount=Decimal("100"),
            ),
            db=Db(query_map={Account: Query(first_row=wallet)}),
            current_user=_user(),
        )
    assert "Insufficient" in str(exc.value.detail)


def test_loans_update_not_active_and_close_already_closed(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.loan import Loan
    from app.schemas.loan import LoanCloseRequest, LoanUpdateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    closed = _loan(status="CLOSED", remaining_amount=Decimal("0"))
    with pytest.raises(HTTPException) as exc:
        mod.update_loan(
            "l1",
            LoanUpdateRequest(family_id="f1", person_name="Bob"),
            db=Db(query_map={Loan: Query(first_row=closed)}),
            current_user=_user(),
        )
    assert "active" in str(exc.value.detail).lower()

    with pytest.raises(HTTPException) as exc2:
        mod.close_loan(
            "l1",
            LoanCloseRequest(family_id="f1"),
            db=Db(query_map={Loan: Query(first_row=closed)}),
            current_user=_user(),
        )
    assert "already closed" in str(exc2.value.detail).lower()


def test_loans_history_route(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.loan import Loan
    from app.models.transaction import Transaction

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    tx_row = _ns(
        id="tx1",
        transaction_type="LOAN_PAYMENT",
        amount=Decimal("50"),
        currency="BDT",
        description="installment",
        created_at=None,
        status="POSTED",
    )
    out = mod.loan_history(
        "l1",
        "f1",
        db=Db(query_map={Loan: Query(first_row=_loan()), Transaction: [tx_row]}),
        current_user=_user(),
    )
    assert out["loan"]["id"] == "l1"
    assert out["history"][0]["id"] == "tx1"


def test_loans_generate_schedule_requires_installment_count(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.loan import Loan
    from app.schemas.loan import LoanScheduleGenerateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.generate_loan_schedule(
            "l1",
            LoanScheduleGenerateRequest(family_id="f1"),
            db=Db(query_map={Loan: Query(first_row=_loan(installment_count=None))}),
            current_user=_user(),
        )
    assert "installment_count" in str(exc.value.detail)


def test_loans_payment_exceeds_remaining(monkeypatch):
    from app.api.v1 import loans as mod
    from app.models.account import Account
    from app.models.loan import Loan
    from app.schemas.loan import LoanPaymentRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.loan_payment(
            LoanPaymentRequest(
                family_id="f1",
                loan_id="l1",
                wallet_account_id="w1",
                amount=Decimal("2000"),
            ),
            db=Db(
                query_map={
                    Loan: Query(first_row=_loan(remaining_amount=Decimal("100"))),
                    Account: Query(first_row=_wallet()),
                }
            ),
            current_user=_user(),
        )
    assert "remaining" in str(exc.value.detail).lower()


def test_loans_duplicate_recent_payment_found():
    from app.api.v1 import loans as mod
    from app.models.transaction import Transaction

    dup = _ns(id="tx-dup")
    found = mod.duplicate_recent_payment(
        Db(query_map={Transaction: Query(first_row=dup)}),
        "f1",
        "l1",
        Decimal("50"),
        "BDT",
        "note",
    )
    assert found.id == "tx-dup"


# ===========================================================================
# recurring.py — remaining create / status / history / post paths
# ===========================================================================


def test_recurring_get_helpers_and_monthly_year_wrap():
    from app.api.v1 import recurring as mod
    from app.models.account import Account
    from app.models.recurring import RecurringTransaction

    with pytest.raises(HTTPException) as exc:
        mod.get_recurring(Db(got=None), "missing")
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc2:
        mod.get_wallet(Db(got=None), "f1", "w1", _member())
    assert exc2.value.status_code == 404

    assert mod.get_category(Db(), "f1", None, "EXPENSE") is None
    assert mod.next_due_date(date(2026, 12, 15), "MONTHLY") == date(2027, 1, 15)
    assert mod.next_due_date(date(2026, 1, 31), "YEARLY") == date(2027, 1, 28)


def test_recurring_create_invalid_transaction_type(monkeypatch):
    from app.api.v1 import recurring as mod
    from app.models.account import Account
    from app.schemas.recurring import RecurringCreateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.create_recurring(
            RecurringCreateRequest(
                family_id="f1",
                account_id="w1",
                title="Rent",
                transaction_type="TRANSFER",
                amount=Decimal("10"),
                frequency="MONTHLY",
                start_date=date(2026, 1, 1),
            ),
            db=Db(got=_wallet()),
            current_user=_user(),
        )
    assert "INCOME or EXPENSE" in str(exc.value.detail)


def test_recurring_update_closed_and_resume_not_paused(monkeypatch):
    from app.api.v1 import recurring as mod
    from app.schemas.recurring import RecurringStatusRequest, RecurringUpdateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: _recurring(status="CLOSED"))
    with pytest.raises(HTTPException) as exc:
        mod.update_recurring(
            "r1",
            RecurringUpdateRequest(family_id="f1", title="Rent", amount=Decimal("10"), frequency="MONTHLY"),
            db=Db(),
            current_user=_user(),
        )
    assert "active or paused" in str(exc.value.detail).lower()

    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: _recurring(status="ACTIVE"))
    with pytest.raises(HTTPException) as exc2:
        mod.resume_recurring(
            "r1",
            RecurringStatusRequest(family_id="f1"),
            db=Db(),
            current_user=_user(),
        )
    assert "paused" in str(exc2.value.detail).lower()


def test_recurring_close_already_closed_and_history_mismatch(monkeypatch):
    from app.api.v1 import recurring as mod
    from app.schemas.recurring import RecurringStatusRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: _recurring(status="CLOSED"))
    with pytest.raises(HTTPException) as exc:
        mod.close_recurring(
            "r1",
            RecurringStatusRequest(family_id="f1"),
            db=Db(),
            current_user=_user(),
        )
    assert "already closed" in str(exc.value.detail).lower()

    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: _recurring(family_id="other"))
    with pytest.raises(HTTPException) as exc2:
        mod.recurring_history("r1", "f1", db=Db(), current_user=_user())
    assert exc2.value.status_code == 404


def test_recurring_pause_and_history_success(monkeypatch):
    from app.api.v1 import recurring as mod
    from app.models.transaction import Transaction
    from app.schemas.recurring import RecurringStatusRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    item = _recurring(status="ACTIVE")
    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: item)
    paused = mod.pause_recurring(
        "r1",
        RecurringStatusRequest(family_id="f1"),
        db=Db(),
        current_user=_user(),
    )
    assert paused["status"] == "PAUSED"

    item2 = _recurring()
    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: item2)
    tx_row = _ns(
        id="tx1",
        transaction_type="EXPENSE",
        amount=Decimal("1000"),
        currency="BDT",
        description="monthly rent",
        created_at=None,
        status="POSTED",
    )
    hist = mod.recurring_history(
        "r1",
        "f1",
        db=Db(query_map={Transaction: [tx_row]}),
        current_user=_user(),
    )
    assert hist["history"][0]["id"] == "tx1"


def test_recurring_post_not_active(monkeypatch):
    from app.api.v1 import recurring as mod

    monkeypatch.setattr(mod, "get_recurring", lambda db, rid: _recurring(status="PAUSED"))
    with pytest.raises(HTTPException) as exc:
        mod.post_recurring("r1", db=Db(), current_user=_user())
    assert "not active" in str(exc.value.detail).lower()


# ===========================================================================
# savings.py — remaining create / update / history / deposit / withdraw
# ===========================================================================


def test_savings_create_goal(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.account import Account
    from app.schemas.savings import SavingsGoalCreateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    db = Db(query_map={Account: Query(first_row=_wallet())})
    out = mod.create_savings_goal(
        SavingsGoalCreateRequest(
            family_id="f1",
            wallet_account_id="w1",
            name="  Rainy day  ",
            goal_type="emergency_fund",
            target_amount=Decimal("12000"),
        ),
        db=db,
        current_user=_user(),
    )
    assert out["name"] == "Rainy day"
    assert out["goal_type"] == "EMERGENCY"
    assert db.commit_count == 1


def test_savings_update_no_changes_and_blank_name(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.savings import SavingsGoal
    from app.schemas.savings import SavingsGoalUpdateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    goal = _goal()
    with pytest.raises(HTTPException) as exc:
        mod.update_savings_goal(
            "g1",
            SavingsGoalUpdateRequest(family_id="f1"),
            db=Db(query_map={SavingsGoal: Query(first_row=goal)}),
            current_user=_user(),
        )
    assert "No changes" in str(exc.value.detail)

    with pytest.raises(HTTPException) as exc2:
        mod.update_savings_goal(
            "g1",
            SavingsGoalUpdateRequest(family_id="f1", name="   "),
            db=Db(query_map={SavingsGoal: Query(first_row=_goal())}),
            current_user=_user(),
        )
    assert "name required" in str(exc2.value.detail).lower()


def test_savings_update_success_and_close_already_closed(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.savings import SavingsGoal
    from app.schemas.savings import SavingsGoalCloseRequest, SavingsGoalUpdateRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    monkeypatch.setattr(mod, "write_audit_log", lambda *a, **k: None)
    goal = _goal()
    updated = mod.update_savings_goal(
        "g1",
        SavingsGoalUpdateRequest(family_id="f1", name="Trip", note="  goa  ", target_amount=Decimal("8000")),
        db=Db(query_map={SavingsGoal: Query(first_row=goal)}),
        current_user=_user(),
    )
    assert updated["name"] == "Trip"
    assert goal.note == "goa"

    with pytest.raises(HTTPException) as exc:
        mod.close_savings_goal(
            "g1",
            SavingsGoalCloseRequest(family_id="f1"),
            db=Db(query_map={SavingsGoal: Query(first_row=_goal(status="CLOSED"))}),
            current_user=_user(),
        )
    assert "already closed" in str(exc.value.detail).lower()


def test_savings_history_route(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: None)
    tx_row = _ns(
        id="tx1",
        transaction_type="SAVINGS_DEPOSIT",
        amount=Decimal("100"),
        currency="BDT",
        description="deposit",
        created_at=None,
        status="POSTED",
    )
    out = mod.savings_history(
        "g1",
        "f1",
        db=Db(query_map={SavingsGoal: Query(first_row=_goal()), Transaction: [tx_row]}),
        current_user=_user(),
    )
    assert out["goal"]["id"] == "g1"
    assert out["history"][0]["id"] == "tx1"


def test_savings_deposit_insufficient_wallet(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.account import Account
    from app.models.savings import SavingsGoal
    from app.schemas.savings import SavingsDepositRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.deposit_to_savings(
            SavingsDepositRequest(
                family_id="f1",
                savings_goal_id="g1",
                from_account_id="w1",
                amount=Decimal("9999"),
            ),
            db=Db(
                query_map={
                    SavingsGoal: Query(first_row=_goal()),
                    Account: Query(first_row=_wallet(current_balance=Decimal("10"))),
                }
            ),
            current_user=_user(),
        )
    assert "Insufficient wallet" in str(exc.value.detail)


def test_savings_withdraw_insufficient_and_currency_mismatch(monkeypatch):
    from app.api.v1 import savings as mod
    from app.models.account import Account
    from app.models.savings import SavingsGoal
    from app.schemas.savings import SavingsWithdrawRequest

    monkeypatch.setattr(mod, "require_permission", lambda *a, **k: _member())
    with pytest.raises(HTTPException) as exc:
        mod.withdraw_from_savings(
            SavingsWithdrawRequest(
                family_id="f1",
                savings_goal_id="g1",
                to_account_id="w1",
                amount=Decimal("50"),
            ),
            db=Db(
                query_map={
                    SavingsGoal: Query(first_row=_goal(current_amount=Decimal("10"))),
                    Account: Query(first_row=_wallet()),
                }
            ),
            current_user=_user(),
        )
    assert "Insufficient savings" in str(exc.value.detail)

    with pytest.raises(HTTPException) as exc2:
        mod.withdraw_from_savings(
            SavingsWithdrawRequest(
                family_id="f1",
                savings_goal_id="g1",
                to_account_id="w1",
                amount=Decimal("10"),
                currency="USD",
            ),
            db=Db(
                query_map={
                    SavingsGoal: Query(first_row=_goal(current_amount=Decimal("100"))),
                    Account: Query(first_row=_wallet(currency="BDT")),
                }
            ),
            current_user=_user(),
        )
    assert "Wallet currency" in str(exc2.value.detail)
