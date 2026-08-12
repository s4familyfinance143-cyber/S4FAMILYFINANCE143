"""Batch-4 coverage push: hardened phase helpers, API utilities, governance."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Column, Integer, MetaData, String, Table, text
from starlette.requests import Request


class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def with_for_update(self, *args, **kwargs):
        return self

    def scalar(self):
        row = self._first
        return row if not hasattr(row, "__getitem__") else row

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first


class Db:
    def __init__(self, query_map=None, got=None, execute_results=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.execute_results = list(execute_results or [])
        self.executed = []
        self.commit_count = 0
        self.rollback_count = 0
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
        result.fetchall.return_value = []
        return result

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def get_bind(self):
        return self._bind


def _mapping_result(row):
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    return result


def _rows_result(rows):
    result = MagicMock()
    row_mocks = []
    for row in rows:
        m = MagicMock()
        m._mapping = row
        row_mocks.append(m)
    result.fetchall.return_value = row_mocks
    return result


# ---------------------------------------------------------------------------
# Phase 9B audit trail hardened helpers
# ---------------------------------------------------------------------------


def test_phase9b_quote_and_json_helpers():
    from app.api.v1 import audit_trail_hardened as mod

    assert mod._phase9b_q('col"name') == '"col""name"'
    assert mod._phase9b_json(Decimal("1.5")) == 1.5
    ts = datetime(2024, 3, 1, 12, 0, tzinfo=timezone.utc)
    assert mod._phase9b_json(ts) == ts.isoformat()
    assert mod._phase9b_json(b"hello") == "hello"
    nested = mod._phase9b_json({"a": [Decimal("2"), {"b": datetime(2024, 1, 1)}]})
    assert nested["a"][0] == 2.0
    assert "2024" in nested["a"][1]["b"]

    cols = {"Created_At": {}, "other": {}}
    assert mod._phase9b_first(cols, ["created_at", "missing"]) == "Created_At"
    assert mod._phase9b_first({"x": {}}, ["y"]) is None

    result = _rows_result([{"id": 1}, {"id": 2}])
    assert mod._phase9b_rows(result) == [{"id": 1}, {"id": 2}]


def test_phase9b_tables_and_columns(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["audit_logs", "families"]
    inspector.get_columns.return_value = [{"name": "id"}, {"name": "family_id"}]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    db = Db()
    assert mod._phase9b_tables(db) == {"audit_logs", "families"}
    assert mod._phase9b_columns(db, "audit_logs") == {"id": {"name": "id"}, "family_id": {"name": "family_id"}}
    assert mod._phase9b_columns(db, "missing") == {}


def test_phase9b_require_any_permission(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    user = SimpleNamespace(id="u1")

    def allow(db, family_id, current_user, permission):
        if permission == "report.read":
            return SimpleNamespace(id="m1")
        raise HTTPException(status_code=403, detail="denied")

    monkeypatch.setattr(mod, "_phase5b_require_permission", allow)
    db = Db()
    out = mod._phase9b_require_any_permission(db, "fam1", user, ["transaction.create", "report.read"])
    assert out.id == "m1"

    def always_deny(*args, **kwargs):
        raise HTTPException(status_code=403, detail="denied")

    monkeypatch.setattr(mod, "_phase5b_require_permission", always_deny)
    with pytest.raises(HTTPException) as exc:
        mod._phase9b_require_any_permission(db, "fam1", user, ["a", "b"])
    assert exc.value.status_code == 403

    def server_error(*args, **kwargs):
        raise HTTPException(status_code=500, detail="boom")

    monkeypatch.setattr(mod, "_phase5b_require_permission", server_error)
    with pytest.raises(HTTPException) as exc:
        mod._phase9b_require_any_permission(db, "fam1", user, ["a"])
    assert exc.value.status_code == 500


def test_phase9b_get_current_member_id():
    from app.api.v1 import audit_trail_hardened as mod

    db = Db(query_map={mod.FamilyMember.id: Query(first_row="mem-99")})
    assert mod._phase9b_get_current_member_id(db, "fam", SimpleNamespace(id="u1")) == "mem-99"
    assert mod._phase9b_get_current_member_id(db, "fam", SimpleNamespace()) is None


def test_phase9b_audit_columns_or_500(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = []
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)
    db = Db()
    with pytest.raises(HTTPException) as exc:
        mod._phase9b_audit_columns_or_500(db)
    assert exc.value.status_code == 500


# ---------------------------------------------------------------------------
# Phase 10B offline sync hardened helpers
# ---------------------------------------------------------------------------


def test_phase10b_json_and_load_helpers():
    from app.api.v1 import offline_sync_hardened as mod

    assert mod.SYNC_TABLES == [
        "sync_devices",
        "sync_state",
        "sync_outbox",
        "sync_inbox",
        "sync_conflicts",
    ]
    token = mod._phase10b_now_token()
    assert token.endswith("Z")
    assert mod._phase10b_q('a"b') == '"a""b"'
    assert mod._phase10b_json(Decimal("3.14")) == 3.14
    payload = {"x": [datetime(2024, 6, 1)]}
    text_val = mod._phase10b_json_text(payload)
    assert "2024-06-01" in text_val
    assert mod._phase10b_load_json(None) is None
    assert mod._phase10b_load_json({"k": 1}) == {"k": 1}
    assert mod._phase10b_load_json('{"a": 1}') == {"a": 1}
    assert mod._phase10b_load_json("not-json") == "not-json"


def test_phase10b_require_any_permission(monkeypatch):
    from app.api.v1 import offline_sync_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: SimpleNamespace(ok=True),
    )
    out = mod._phase10b_require_any_permission(Db(), "f", SimpleNamespace(id="u"), ["sync"])
    assert out.ok is True

    with pytest.raises(HTTPException):
        mod._phase10b_require_any_permission(Db(), "f", SimpleNamespace(id="u"), [])


# ---------------------------------------------------------------------------
# Phase 7B double-entry transactions hardened helpers
# ---------------------------------------------------------------------------


def test_phase7b_money_and_jsonable():
    from app.api.v1 import double_entry_transactions_hardened as mod

    assert mod._phase7b_money(None) == Decimal("0.00")
    assert mod._phase7b_money("12.345") == Decimal("12.34")
    assert mod._phase7b_bind_money("1.2") == "1.20"

    row = {"amount": Decimal("10"), "when": datetime(2024, 1, 1), "note": "x"}
    out = mod._phase7b_jsonable(row)
    assert out["amount"] == "10"
    assert out["when"] == "2024-01-01T00:00:00"
    assert out["note"] == "x"


def test_phase7b_pick_and_column_helpers():
    from app.api.v1 import double_entry_transactions_hardened as mod

    cols = ["id", "family_id", "description", "deleted_at", "is_deleted"]
    where = mod._phase7b_base_where(cols)
    assert "family_id = :family_id" in where
    assert "deleted_at IS NULL" in where
    assert "is_deleted = 0" in where

    assert mod._phase7b_pick(cols, ["memo", "description"]) == "description"
    assert mod._phase7b_tx_description_col(cols) == "description"
    assert mod._phase7b_tx_date_col(cols) is None or mod._phase7b_tx_date_col(["transaction_date"]) == "transaction_date"


def test_phase7b_required_default():
    from app.api.v1 import double_entry_transactions_hardened as mod

    assert mod._phase7b_required_default({"name": "created_at", "type": "DATETIME"}) != ""
    assert mod._phase7b_required_default({"name": "is_active", "type": "BOOLEAN"}) is False
    assert mod._phase7b_required_default({"name": "sort_order", "type": "INTEGER"}) == 0
    assert mod._phase7b_required_default({"name": "amount", "type": "NUMERIC"}) == "0"
    assert mod._phase7b_required_default({"name": "status", "type": "VARCHAR"}) == "POSTED"
    code = mod._phase7b_required_default({"name": "invoice_number", "type": "VARCHAR"}, "TX")
    assert code.startswith("TX-")


def test_phase7b_validate_lines_errors(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase7b_account_row",
        lambda db, family_id, account_id: {"id": account_id, "is_active": True},
    )

    with pytest.raises(HTTPException) as exc:
        mod._phase7b_validate_lines(Db(), "fam", [mod.Phase7BTransactionLine(account_id="a", debit=1, credit=0)])
    assert exc.value.status_code == 422

    lines = [
        mod.Phase7BTransactionLine(account_id="a1", debit=10, credit=0),
        mod.Phase7BTransactionLine(account_id="a2", debit=0, credit=5),
    ]
    with pytest.raises(HTTPException) as exc:
        mod._phase7b_validate_lines(Db(), "fam", lines)
    assert "Unbalanced" in exc.value.detail

    bad = mod.Phase7BTransactionLine(account_id="a", debit=5, credit=5)
    with pytest.raises(HTTPException):
        mod._phase7b_validate_lines(Db(), "fam", [bad, bad])

    neg = mod.Phase7BTransactionLine(account_id="a", debit=-1, credit=0)
    with pytest.raises(HTTPException):
        mod._phase7b_validate_lines(Db(), "fam", [neg, neg])


def test_phase7b_validate_lines_balanced(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase7b_account_row",
        lambda db, family_id, account_id: {"id": account_id},
    )
    lines = [
        mod.Phase7BTransactionLine(account_id="a1", debit=100, credit=0),
        mod.Phase7BTransactionLine(account_id="a2", debit=0, credit=100),
    ]
    debit, credit = mod._phase7b_validate_lines(Db(), "fam", lines)
    assert debit == credit == Decimal("100.00")


def test_phase7b_table_and_tx_required(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["transactions", "transaction_lines", "accounts"]
    inspector.get_columns.side_effect = lambda table: {
        "transactions": [{"name": c} for c in ["id", "family_id", "description"]],
        "transaction_lines": [{"name": c} for c in ["id", "transaction_id", "account_id", "debit", "credit"]],
        "accounts": [{"name": c} for c in ["id", "family_id"]],
    }[table]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    db = Db()
    tx_cols, line_cols = mod._phase7b_tx_required(db)
    assert "id" in tx_cols
    assert "transaction_id" in line_cols
    assert mod._phase7b_account_cols(db) == ["id", "family_id"]

    inspector.get_columns.side_effect = lambda table: [{"name": "id"}]
    with pytest.raises(HTTPException):
        mod._phase7b_tx_required(db)


# ---------------------------------------------------------------------------
# Phase 8B reports audit integration helpers
# ---------------------------------------------------------------------------


def test_phase8b_date_filters_and_status():
    from app.api.v1 import reports_audit_integration_hardened as mod

    tx_cols = {"transaction_date": {}, "status": {}}
    filters, params = mod._phase8b_date_filters(tx_cols, "2024-01-01", "2024-12-31")
    assert len(filters) == 2
    assert params["start_date"] == "2024-01-01"
    assert params["end_date"] == "2024-12-31"

    status = mod._phase8b_status_filter(tx_cols)
    assert status is not None
    assert "POSTED" in status
    assert mod._phase8b_status_filter({}) is None


def test_phase8b_valid_transaction_subquery():
    from app.api.v1 import reports_audit_integration_hardened as mod

    tx_cols = {"id": {}, "family_id": {}, "transaction_date": {}, "status": {}}
    line_cols = {"transaction_id": {}, "debit": {}, "credit": {}}
    sql, params = mod._phase8b_valid_transaction_subquery(tx_cols, line_cols, "2024-01-01", None)
    assert "transaction_lines" in sql
    assert "HAVING COUNT(*) >= 2" in sql
    assert params["start_date"] == "2024-01-01"

    with pytest.raises(HTTPException):
        mod._phase8b_valid_transaction_subquery({"id": {}}, {}, None, None)


def test_phase8b_json_quote_rows():
    from app.api.v1 import reports_audit_integration_hardened as mod

    assert mod._phase8b_q("x") == '"x"'
    assert mod._phase8b_json([Decimal("1")]) == [1.0]
    result = _rows_result([{"a": 1}])
    assert mod._phase8b_rows(result) == [{"a": 1}]


# ---------------------------------------------------------------------------
# Family governance hardened pure helpers
# ---------------------------------------------------------------------------


def test_governance_hash_and_clean():
    from app.api.v1 import family_governance_hardened as fg

    h1 = fg.hash_invite_code("  abc123  ")
    h2 = fg.hash_invite_code("ABC123")
    assert h1 == h2
    assert len(h1) == 64

    class EnumLike:
        value = "MEMBER"

    assert fg.clean(EnumLike()) == "MEMBER"
    assert fg.clean("plain") == "plain"


def test_governance_table_helpers():
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    families = Table(
        "families",
        metadata,
        Column("id", String, primary_key=True),
        Column("name", String),
    )
    members = Table(
        "family_members",
        metadata,
        Column("member_id", Integer, primary_key=True),
        Column("family_id", String),
    )

    assert fg.find_table(metadata, ["families"], ["famil"]) is families
    assert fg.optional_table(metadata, ["missing"], ["nope"]) is None
    assert fg.pk_name(families) == "id"
    assert fg.pk_name(members) == "member_id"
    assert fg.has(families, "name") is True
    assert fg.first_col(families, ["missing", "name"]) == "name"

    with pytest.raises(HTTPException):
        fg.find_table(MetaData(), ["nope"], ["zzz"])


def test_governance_default_value_branches():
    from app.api.v1 import family_governance_hardened as fg

    col_id = SimpleNamespace(name="id", type=SimpleNamespace(python_type=str))
    assert fg.default_value(col_id, {})  # uuid string

    col_at = SimpleNamespace(name="created_at", type=SimpleNamespace(python_type=datetime))
    assert fg.default_value(col_at, {}) is not None

    col_bool = SimpleNamespace(name="is_active", type=SimpleNamespace(python_type=bool))
    assert fg.default_value(col_bool, {}) is True

    col_curr = SimpleNamespace(name="default_currency", type=SimpleNamespace(python_type=str))
    assert fg.default_value(col_curr, {"default_currency": "USD"}) == "USD"

    col_count = SimpleNamespace(name="used_count", type=SimpleNamespace(python_type=int))
    assert fg.default_value(col_count, {}) == 0


def test_governance_normalize_decision_and_serial():
    from app.api.v1 import family_governance_hardened as fg

    assert fg.normalize_decision("approve") == "APPROVED"
    assert fg.normalize_decision("REJECTED") == "REJECTED"
    assert fg.normalize_decision("decline") == "REJECTED"
    with pytest.raises(HTTPException):
        fg.normalize_decision("maybe")

    assert fg.normalize_relationship_serial(None, False) is None
    assert fg.normalize_relationship_serial("2", True) == 2
    with pytest.raises(HTTPException):
        fg.normalize_relationship_serial(None, True)
    with pytest.raises(HTTPException):
        fg.normalize_relationship_serial("x", True)
    with pytest.raises(HTTPException):
        fg.normalize_relationship_serial(0, True)


def test_governance_family_response_and_user_id():
    from app.api.v1 import family_governance_hardened as fg

    row = {"id": "f1", "name": "Test"}
    resp = fg.family_response(row)
    assert resp["hardened"] is True
    assert resp["family_id"] == "f1"

    user = SimpleNamespace(id="user-abc")
    assert fg.user_id_value(user) == "user-abc"


def test_governance_join_decision_validator():
    from app.api.v1 import family_governance_hardened as fg

    req = fg.JoinDecisionRequest(action="approve", note="looks good")
    assert req.decision == "approve"
    assert req.reason == "looks good"

    with pytest.raises(ValidationError):
        fg.JoinDecisionRequest()


def test_governance_row_first():
    from app.api.v1 import family_governance_hardened as fg

    row = {"a": 1, "b": 2}
    assert fg.row_first(row, ["c", "b"]) == 2
    assert fg.row_first(row, ["z"]) is None


def test_phase5b_user_and_bool_helpers():
    from app.api.v1 import family_governance_hardened as fg

    assert fg._phase5b_user_id({"user_id": "u1"}) == "u1"
    assert fg._phase5b_user_id(SimpleNamespace(sub="s1")) == "s1"
    with pytest.raises(HTTPException):
        fg._phase5b_user_id({})

    assert fg._phase5b_bool(True) is True
    assert fg._phase5b_bool(0) is False
    assert fg._phase5b_bool(1) is True
    assert fg._phase5b_bool("yes") is True
    assert fg._phase5b_is_owner({"role": "OWNER"}) is True
    assert fg._phase5b_is_owner({"role": "MEMBER"}) is False
    assert fg._phase5b_is_owner(None) is False


def test_phase5b_member_lookup(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["family_members"]
    inspector.get_columns.return_value = [
        {"name": "id"},
        {"name": "family_id"},
        {"name": "user_id"},
        {"name": "role"},
        {"name": "deleted_at"},
    ]
    monkeypatch.setattr(fg, "_phase5b_inspect", lambda bind: inspector)

    member_row = {"id": "m1", "family_id": "f1", "user_id": "u1", "role": "MEMBER"}
    db = Db(execute_results=[_mapping_result(member_row)])
    out = fg._phase5b_member_for_user(db, "f1", "u1")
    assert out["id"] == "m1"

    db2 = Db(execute_results=[_mapping_result(None)])
    assert fg._phase5b_member_for_user(db2, "f1", "u1") is None


# ---------------------------------------------------------------------------
# transactions.py helpers
# ---------------------------------------------------------------------------


def test_transactions_money_and_text_helpers():
    from app.api.v1 import transactions as tx

    assert tx.money("10.12345") == "10.1235"
    assert tx.clean_text("  hi ") == "hi"
    assert tx.clean_text("   ") is None
    assert tx.clean_text(None) is None
    assert tx.normalize_currency(" usd ") == "USD"
    assert tx.normalize_currency(None) == "BDT"

    with pytest.raises(HTTPException):
        tx.normalize_currency("X")
    with pytest.raises(HTTPException):
        tx.validate_amount("-5")
    with pytest.raises(HTTPException):
        tx.validate_amount("not-a-number")
    with pytest.raises(HTTPException):
        tx.validate_amount("9999999999999")

    amt = tx.validate_amount("100.50")
    assert amt == Decimal("100.5000")


def test_transactions_wallet_access():
    from app.api.v1 import transactions as tx
    from app.models.account import Account
    from app.models.family_member import FamilyMember

    owner = SimpleNamespace(id="m1", role="OWNER")
    member = SimpleNamespace(id="m2", role="MEMBER")
    wallet_own = SimpleNamespace(owner_member_id="m2", is_shared_family=False, is_owner_wallet=False)
    wallet_shared = SimpleNamespace(owner_member_id="x", is_shared_family=True, is_owner_wallet=False)
    wallet_other = SimpleNamespace(owner_member_id="x", is_shared_family=False, is_owner_wallet=False)

    assert tx.can_use_wallet(owner, wallet_other) is True
    assert tx.can_use_wallet(member, wallet_own) is True
    assert tx.can_use_wallet(member, wallet_shared) is True
    assert tx.can_use_wallet(member, wallet_other) is False

    tx.require_wallet_access(member, wallet_shared)
    with pytest.raises(HTTPException):
        tx.require_wallet_access(member, wallet_other)

    tx.require_same_currency("BDT", "bdt")
    with pytest.raises(HTTPException):
        tx.require_same_currency("BDT", "USD")


def test_transactions_get_account_and_category():
    from app.api.v1 import transactions as tx
    from app.models.account import Account
    from app.models.category import Category

    active = SimpleNamespace(
        id="a1",
        family_id="f1",
        deleted_at=None,
        is_active=True,
    )
    db = Db(query_map={Account: Query(first_row=active)})
    assert tx.get_account_or_404(db, "f1", "a1").id == "a1"

    db_empty = Db(query_map={Account: Query(first_row=None)})
    with pytest.raises(HTTPException):
        tx.get_account_or_404(db_empty, "f1", "missing")

    inactive = SimpleNamespace(id="a1", family_id="f1", deleted_at=None, is_active=False)
    db_inactive = Db(query_map={Account: Query(first_row=inactive)})
    with pytest.raises(HTTPException):
        tx.get_account_or_404(db_inactive, "f1", "a1")

    cat = SimpleNamespace(
        id="c1",
        family_id="f1",
        deleted_at=None,
        is_active=True,
        category_type="EXPENSE",
    )
    db_cat = Db(got={Category: cat})
    db_cat.get = lambda model, key: cat if key == "c1" else None
    assert tx.get_category_or_404(db_cat, "f1", "c1", "EXPENSE").id == "c1"

    bad_cat = SimpleNamespace(
        id="c2",
        family_id="f1",
        deleted_at=None,
        is_active=True,
        category_type="INCOME",
    )
    db_bad = Db()
    db_bad.get = lambda model, key: bad_cat
    with pytest.raises(HTTPException):
        tx.get_category_or_404(db_bad, "f1", "c2", "EXPENSE")


# ---------------------------------------------------------------------------
# grocery.py helpers
# ---------------------------------------------------------------------------


def test_grocery_response_helpers():
    from app.api.v1 import grocery as gr

    assert gr.money(1.23456) == "1.2346"
    assert gr.clean_text("  x  ", fallback="fb") == "x"
    assert gr.clean_text(None, fallback="fb") == "fb"
    assert gr.clean_currency(" usd ") == "USD"

    lst = SimpleNamespace(
        id="l1",
        family_id="f1",
        name="Weekly",
        status="OPEN",
        budget_amount=Decimal("100"),
        currency="BDT",
        vendor_name=None,
        shopping_date=date(2024, 1, 1),
        mobile_sync_key="k",
        sync_version=1,
        last_client_updated_at=None,
        note=None,
        created_at=None,
        updated_at=None,
    )
    out = gr.list_response(lst)
    assert out["title"] == "Weekly"
    assert out["budget_amount"] == "100.0000"

    item = SimpleNamespace(
        id="i1",
        family_id="f1",
        grocery_list_id="l1",
        posted_transaction_id=None,
        name="Rice",
        category="GRAIN",
        quantity=Decimal("2"),
        unit="kg",
        estimated_price=Decimal("50"),
        actual_price=Decimal("48"),
        vendor_name="Shop",
        barcode=None,
        mobile_sync_key=None,
        sync_version=0,
        last_client_updated_at=None,
        is_bought=False,
        note=None,
        created_at=None,
        updated_at=None,
    )
    item_out = gr.item_response(item)
    assert item_out["quantity"] == "2.0000"
    assert item_out["name"] == "Rice"

    vendor = SimpleNamespace(
        id="v1",
        family_id="f1",
        name="Market",
        phone="123",
        address="Addr",
        category="GENERAL",
        note=None,
        is_active=True,
        created_at=None,
        updated_at=None,
    )
    vend_out = gr.vendor_response(vendor)
    assert vend_out["name"] == "Market"


# ---------------------------------------------------------------------------
# life_planner helpers
# ---------------------------------------------------------------------------


def test_life_planner_dict_helpers():
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember

    assert lp._is_owner(SimpleNamespace(role="owner")) is True
    assert lp._is_owner(SimpleNamespace(role="MEMBER")) is False

    task = SimpleNamespace(
        id="t1",
        family_id="f1",
        created_by_member_id="m1",
        assigned_to_member_id="m2",
        title="Buy milk",
        description="2L",
        due_date=date(2024, 5, 1),
        priority="HIGH",
        status="OPEN",
        reminder_at=datetime(2024, 4, 30, 8, 0),
        created_at=datetime(2024, 4, 1),
        updated_at=None,
    )
    td = lp._task_dict(task)
    assert td["due_date"] == "2024-05-01"
    assert "2024-04-30" in td["reminder_at"]

    event = SimpleNamespace(
        id="e1",
        family_id="f1",
        created_by_member_id="m1",
        title="Meeting",
        description=None,
        event_date=date(2024, 6, 15),
        start_time="09:00",
        end_time="10:00",
        event_type="FAMILY",
        status="SCHEDULED",
        reminder_at=None,
        created_at=None,
        updated_at=None,
    )
    ed = lp._event_dict(event)
    assert ed["event_date"] == "2024-06-15"

    transfer = SimpleNamespace(
        id="tr1",
        family_id="f1",
        from_member_id="m1",
        to_member_id="m2",
        status="PENDING",
        reason="retiring",
        note="please approve",
        decided_at=None,
        created_at=datetime(2024, 1, 1),
        updated_at=None,
    )
    tr = lp._transfer_dict(transfer)
    assert tr["status"] == "PENDING"


def test_life_planner_member_helper():
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember

    member = SimpleNamespace(id="m1", role="MEMBER")
    db = Db(query_map={FamilyMember: Query(first_row=member)})
    assert lp._member(db, "f1", "u1").id == "m1"

    db_empty = Db(query_map={FamilyMember: Query(first_row=None)})
    with pytest.raises(HTTPException):
        lp._member(db_empty, "f1", "u1")


# ---------------------------------------------------------------------------
# auth.py helpers
# ---------------------------------------------------------------------------


def test_auth_helper_functions():
    from app.api.v1 import auth as auth_mod
    from app.models.family_member import FamilyMember
    from app.schemas.auth import ResetPasswordRequest

    assert auth_mod.normalize_email("  User@Example.COM ") == "user@example.com"

    scope = {"type": "http", "headers": [], "client": ("127.0.0.1", 8000)}
    req = Request(scope)
    assert auth_mod.get_client_ip(req) == "127.0.0.1"

    scope_fwd = {
        "type": "http",
        "headers": [(b"x-forwarded-for", b"1.2.3.4, 5.6.7.8")],
        "client": ("127.0.0.1", 8000),
    }
    req_fwd = Request(scope_fwd)
    assert auth_mod.get_client_ip(req_fwd) == "1.2.3.4"

    scope_dev = {
        "type": "http",
        "headers": [(b"x-device-id", b"phone-abc")],
        "client": ("127.0.0.1", 8000),
    }
    assert auth_mod.get_device_label(Request(scope_dev)) == "phone-abc"

    scope_ua = {
        "type": "http",
        "headers": [(b"user-agent", b"TestAgent/1.0")],
        "client": ("127.0.0.1", 8000),
    }
    label = auth_mod.get_device_label(Request(scope_ua))
    assert len(label) == 40

    member = SimpleNamespace(family_id="f1", role="OWNER")
    db = Db(query_map={FamilyMember: Query(first_row=member)})
    fam, role = auth_mod.primary_family_claims(db, "u1")
    assert fam == "f1"
    assert role == "OWNER"

    db_none = Db(query_map={FamilyMember: Query(first_row=None)})
    assert auth_mod.primary_family_claims(db_none, "u1") == (None, None)

    pwd_req = ResetPasswordRequest(token="reset-token-123", new_password="secret123")
    assert auth_mod.get_requested_new_password(pwd_req) == "secret123"

    with pytest.raises(HTTPException):
        auth_mod.get_requested_new_password(ResetPasswordRequest(token="reset-token-123"))


# ---------------------------------------------------------------------------
# recurring.py helpers
# ---------------------------------------------------------------------------


def test_recurring_wallet_helpers():
    from app.api.v1 import recurring as rec
    from app.models.account import Account
    from app.models.category import Category
    from app.models.family_member import FamilyMember

    assert rec.money(10) == "10.0000"
    assert rec.clean_text("  x ") == "x"
    assert rec.clean_text(None) is None

    owner = SimpleNamespace(id="m1", role="OWNER")
    member = SimpleNamespace(id="m2", role="MEMBER")
    wallet = SimpleNamespace(
        id="w1",
        family_id="f1",
        deleted_at=None,
        is_active=True,
        owner_member_id="m2",
        is_shared_family=False,
        is_owner_wallet=False,
    )

    assert rec.can_use_wallet(owner, wallet) is True
    assert rec.can_use_wallet(member, wallet) is True

    db = Db()
    db.get = lambda model, key: wallet if key == "w1" else None
    got = rec.get_wallet(db, "f1", "w1", member)
    assert got.id == "w1"

    db.get = lambda model, key: None
    with pytest.raises(HTTPException):
        rec.get_wallet(db, "f1", "missing", member)

    inactive = SimpleNamespace(
        id="w2",
        family_id="f1",
        deleted_at=None,
        is_active=False,
        owner_member_id="m2",
        is_shared_family=False,
        is_owner_wallet=False,
    )
    db.get = lambda model, key: inactive
    with pytest.raises(HTTPException):
        rec.get_wallet(db, "f1", "w2", member)

    cat = SimpleNamespace(
        id="c1",
        family_id="f1",
        deleted_at=None,
        is_active=True,
        category_type="EXPENSE",
    )
    db.get = lambda model, key: cat if key == "c1" else None
    assert rec.get_category(db, "f1", "c1", "EXPENSE").id == "c1"
    assert rec.get_category(db, "f1", None, "EXPENSE") is None


# ---------------------------------------------------------------------------
# currency + missing features + architecture feature/system helpers
# ---------------------------------------------------------------------------


def test_currency_money_helper():
    from app.api.v1 import currency as cur

    assert cur.money("12.3456") == "12.3456"
    assert cur.money(None) == "0.0000"


def test_missing_features_money_helpers():
    from app.api.v1 import missing_features_api as mf

    assert mf.money("1.23456") == "1.2346"
    assert mf._money_d("2") == Decimal("2.0000")
    assert mf.GOLD_NISAB_GRAMS == Decimal("87.48")


def test_architecture_features_money():
    from app.api.v1 import architecture_features_api as af

    assert af.money(0) == "0.0000"
    assert af.money("3.33333") == "3.3333"


def test_architecture_system_pref_out():
    from app.api.v1 import architecture_system_api as sys_api

    pref = SimpleNamespace(
        id="p1",
        user_id="u1",
        theme="dark",
        language="en",
        notification_on=True,
        currency="BDT",
    )
    out = sys_api._pref_out(pref)
    assert out["theme"] == "dark"
    assert out["currency"] == "BDT"


# ---------------------------------------------------------------------------
# celery_tasks import guards (fast mocked)
# ---------------------------------------------------------------------------


def test_celery_worker_tasks(monkeypatch):
    from app.workers import celery_tasks as ct

    monkeypatch.setattr(ct, "process_recurring_transactions", lambda: None)
    out = ct.process_recurring_task()
    assert out == {"ok": True, "task": "recurring"}

    monkeypatch.setattr(ct, "process_auto_backup", lambda: {"backed_up": 1})
    out2 = ct.process_auto_backup_task()
    assert out2["ok"] is True
    assert out2["task"] == "auto_backup"
    assert out2["result"]["backed_up"] == 1
