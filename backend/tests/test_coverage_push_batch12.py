"""Batch-12 coverage push: family_governance_hardened, audit_trail_hardened,
double_entry_transactions_hardened, life_planner — mock-only endpoint + helper tests."""

from __future__ import annotations

import os
from pathlib import Path


def _bootstrap_batch12_env() -> None:
    """Isolated SQLite when run with ``pytest --noconftest`` (avoids shared DB locks)."""
    if os.getenv("_BATCH12_ENV_READY") == "1":
        return
    if os.getenv("INTEGRATION_TESTS") == "true":
        os.environ["_BATCH12_ENV_READY"] = "1"
        return

    test_db = Path(__file__).resolve().parent.parent / "storage" / f"pytest_batch12_{os.getpid()}.db"
    test_db.parent.mkdir(parents=True, exist_ok=True)
    if test_db.exists():
        try:
            test_db.unlink()
        except OSError:
            pass

    os.environ.update(
        {
            "DATABASE_URL": f"sqlite+pysqlite:///{test_db.as_posix()}",
            "AUTO_CREATE_TABLES": "true",
            "ENABLE_RECURRING_WORKER": "false",
            "ENABLE_AUTO_BACKUP_WORKER": "false",
            "NOTIFICATION_FCM_ENABLED": "false",
            "NOTIFICATION_EMAIL_ENABLED": "false",
            "DOCUMENT_VAULT_BACKEND": "local",
            "CELERY_ENABLED": "false",
            "_BATCH12_ENV_READY": "1",
        }
    )
    for key in (
        "S3_ENDPOINT_URL",
        "S3_BUCKET",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "SMTP_HOST",
        "SMTP_FROM_EMAIL",
        "REDIS_URL",
    ):
        os.environ.pop(key, None)

    import app.models  # noqa: F401 — register ORM tables
    from app.core.database import engine
    from app.models.base import Base

    Base.metadata.create_all(bind=engine)


_bootstrap_batch12_env()

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import Column, Integer, MetaData, String, Table


# ---------------------------------------------------------------------------
# Shared Query / Db helpers (same pattern as batch2 / batch4)
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

    def with_for_update(self, *args, **kwargs):
        return self

    def scalar(self):
        row = self._first
        return row if not hasattr(row, "__getitem__") else row

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


def _mapping_result(row):
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    return result


def _mapping_all_result(rows):
    result = MagicMock()
    result.mappings.return_value.all.return_value = rows
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


def _scalar_result(value):
    result = MagicMock()
    result.scalar.return_value = value
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
        {"name": "action_type"},
        {"name": "entity_type"},
        {"name": "entity_id"},
        {"name": "title"},
        {"name": "description"},
        {"name": "severity"},
    ]

    def _cols(table):
        if column_map and table in column_map:
            return column_map[table]
        return default_cols

    inspector.get_columns.side_effect = _cols
    monkeypatch.setattr(mod, "_phase5b_inspect", lambda bind: inspector)
    return inspector


def _mock_phase9b_inspector(monkeypatch, mod, table_names=None, column_map=None):
    inspector = MagicMock()
    inspector.get_table_names.return_value = table_names or ["audit_logs"]
    default_audit_cols = [
        {"name": "id"},
        {"name": "family_id"},
        {"name": "member_id"},
        {"name": "action_type"},
        {"name": "entity_type"},
        {"name": "entity_id"},
        {"name": "title"},
        {"name": "description"},
        {"name": "severity"},
        {"name": "created_at"},
        {"name": "deleted_at"},
    ]

    def _cols(table):
        if column_map and table in column_map:
            return column_map[table]
        return default_audit_cols

    inspector.get_columns.side_effect = _cols
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)
    return inspector


# ===========================================================================
# family_governance_hardened — helpers + phase5b RBAC endpoints
# ===========================================================================


def test_fg_serial_compare_value_int_and_str():
    from app.api.v1 import family_governance_hardened as fg

    metadata_int = MetaData()
    members = Table(
        "family_members_int",
        metadata_int,
        Column("relationship_serial", Integer),
    )
    assert fg.serial_compare_value(members, "relationship_serial", 3) == 3

    metadata_str = MetaData()
    members_str = Table(
        "family_members_str",
        metadata_str,
        Column("relationship_serial", String),
    )
    assert fg.serial_compare_value(members_str, "relationship_serial", 3) == "3"


def test_fg_invite_column_helpers():
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    invites = Table(
        "invites",
        metadata,
        Column("code_hash", String),
        Column("used_count", Integer),
        Column("max_uses", Integer),
        Column("expires_at", String),
    )
    assert fg.invite_code_col(invites) == "code_hash"
    assert fg.invite_used_col(invites) == "used_count"
    assert fg.invite_max_col(invites) == "max_uses"
    assert fg.invite_expiry_col(invites) == "expires_at"


def test_fg_invite_code_col_missing_raises():
    from app.api.v1 import family_governance_hardened as fg

    metadata = MetaData()
    bad = Table("invites", metadata, Column("token_hint", String))
    with pytest.raises(HTTPException) as exc:
        fg.invite_code_col(bad)
    assert exc.value.status_code == 500


def test_fg_phase5b_require_family_member_denied(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    db = Db(execute_results=[_mapping_result(None)])
    with pytest.raises(HTTPException) as exc:
        fg._phase5b_require_family_member(db, "f1", _ns(id="u1"))
    assert exc.value.status_code == 403


def test_fg_phase5b_require_owner_denied_for_member(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    member = {"id": "m1", "family_id": "f1", "user_id": "u1", "role": "MEMBER"}
    db = Db(execute_results=[_mapping_result(member)])
    with pytest.raises(HTTPException) as exc:
        fg._phase5b_require_owner(db, "f1", _ns(id="u1"))
    assert "Owner" in str(exc.value.detail)


def test_fg_phase5b_has_permission_owner_bypass(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    owner = {"id": "m1", "role": "OWNER"}
    assert fg._phase5b_has_permission(Db(), "f1", owner, "wallet.delete") is True


def test_fg_phase5b_has_permission_denied_without_row(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    member = {"id": "m2", "role": "MEMBER"}
    db = Db(execute_results=[_mapping_result(None)])
    assert fg._phase5b_has_permission(db, "f2", member, "wallet.delete") is False


def test_fg_phase5b_check_permission_endpoint(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    member = {"id": "m1", "role": "MEMBER"}
    perm_row = {"permission_key": "dashboard.read", "allow": True}
    db = Db(
        execute_results=[
            _mapping_result(member),
            _mapping_result(perm_row),
        ]
    )
    out = fg.phase5b_check_permission(
        family_id="f1",
        payload=fg.Phase5BPermissionCheckRequest(permission_key="dashboard.read"),
        db=db,
        current_user=_ns(id="u1"),
    )
    assert out["allowed"] is True
    assert out["member_id"] == "m1"


def test_fg_phase5b_protected_action_requires_permission(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    member = {"id": "m1", "role": "MEMBER"}
    db = Db(execute_results=[_mapping_result(member), _mapping_result(None)])
    with pytest.raises(HTTPException) as exc:
        fg.phase5b_protected_action(
            family_id="f1",
            payload=fg.Phase5BPermissionCheckRequest(permission_key="wallet.delete"),
            db=db,
            current_user=_ns(id="u1"),
        )
    assert exc.value.status_code == 403


def test_fg_phase5b_my_family_permissions_endpoint(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    member = {"id": "m1", "role": "OWNER"}
    perm_rows = [
        {"permission_key": "dashboard.read", "allow": True},
        {"permission_key": "wallet.delete", "allow": False},
    ]
    db = Db(
        execute_results=[
            _mapping_result(member),
            _mapping_all_result(perm_rows),
        ]
    )
    out = fg.phase5b_my_family_permissions(
        family_id="f1",
        db=db,
        current_user=_ns(id="u1"),
    )
    assert out["is_owner"] is True
    assert out["permissions"]["dashboard.read"] is True
    assert out["permissions"]["wallet.delete"] is False


def test_fg_phase5b_get_member_permissions_not_found(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    owner = {"id": "m-owner", "role": "OWNER"}
    db = Db(
        execute_results=[
            _mapping_result(owner),
            _mapping_result(None),
        ]
    )
    with pytest.raises(HTTPException) as exc:
        fg.phase5b_get_member_permissions(
            family_id="f1",
            member_id="missing",
            db=db,
            current_user=_ns(id="u1"),
        )
    assert exc.value.status_code == 404


def test_fg_phase5b_set_permission_insert_path(monkeypatch):
    from app.api.v1 import family_governance_hardened as fg

    _mock_phase5b_inspector(monkeypatch, fg)
    monkeypatch.setattr(fg, "_phase5b_now", lambda: "2024-01-01T00:00:00")
    db = Db(
        execute_results=[
            _mapping_result(None),
            MagicMock(),
            _mapping_result({"id": "p1", "permission_key": "wallet.read", "allow": True, "scope": "FAMILY"}),
        ]
    )
    row = fg._phase5b_set_permission(db, "m1", "wallet.read", allow=True, scope="FAMILY")
    assert row["permission_key"] == "wallet.read"
    assert db.commit_count == 1


def test_fg_normalize_relationship_serial_zero_rejected():
    from app.api.v1 import family_governance_hardened as fg

    with pytest.raises(HTTPException) as exc:
        fg.normalize_relationship_serial(0, True)
    assert exc.value.status_code == 422


def test_fg_new_id_is_uuid_string():
    from app.api.v1 import family_governance_hardened as fg

    a = fg.new_id()
    b = fg.new_id()
    assert a != b
    assert len(a) == 36


# ===========================================================================
# audit_trail_hardened — helpers + endpoints
# ===========================================================================


def test_at_base_filters_with_all_params():
    from app.api.v1 import audit_trail_hardened as mod

    cols = {
        "family_id": {},
        "action_type": {},
        "entity_type": {},
        "severity": {},
        "deleted_at": {},
    }
    filters, params = mod._phase9b_base_filters(
        cols,
        "fam-1",
        action_type="CREATE",
        entity_type="WALLET",
        severity="INFO",
    )
    assert '"family_id"' in filters[0]
    assert "deleted_at" in " ".join(filters)
    assert params["action_type"] == "CREATE"
    assert params["entity_type"] == "WALLET"
    assert params["severity"] == "INFO"


def test_at_select_expr_builds_aliases():
    from app.api.v1 import audit_trail_hardened as mod

    cols = {
        "id": {},
        "family_id": {},
        "member_id": {},
        "action_type": {},
        "entity_type": {},
        "entity_id": {},
        "title": {},
        "description": {},
        "severity": {},
        "created_at": {},
    }
    expr = mod._phase9b_select_expr(cols)
    assert '"id" AS "id"' in expr
    assert '"action_type" AS "action_type"' in expr


def test_at_insert_audit_evidence_skips_missing_table(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    _mock_phase9b_inspector(monkeypatch, mod, table_names=[])
    mod._phase9b_insert_audit_evidence(
        Db(),
        "f1",
        _ns(id="u1"),
        "READ",
        "title",
        "desc",
    )


def test_at_audit_trail_activity_endpoint(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: _ns(id="m1"),
    )
    _mock_phase9b_inspector(monkeypatch, mod)
    audit_rows = [{"id": "a1", "action_type": "CREATE", "title": "x"}]
    db = Db(
        execute_results=[
            _rows_result(audit_rows),
            MagicMock(),
        ]
    )
    out = mod.phase9b_audit_trail_activity(
        family_id="f1",
        action_type="CREATE",
        entity_type=None,
        severity=None,
        limit=50,
        db=db,
        current_user=_ns(id="u1"),
    )
    assert out["status"] == "ok"
    assert out["filters"]["limit"] == 50
    assert len(out["rows"]) == 1


def test_at_audit_trail_summary_endpoint(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: _ns(id="m1"),
    )
    _mock_phase9b_inspector(monkeypatch, mod)
    db = Db(
        execute_results=[
            _scalar_result(12),
            _rows_result([{"action_type": "CREATE", "count": 8}]),
            _rows_result([{"entity_type": "WALLET", "count": 5}]),
            _rows_result([{"severity": "INFO", "count": 10}]),
            MagicMock(),
        ]
    )
    out = mod.phase9b_audit_trail_summary(
        family_id="f1",
        db=db,
        current_user=_ns(id="u1"),
    )
    assert out["total_audit_rows"] == 12
    assert out["by_action_type"][0]["action_type"] == "CREATE"


def test_at_audit_trail_entity_endpoint(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: _ns(id="m1"),
    )
    _mock_phase9b_inspector(monkeypatch, mod)
    db = Db(
        execute_results=[
            _rows_result([{"id": "log-1", "entity_id": "w1"}]),
            MagicMock(),
        ]
    )
    out = mod.phase9b_audit_trail_entity(
        family_id="f1",
        entity_type="WALLET",
        entity_id="w1",
        limit=25,
        db=db,
        current_user=_ns(id="u1"),
    )
    assert out["entity_type"] == "WALLET"
    assert out["entity_id"] == "w1"
    assert out["rows"][0]["entity_id"] == "w1"


def test_at_audit_columns_missing_family_col(monkeypatch):
    from app.api.v1 import audit_trail_hardened as mod

    _mock_phase9b_inspector(
        monkeypatch,
        mod,
        table_names=["audit_logs"],
        column_map={"audit_logs": [{"name": "id"}]},
    )
    with pytest.raises(HTTPException) as exc:
        mod._phase9b_audit_columns_or_500(Db())
    assert "family_id" in str(exc.value.detail).lower()


# ===========================================================================
# double_entry_transactions_hardened — helpers + endpoints
# ===========================================================================


def test_de_account_row_invalid_account(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["accounts"]
    inspector.get_columns.return_value = [{"name": "id"}, {"name": "family_id"}]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    db = Db(execute_results=[_mapping_result(None)])
    with pytest.raises(HTTPException) as exc:
        mod._phase7b_account_row(db, "f1", "bad-account")
    assert exc.value.status_code == 422


def test_de_account_row_inactive_account(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["accounts"]
    inspector.get_columns.return_value = [
        {"name": "id"},
        {"name": "family_id"},
        {"name": "is_active"},
    ]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    db = Db(execute_results=[_mapping_result({"id": "a1", "is_active": False})])
    with pytest.raises(HTTPException) as exc:
        mod._phase7b_account_row(db, "f1", "a1")
    assert "Inactive" in exc.value.detail


def test_de_get_transaction_not_found(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["transactions", "transaction_lines", "accounts"]
    inspector.get_columns.side_effect = lambda table: {
        "transactions": [{"name": c} for c in ["id", "family_id", "description"]],
        "transaction_lines": [{"name": c} for c in ["id", "transaction_id", "account_id", "debit", "credit"]],
        "accounts": [{"name": c} for c in ["id", "family_id"]],
    }[table]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    db = Db(execute_results=[_mapping_result(None)])
    with pytest.raises(HTTPException) as exc:
        mod._phase7b_get_transaction_row(db, "f1", "tx-missing")
    assert exc.value.status_code == 404


def test_de_list_transactions_endpoint(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: {"id": "m1", "role": "OWNER"},
    )
    monkeypatch.setattr(
        mod,
        "_phase7b_list_transactions",
        lambda db, family_id: [{"id": "t1", "family_id": family_id}],
    )
    out = mod.phase7b_list_transactions(
        family_id="f1",
        db=Db(),
        current_user=_ns(id="u1"),
    )
    assert out["count"] == 1
    assert out["transactions"][0]["id"] == "t1"


def test_de_get_transaction_endpoint(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: {"id": "m1"},
    )
    monkeypatch.setattr(
        mod,
        "_phase7b_transaction_with_lines",
        lambda db, family_id, tx_id: {
            "transaction": {"id": tx_id},
            "lines": [{"debit": "100.00", "credit": "0.00"}],
        },
    )
    out = mod.phase7b_get_transaction(
        family_id="f1",
        transaction_id="tx-1",
        db=Db(),
        current_user=_ns(id="u1"),
    )
    assert out["transaction"]["id"] == "tx-1"
    assert len(out["lines"]) == 1


def test_de_create_transaction_endpoint(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase5b_require_permission",
        lambda *a, **k: {"id": "m1"},
    )
    monkeypatch.setattr(
        mod,
        "_phase7b_insert_transaction",
        lambda db, family_id, member, user, payload: {"id": "tx-new"},
    )
    monkeypatch.setattr(
        mod,
        "_phase7b_transaction_with_lines",
        lambda db, family_id, tx_id: {
            "transaction": {"id": tx_id},
            "lines": [],
        },
    )
    payload = mod.Phase7BTransactionCreate(
        lines=[
            mod.Phase7BTransactionLine(account_id="a1", debit=50, credit=0),
            mod.Phase7BTransactionLine(account_id="a2", debit=0, credit=50),
        ]
    )
    out = mod.phase7b_create_transaction(
        family_id="f1",
        payload=payload,
        db=Db(),
        current_user=_ns(id="u1"),
    )
    assert out["status"] == "POSTED"
    assert out["transaction"]["id"] == "tx-new"


def test_de_fill_required_defaults_adds_missing(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["transactions"]
    inspector.get_columns.return_value = [
        {"name": "id", "nullable": False, "default": None, "type": "VARCHAR"},
        {"name": "status", "nullable": False, "default": None, "type": "VARCHAR"},
        {"name": "deleted_at", "nullable": True, "default": None, "type": "DATETIME"},
    ]
    monkeypatch.setattr(mod, "inspect", lambda bind: inspector)

    values = {"id": "t1"}
    out = mod._phase7b_fill_required_defaults(Db(), "transactions", values, "TX")
    assert out["id"] == "t1"
    assert out["status"] == "POSTED"


def test_de_validate_lines_zero_amount_rejected(monkeypatch):
    from app.api.v1 import double_entry_transactions_hardened as mod

    monkeypatch.setattr(
        mod,
        "_phase7b_account_row",
        lambda db, family_id, account_id: {"id": account_id},
    )
    zero = mod.Phase7BTransactionLine(account_id="a", debit=0, credit=0)
    with pytest.raises(HTTPException) as exc:
        mod._phase7b_validate_lines(Db(), "f1", [zero, zero])
    assert exc.value.status_code == 422


# ===========================================================================
# life_planner — endpoints with mocked db / permission
# ===========================================================================


def test_lp_list_tasks_endpoint(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.models.life_planner import FamilyTask

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    task = _ns(
        id="t1",
        family_id="f1",
        created_by_member_id="m1",
        assigned_to_member_id=None,
        title="Groceries",
        description=None,
        due_date=None,
        priority="MEDIUM",
        status="OPEN",
        reminder_at=None,
        created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        updated_at=None,
    )
    db = Db(query_map={FamilyTask: Query(rows=[task])})
    rows = lp.list_tasks("f1", status=None, db=db, current_user=_ns(id="u1"))
    assert len(rows) == 1
    assert rows[0]["title"] == "Groceries"


def test_lp_create_task_endpoint(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.schemas.life_planner import TaskCreateRequest

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    member = _ns(id="m1", role="MEMBER", status="ACTIVE", deleted_at=None)
    db = Db(query_map={FamilyMember: Query(first_row=member)})
    payload = TaskCreateRequest(family_id="f1", title="  Pay bills  ", priority="high")
    out = lp.create_task(payload, db=db, current_user=_ns(id="u1"))
    assert out["title"] == "Pay bills"
    assert out["priority"] == "HIGH"
    assert db.commit_count == 1
    assert len(db.added) == 1


def test_lp_complete_task_not_found(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import FamilyTask

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    db = Db(query_map={FamilyTask: Query(first_row=None)})
    with pytest.raises(HTTPException) as exc:
        lp.complete_task("missing", "f1", db=db, current_user=_ns(id="u1"))
    assert exc.value.status_code == 404


def test_lp_update_task_blank_title_rejected(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import FamilyTask
    from app.schemas.life_planner import TaskUpdateRequest

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    task = _ns(
        id="t1",
        family_id="f1",
        created_by_member_id="m1",
        assigned_to_member_id=None,
        title="Old",
        description=None,
        due_date=None,
        priority="LOW",
        status="OPEN",
        reminder_at=None,
        created_at=None,
        updated_at=None,
    )
    db = Db(query_map={FamilyTask: Query(first_row=task)})
    with pytest.raises(HTTPException) as exc:
        lp.update_task(
            "t1",
            TaskUpdateRequest(title="   "),
            "f1",
            db=db,
            current_user=_ns(id="u1"),
        )
    assert exc.value.status_code == 422


def test_lp_list_calendar_default_from_today(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import CalendarEvent

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    event = _ns(
        id="e1",
        family_id="f1",
        created_by_member_id="m1",
        title="Birthday",
        description=None,
        event_date=date.today(),
        start_time=None,
        end_time=None,
        event_type="GENERAL",
        status="SCHEDULED",
        reminder_at=None,
        created_at=None,
        updated_at=None,
    )
    db = Db(query_map={CalendarEvent: Query(rows=[event])})
    rows = lp.list_calendar("f1", from_date=None, to_date=None, db=db, current_user=_ns(id="u1"))
    assert len(rows) == 1
    assert rows[0]["title"] == "Birthday"


def test_lp_create_ownership_transfer_not_owner(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.schemas.life_planner import OwnershipTransferCreateRequest

    member = _ns(id="m1", role="MEMBER", status="ACTIVE", deleted_at=None, user_id="u1")
    db = Db(query_map={FamilyMember: Query(first_row=member)})
    with pytest.raises(HTTPException) as exc:
        lp.create_ownership_transfer(
            "f1",
            OwnershipTransferCreateRequest(to_member_id="m2"),
            db=db,
            current_user=_ns(id="u1"),
        )
    assert exc.value.status_code == 403


def test_lp_set_member_role_invalid(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember
    from app.schemas.life_planner import MemberRoleUpdateRequest

    owner = _ns(id="m-owner", role="OWNER", status="ACTIVE", deleted_at=None)
    db = Db(query_map={FamilyMember: Query(first_row=owner)})
    with pytest.raises(HTTPException) as exc:
        lp.set_member_role(
            "f1",
            "m2",
            MemberRoleUpdateRequest(role="SUPERUSER"),
            db=db,
            current_user=_ns(id="u1"),
        )
    assert exc.value.status_code == 422


def test_lp_deactivate_family_already_inactive(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family import Family
    from app.models.family_member import FamilyMember
    from app.models.life_planner import OwnershipTransferRequest

    owner = _ns(id="m1", role="OWNER", status="ACTIVE", deleted_at=None)
    family = _ns(id="f1", is_active=False)
    db = Db(
        query_map={
            FamilyMember: Query(first_row=owner),
            OwnershipTransferRequest: Query(first_row=None),
            Family: Query(first_row=family),
        }
    )
    out = lp.deactivate_family("f1", db=db, current_user=_ns(id="u1"))
    assert out["is_active"] is False
    assert db.commit_count == 0


def test_lp_remove_member_owner_cannot_delete_self(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.family_member import FamilyMember

    owner = _ns(id="m1", role="OWNER", status="ACTIVE", deleted_at=None)
    db = Db(query_map={FamilyMember: Query(first_row=owner)})
    with pytest.raises(HTTPException) as exc:
        lp.remove_family_member("f1", "m1", db=db, current_user=_ns(id="u1"))
    assert exc.value.status_code == 422


def test_lp_delete_task_success(monkeypatch):
    from app.api.v1 import life_planner as lp
    from app.models.life_planner import FamilyTask

    monkeypatch.setattr(lp, "require_permission", lambda *a, **k: None)
    task = _ns(
        id="t1",
        family_id="f1",
        created_by_member_id="m1",
        assigned_to_member_id=None,
        title="Temp",
        description=None,
        due_date=None,
        priority="LOW",
        status="OPEN",
        reminder_at=None,
        created_at=None,
        updated_at=None,
        deleted_at=None,
    )
    db = Db(query_map={FamilyTask: Query(first_row=task)})
    out = lp.delete_task("t1", "f1", db=db, current_user=_ns(id="u1"))
    assert out["success"] is True
    assert task.status == "CANCELLED"
    assert task.deleted_at is not None
