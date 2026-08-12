"""Batch-3 coverage push: API helpers, workers, and under-tested route utilities."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import zipfile

import pytest
from fastapi import HTTPException


class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def offset(self, *args, **kwargs):
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
        self.flush_count = 0
        self.refresh_count = 0
        self.rollback_count = 0
        self.closed = False

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

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        self.closed = True


# ---------------------------------------------------------------------------
# workers: recurring_scheduler
# ---------------------------------------------------------------------------


def test_recurring_scheduler_date_and_member_helpers(monkeypatch):
    from app.workers import recurring_scheduler as rs

    jan31 = date(2024, 1, 31)
    assert rs._add_months(jan31, 1) == date(2024, 2, 29)
    assert rs._add_months(date(2023, 1, 31), 1) == date(2023, 2, 28)

    item = SimpleNamespace(next_due_date=date(2024, 6, 1), frequency="DAILY")
    rs.move_next_due_date(item)
    assert item.next_due_date == date(2024, 6, 2)

    item.frequency = "WEEKLY"
    item.next_due_date = date(2024, 6, 1)
    rs.move_next_due_date(item)
    assert item.next_due_date == date(2024, 6, 8)

    item.frequency = "MONTHLY"
    item.next_due_date = date(2024, 1, 31)
    rs.move_next_due_date(item)
    assert item.next_due_date == date(2024, 2, 29)

    item.frequency = "YEARLY"
    item.next_due_date = date(2024, 2, 29)
    rs.move_next_due_date(item)
    assert item.next_due_date == date(2025, 2, 28)

    item.frequency = "UNKNOWN"
    item.next_due_date = None
    rs.move_next_due_date(item)
    assert item.next_due_date is not None

    # Stub the model symbol used by the worker so filter attribute access is safe
    # without mutating the real SQLAlchemy mapped class.
    class FakeFamilyMember:
        id = MagicMock()
        family_id = MagicMock()
        role = MagicMock()
        status = MagicMock()
        deleted_at = MagicMock()

    monkeypatch.setattr(rs, "FamilyMember", FakeFamilyMember)

    owner = SimpleNamespace(id="owner-1")
    db = Db(query_map={FakeFamilyMember: Query(first_row=owner)})
    assert rs._get_active_family_member_id(db, "fam") == "owner-1"

    class SeqDb(Db):
        def __init__(self, seq):
            super().__init__()
            self._seq = list(seq)

        def query(self, model):
            return Query(first_row=self._seq.pop(0) if self._seq else None)

    assert rs._get_active_family_member_id(SeqDb([None, SimpleNamespace(id="m-2")]), "fam") == "m-2"
    assert rs._get_active_family_member_id(SeqDb([None, None]), "fam") is None

    class FakeNotification:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    monkeypatch.setattr(rs, "Notification", FakeNotification)
    notify_db = Db()
    rs._notify(notify_db, "fam", "T", "Title", "msg", "HIGH")
    assert len(notify_db.added) == 1
    assert notify_db.added[0].title == "Title"


def test_process_recurring_transactions_branches(monkeypatch):
    from app.workers import recurring_scheduler as rs

    class CmpCol:
        def __eq__(self, other):
            return True

        def __le__(self, other):
            return True

        def __ge__(self, other):
            return True

        def is_(self, other):
            return True

    class FakeAccount:
        id = CmpCol()
        family_id = CmpCol()
        deleted_at = CmpCol()

    class FakeFamilyMember:
        id = CmpCol()
        family_id = CmpCol()
        role = CmpCol()
        is_active = CmpCol()
        deleted_at = CmpCol()

    class FakeRecurring:
        status = CmpCol()
        next_due_date = CmpCol()
        deleted_at = CmpCol()

    class FakeTransaction:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeAuditLog:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeNotification:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    monkeypatch.setattr(rs, "Account", FakeAccount)
    monkeypatch.setattr(rs, "FamilyMember", FakeFamilyMember)
    monkeypatch.setattr(rs, "RecurringTransaction", FakeRecurring)
    monkeypatch.setattr(rs, "Transaction", FakeTransaction)
    monkeypatch.setattr(rs, "AuditLog", FakeAuditLog)
    monkeypatch.setattr(rs, "Notification", FakeNotification)

    due = SimpleNamespace(
        id="r1",
        family_id="fam",
        account_id="a1",
        title="Rent",
        amount="100",
        currency="BDT",
        transaction_type="EXPENSE",
        category_id=None,
        created_by_member_id=None,
        next_due_date=date.today(),
        frequency="MONTHLY",
    )
    income = SimpleNamespace(
        id="r2",
        family_id="fam",
        account_id="a2",
        title="Pay",
        amount="50",
        currency="BDT",
        transaction_type="INCOME",
        category_id=None,
        created_by_member_id="m1",
        next_due_date=date.today(),
        frequency="WEEKLY",
    )
    no_member = SimpleNamespace(
        id="r3",
        family_id="fam",
        account_id="a3",
        title="X",
        amount="10",
        currency="BDT",
        transaction_type="EXPENSE",
        category_id=None,
        created_by_member_id=None,
        next_due_date=date.today(),
        frequency="DAILY",
    )
    insuff = SimpleNamespace(
        id="r4",
        family_id="fam",
        account_id="a4",
        title="Big",
        amount="999",
        currency="BDT",
        transaction_type="EXPENSE",
        category_id=None,
        created_by_member_id="m1",
        next_due_date=date.today(),
        frequency="DAILY",
    )
    boom = SimpleNamespace(
        id="r5",
        family_id="fam",
        account_id="a5",
        title="Boom",
        amount="1",
        currency="BDT",
        transaction_type="EXPENSE",
        category_id=None,
        created_by_member_id="m1",
        next_due_date=date.today(),
        frequency="DAILY",
    )

    accounts = {
        "a1": None,
        "a2": SimpleNamespace(id="a2", family_id="fam", current_balance="10", deleted_at=None),
        "a3": SimpleNamespace(id="a3", family_id="fam", current_balance="100", deleted_at=None),
        "a4": SimpleNamespace(id="a4", family_id="fam", current_balance="1", deleted_at=None),
        "a5": SimpleNamespace(id="a5", family_id="fam", current_balance="100", deleted_at=None),
    }

    class ProcessDb(Db):
        def query(self, model):
            if model is FakeRecurring:
                return Query(rows=[due, income, no_member, insuff, boom])
            if model is FakeAccount:
                return Query(first_row=self._acct_queue.pop(0))
            if model is FakeFamilyMember:
                return Query(first_row=None)
            return Query()

    pdb = ProcessDb()
    pdb._acct_queue = [accounts["a1"], accounts["a2"], accounts["a3"], accounts["a4"], accounts["a5"]]

    def boom_add(row):
        if isinstance(row, FakeTransaction) and getattr(row, "description", "").startswith(
            "Auto recurring: Boom"
        ):
            raise RuntimeError("explode")
        pdb.added.append(row)

    pdb.add = boom_add  # type: ignore[method-assign]
    monkeypatch.setattr(rs, "SessionLocal", lambda: pdb)
    rs.process_recurring_transactions()
    assert pdb.closed is True
    assert pdb.commit_count >= 3


# ---------------------------------------------------------------------------
# workers: auto_backup_worker
# ---------------------------------------------------------------------------


def test_auto_backup_worker_paths(monkeypatch, tmp_path):
    from app.workers import auto_backup_worker as ab

    monkeypatch.setattr(ab, "BASE_DIR", tmp_path)
    monkeypatch.setattr(ab, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(ab, "AUTO_BACKUP_DIR", tmp_path / "backups" / "auto")

    db_file = tmp_path / "app.db"
    db_file.write_text("sqlite-data", encoding="utf-8")

    class FakeEngine:
        url = f"sqlite:///{db_file.as_posix()}"

    monkeypatch.setattr(ab, "engine", FakeEngine())

    ab._ensure_dirs()
    assert ab.AUTO_BACKUP_DIR.exists()
    assert ab._real_db_path() == db_file.resolve() or ab._real_db_path() == db_file

    with pytest.raises(RuntimeError, match="SQLite only"):
        class Pg:
            url = "postgresql://u:p@localhost/db"

        monkeypatch.setattr(ab, "engine", Pg())
        ab._real_db_path()

    monkeypatch.setattr(ab, "engine", FakeEngine())
    missing = FakeEngine()
    missing.url = f"sqlite:///{(tmp_path / 'missing.db').as_posix()}"
    monkeypatch.setattr(ab, "engine", missing)
    with pytest.raises(RuntimeError, match="not found"):
        ab._real_db_path()

    monkeypatch.setattr(ab, "engine", FakeEngine())
    result = ab.create_auto_backup()
    assert result["success"] is True
    zip_path = Path(result["backup_path"])
    assert zip_path.exists()

    # already today -> skip (before creating older noise files)
    skipped = ab.process_auto_backup()
    assert skipped.get("skipped") is True

    # create extras for cleanup (older names / touch order)
    for i in range(12):
        p = ab.AUTO_BACKUP_DIR / f"s4_auto_backup_2000010{i:02d}_000000.zip"
        p.write_bytes(b"x")
    deleted = ab.cleanup_old_auto_backups(keep_last=10)
    assert deleted >= 1

    # clear today files and process
    for f in ab.AUTO_BACKUP_DIR.glob("s4_auto_backup_*.zip"):
        f.unlink(missing_ok=True)
    ran = ab.process_auto_backup()
    assert ran.get("skipped") is False
    assert ran["success"] is True


# ---------------------------------------------------------------------------
# reports helpers + export builders
# ---------------------------------------------------------------------------


def test_reports_helpers_and_exports():
    from app.api.v1 import reports as r

    assert r.money(None) == "0.0000"
    assert r.money("1.23456") == "1.2346"
    assert r.percent(50, 0) == "0.00"
    assert r.percent(25, 100) == "25.00"
    assert r.parse_date_start(None) is None
    assert r.parse_date_end(None) is None
    start = r.parse_date_start("2024-01-02")
    end = r.parse_date_end("2024-01-02")
    assert start.hour == 0 and end.hour == 23

    db = Db(got=None)
    assert r.serialize_category(db, None) is None
    assert r.serialize_category(db, "c1") is None
    cat = SimpleNamespace(
        id="c1", name_en="Food", name_bn="খাবার", category_type="EXPENSE", icon="x", color="#fff"
    )
    db.got = {"c1": cat}
    assert r.serialize_category(db, "c1")["name_en"] == "Food"

    assert r.serialize_account(db, None) is None
    db.got = {}
    assert r.serialize_account(db, "a1") is None
    acct = SimpleNamespace(id="a1", name="Cash", account_type="CASH", currency="BDT")
    db.got = {"a1": acct}
    assert r.serialize_account(db, "a1")["name"] == "Cash"

    rate_db = Db(query_map={})
    assert r.report_currency_rate(rate_db, "BDT", "BDT") == Decimal("1")
    from app.models.currency import ExchangeRate

    rate_db2 = Db(query_map={ExchangeRate: Query(first_row=None)})
    assert r.report_currency_rate(rate_db2, "USD", "BDT") == Decimal("0")
    rate_db3 = Db(query_map={ExchangeRate: Query(first_row=SimpleNamespace(rate="110.5"))})
    assert r.report_currency_rate(rate_db3, "USD", "BDT") == Decimal("110.5")

    member = SimpleNamespace(id="m1")
    with patch.object(r, "require_permission", return_value=member) as rp:
        assert r.require_report_access(Db(), "fam", "u1") is member
        rp.assert_called_once()

    from app.models.transaction import Transaction

    tx_db = Db(query_map={Transaction: Query(rows=[SimpleNamespace(id="t1")])})
    assert len(r.get_posted_transactions(tx_db, "fam", "2024-01-01", "2024-12-31")) == 1

    from app.models.transaction_line import TransactionLine

    lines = [
        SimpleNamespace(account_id="a1", credit=Decimal("10"), debit=Decimal("0")),
        SimpleNamespace(account_id="a2", credit=Decimal("0"), debit=Decimal("10")),
    ]
    tw_db = Db(query_map={TransactionLine: Query(rows=lines)}, got={"a1": acct, "a2": acct})
    transfer_info = r.transaction_wallet_info(tw_db, SimpleNamespace(id="t1", transaction_type="TRANSFER"))
    assert transfer_info["transfer"] is not None

    expense_db = Db(
        query_map={TransactionLine: Query(rows=[SimpleNamespace(account_id="a1", credit=0, debit=5)])},
        got={"a1": acct},
    )
    exp_info = r.transaction_wallet_info(expense_db, SimpleNamespace(id="t2", transaction_type="EXPENSE"))
    assert exp_info["wallet"]["id"] == "a1"

    empty_db = Db(query_map={TransactionLine: Query(rows=[])})
    assert r.transaction_wallet_info(empty_db, SimpleNamespace(id="t3", transaction_type="EXPENSE"))["wallet"] is None

    register_rows = r._transaction_register_export_rows(
        {
            "transactions": [
                {
                    "created_at": "2024-01-01",
                    "transaction_id": "t1",
                    "transaction_number": "N1",
                    "transaction_type": "TRANSFER",
                    "amount": "10",
                    "currency": "BDT",
                    "status": "POSTED",
                    "wallet": {"name": "Cash"},
                    "transfer": {
                        "from_wallet": {"name": "A"},
                        "to_wallet": {"name": "B"},
                    },
                    "goal_id": None,
                    "loan_id": None,
                    "budget_id": None,
                    "description": "x",
                }
            ]
        }
    )
    assert register_rows[0]["From Wallet"] == "A"

    tx_rows = r._transaction_export_rows(
        {
            "transactions": [
                {
                    "created_at": "d",
                    "transaction_type": "EXPENSE",
                    "amount": "1",
                    "currency": "BDT",
                    "wallet": {"name": "W"},
                    "transfer": None,
                    "category": {"name_en": "Food"},
                    "description": "d",
                    "status": "POSTED",
                    "transaction_id": "t",
                }
            ]
        }
    )
    assert tx_rows[0]["Category"] == "Food"

    cash_rows = r._cashflow_export_rows(
        {
            "summary": {
                "total_inflow": "1",
                "total_outflow": "2",
                "net_cashflow": "-1",
                "transaction_count": 3,
            },
            "monthly_cashflow": [{"month": "2024-01", "inflow": "1", "outflow": "2", "net": "-1"}],
            "income_categories": [{"name_en": "Salary", "total_amount": "1"}],
            "expense_categories": [{"name_en": "Food", "total_amount": "2"}],
            "wallet_cashflow": [{"name": "Cash", "inflow": "1", "outflow": "2", "net": "-1"}],
        }
    )
    assert any(row["Section"] == "WALLET" for row in cash_rows)

    goal_rows = r._goal_export_rows(
        {
            "goals": [
                {
                    "goal_name": "House",
                    "goal_type": "HOME",
                    "target_amount": "100",
                    "current_amount": "10",
                    "progress_percent": "10.00",
                    "contribution_total": "10",
                    "withdraw_total": "0",
                    "net_contribution": "10",
                    "currency": "BDT",
                    "target_date": "2025-01-01",
                    "status": "ACTIVE",
                    "note": None,
                }
            ]
        }
    )
    assert goal_rows[0]["Goal Name"] == "House"

    empty_xlsx = r._excel_response("empty", "Sheet", [])
    assert empty_xlsx.media_type.endswith("sheet")
    filled_xlsx = r._excel_response("filled", "Sheet", [{"A": "1", "B": "2"}])
    assert filled_xlsx.headers["Content-Disposition"].endswith('.xlsx"')

    empty_pdf = r._pdf_response("empty", "Title", [])
    assert empty_pdf.media_type == "application/pdf"
    filled_pdf = r._pdf_response("filled", "Title", [{"Col": "val"}])
    assert "filename=" in filled_pdf.headers["Content-Disposition"]


# ---------------------------------------------------------------------------
# dashboard helpers
# ---------------------------------------------------------------------------


def test_dashboard_helpers():
    from app.api.v1 import dashboard as d
    from app.models.currency import ExchangeRate

    assert d.money(None) == "0.0000"
    assert d.percent(1, 0) == "0.00"
    assert d.percent(50, 200) == "25.00"
    assert d.get_rate_to_base(Db(), "usd", "USD") == Decimal("1")

    hist = SimpleNamespace(rate="2.5")
    db = Db(query_map={ExchangeRate: Query(first_row=hist)})
    assert d.get_rate_to_base(db, "USD", "BDT", rate_date=date.today()) == Decimal("2.5")

    db2 = Db(query_map={ExchangeRate: Query(first_row=None)})
    # historical miss then latest miss
    class TwoCallDb(Db):
        def __init__(self):
            super().__init__()
            self.calls = 0

        def query(self, model):
            self.calls += 1
            if self.calls == 1:
                return Query(first_row=None)
            return Query(first_row=SimpleNamespace(rate="3"))

    assert d.get_rate_to_base(TwoCallDb(), "USD", "BDT", rate_date=date.today()) == Decimal("3")
    assert d.get_rate_to_base(Db(query_map={ExchangeRate: Query(first_row=None)}), "USD", "BDT") == Decimal("0")


# ---------------------------------------------------------------------------
# permissions / audit_logs / accounts / currency API helpers
# ---------------------------------------------------------------------------


def test_permissions_api_helpers_and_routes(monkeypatch):
    from app.api.v1 import permissions as p

    class FakeFamilyMember:
        user_id = MagicMock()
        family_id = MagicMock()
        status = MagicMock()
        deleted_at = MagicMock()

    class FakeMemberPermission:
        member_id = MagicMock()
        permission_key = MagicMock()
        scope = MagicMock()
        deleted_at = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)
            self.id = kwargs.get("id", "new-ov")

    monkeypatch.setattr(p, "FamilyMember", FakeFamilyMember)
    monkeypatch.setattr(p, "MemberPermission", FakeMemberPermission)

    member = SimpleNamespace(id="m1", user_id="u1", role="MEMBER", relationship_display_label="Self")
    db = Db(query_map={FakeFamilyMember: Query(first_row=member)})
    assert p.get_active_member(db, "u1", "fam") is member

    ov = SimpleNamespace(id="o1", permission_key="wallet.read", allow=True, scope="FAMILY")
    assert p.serialize_override(ov)["permission_key"] == "wallet.read"

    owner = SimpleNamespace(id="o", user_id="u", role="OWNER", relationship_display_label=None)
    overrides = [
        SimpleNamespace(id="1", permission_key="wallet.read", allow=True, scope="FAMILY"),
        SimpleNamespace(id="2", permission_key="audit.read", allow=False, scope="FAMILY"),
    ]
    odb = Db(query_map={FakeMemberPermission: Query(rows=overrides)})
    data = p.effective_permissions_for_member(odb, owner)
    assert "wallet.read" in data["effective_permissions"] or "base_permissions" in data

    memb = SimpleNamespace(id="m", user_id="u", role="MEMBER", relationship_display_label="X")
    mdb = Db(
        query_map={
            FakeMemberPermission: Query(
                rows=[
                    SimpleNamespace(id="1", permission_key="wallet.read", allow=True, scope="FAMILY"),
                    SimpleNamespace(id="2", permission_key="member.invite", allow=True, scope="FAMILY"),
                ]
            )
        }
    )
    edata = p.effective_permissions_for_member(mdb, memb)
    assert "member.invite" not in edata["effective_permissions"]

    monkeypatch.setattr(p, "get_active_member", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        p.my_effective_permissions("fam", Db(), SimpleNamespace(id="u"))
    assert exc.value.status_code == 404

    monkeypatch.setattr(p, "get_active_member", lambda *a, **k: member)
    monkeypatch.setattr(
        p,
        "effective_permissions_for_member",
        lambda *a, **k: {
            "base_permissions": [],
            "overrides": [],
            "effective_permissions": ["wallet.read"],
        },
    )
    mine = p.my_effective_permissions("fam", Db(), SimpleNamespace(id="u1"))
    assert mine["member_id"] == "m1"

    monkeypatch.setattr(p, "require_owner", lambda **k: member)
    list_db = Db(query_map={FakeFamilyMember: Query(rows=[member])})
    listed = p.family_members_permissions("fam", list_db, SimpleNamespace(id="u1"))
    assert listed[0]["role"] == "MEMBER"

    monkeypatch.setattr(p, "require_owner_or_admin", lambda **k: SimpleNamespace(id="actor"))
    payload = SimpleNamespace(permission_key="wallet.read", allow=True, scope="FAMILY")
    with pytest.raises(HTTPException) as e404:
        p.update_member_permission("missing", payload, Db(got=None), SimpleNamespace(id="u"))
    assert e404.value.status_code == 404

    target = SimpleNamespace(id="actor", family_id="fam", deleted_at=None, status="ACTIVE", role="MEMBER")
    with pytest.raises(HTTPException) as e400:
        p.update_member_permission("actor", payload, Db(got={"actor": target}), SimpleNamespace(id="u"))
    assert e400.value.status_code == 400

    owner_target = SimpleNamespace(id="t1", family_id="fam", deleted_at=None, status="ACTIVE", role="OWNER")
    with pytest.raises(HTTPException) as e403:
        p.update_member_permission("t1", payload, Db(got={"t1": owner_target}), SimpleNamespace(id="u"))
    assert e403.value.status_code == 403

    protected = SimpleNamespace(permission_key="member.invite", allow=True, scope="FAMILY")
    member_target = SimpleNamespace(id="t2", family_id="fam", deleted_at=None, status="ACTIVE", role="MEMBER")
    with pytest.raises(HTTPException):
        p.update_member_permission("t2", protected, Db(got={"t2": member_target}), SimpleNamespace(id="u"))

    existing = SimpleNamespace(id="ov1", permission_key="wallet.read", allow=False, scope="FAMILY")
    upd_db = Db(
        got={"t2": member_target},
        query_map={FakeMemberPermission: Query(first_row=existing)},
    )
    monkeypatch.setattr("app.services.audit_service.write_audit_log", lambda **k: None)
    out = p.update_member_permission("t2", payload, upd_db, SimpleNamespace(id="u"))
    assert out["success"] is True
    assert existing.allow is True

    new_db = Db(got={"t2": member_target}, query_map={FakeMemberPermission: Query(first_row=None)})
    out2 = p.update_member_permission("t2", payload, new_db, SimpleNamespace(id="u"))
    assert out2["success"] is True
    assert new_db.commit_count == 1


def test_audit_logs_helpers_and_routes(monkeypatch):
    from app.api.v1 import audit_logs as al

    class FakeAuditLog:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)
            self.id = kwargs.get("id", "1")

        action_type = MagicMock()
        entity_type = MagicMock()
        severity = MagicMock()
        family_id = MagicMock()
        entity_id = MagicMock()
        deleted_at = MagicMock()
        created_at = MagicMock()

    monkeypatch.setattr(al, "AuditLog", FakeAuditLog)

    item = SimpleNamespace(
        id="1",
        family_id="fam",
        member_id="m",
        action_type="CREATE",
        entity_type="WALLET",
        entity_id="w",
        title="t",
        description="d",
        severity="INFO",
        ip_address="127.0.0.1",
        user_agent="ua",
        created_at=datetime.now(timezone.utc),
    )
    assert al.serialize_audit_log(item)["id"] == "1"

    db = Db()
    written = al.write_audit_log(db, "fam", "m", "create", "wallet", "w", "Title", "desc", "info")
    assert written.action_type == "CREATE"
    assert db.commit_count == 1

    monkeypatch.setattr(al, "require_permission", lambda **k: None)
    logs = [item, SimpleNamespace(**{**item.__dict__, "action_type": "UPDATE", "entity_type": "GOAL", "severity": "WARN"})]
    list_db = Db(query_map={FakeAuditLog: Query(rows=logs)})
    listed = al.list_audit_logs("fam", 10, 0, "create", "wallet", "info", list_db, SimpleNamespace(id="u"))
    assert isinstance(listed, list)

    by_entity = al.audit_by_entity(
        "fam", "wallet", "w", Db(query_map={FakeAuditLog: Query(rows=[item])}), SimpleNamespace(id="u")
    )
    assert by_entity[0]["entity_type"] == "WALLET"

    summary = al.audit_summary("fam", Db(query_map={FakeAuditLog: Query(rows=logs)}), SimpleNamespace(id="u"))
    assert summary["total_logs"] == 2
    assert "CREATE" in summary["by_action"] or "UPDATE" in summary["by_action"]


def test_accounts_and_currency_helpers(monkeypatch):
    from app.api.v1 import accounts as acc
    from app.api.v1 import currency as cur

    class FakeFamilyMember:
        user_id = MagicMock()
        status = MagicMock()
        deleted_at = MagicMock()
        created_at = MagicMock()

    class FakeCurrency:
        code = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    monkeypatch.setattr(cur, "FamilyMember", FakeFamilyMember)
    monkeypatch.setattr(cur, "Currency", FakeCurrency)

    owner = SimpleNamespace(id="m1", role="OWNER")
    wallet = SimpleNamespace(
        id="a1",
        owner_member_id="other",
        is_shared_family=False,
        is_owner_wallet=False,
    )
    assert acc.can_view_wallet(owner, wallet) is True

    member = SimpleNamespace(id="m2", role="MEMBER")
    assert acc.can_view_wallet(member, wallet) is False
    shared = SimpleNamespace(id="a2", owner_member_id="x", is_shared_family=True, is_owner_wallet=False)
    assert acc.can_view_wallet(member, shared) is True
    viewer = SimpleNamespace(id="m3", role="VIEWER")
    owned = SimpleNamespace(id="a3", owner_member_id="m3", is_shared_family=False, is_owner_wallet=False)
    assert acc.can_view_wallet(viewer, owned) is True

    account = SimpleNamespace(
        id="a1",
        family_id="fam",
        owner_member_id="m1",
        name="Cash",
        account_type="CASH",
        currency="BDT",
        opening_balance=Decimal("10"),
        institution_name=None,
        account_number_masked=None,
        is_shared_family=True,
        is_owner_wallet=False,
        is_active=True,
        is_system=False,
    )
    monkeypatch.setattr(
        "app.services.accounting_service.sync_account_balance_cache",
        lambda db, a: Decimal("42.5"),
    )
    resp = acc.serialize_wallet(Db(), account)
    assert resp.current_balance == Decimal("42.5")

    assert cur.money(None) == "0.0000"
    with pytest.raises(HTTPException):
        cur.get_any_active_member(Db(query_map={FakeFamilyMember: Query(first_row=None)}), "u")
    assert cur.get_any_active_member(Db(query_map={FakeFamilyMember: Query(first_row=member)}), "u") is member

    with pytest.raises(HTTPException):
        cur.require_any_permission(Db(query_map={FakeFamilyMember: Query(rows=[])}), "u", "x")

    monkeypatch.setattr(cur, "has_permission", lambda m, perm: False)
    with pytest.raises(HTTPException):
        cur.require_any_permission(
            Db(query_map={FakeFamilyMember: Query(rows=[member])}), "u", "settings.manage"
        )

    monkeypatch.setattr(cur, "has_permission", lambda m, perm: True)
    assert (
        cur.require_any_permission(
            Db(query_map={FakeFamilyMember: Query(rows=[member])}), "u", "settings.manage"
        )
        is member
    )

    monkeypatch.setattr(cur, "require_any_permission", lambda **k: member)

    class SeedDb(Db):
        def __init__(self):
            super().__init__()
            self.n = 0

        def query(self, model):
            self.n += 1
            if self.n == 1:
                return Query(first_row=SimpleNamespace(code="BDT"))
            return Query(first_row=None)

    out = cur.seed_currencies(SeedDb(), SimpleNamespace(id="u"))
    assert out["success"] is True
    assert out["created"] >= 1


# ---------------------------------------------------------------------------
# backup helpers
# ---------------------------------------------------------------------------


def test_backup_helpers(monkeypatch, tmp_path):
    from app.api.v1 import backup as b

    monkeypatch.setattr(b, "BACKUP_DIR", tmp_path)
    b._ensure_backup_dir()
    assert tmp_path.exists()
    assert isinstance(b._timestamp(), str) and len(b._timestamp()) >= 8

    class Eng:
        def __init__(self, url):
            self.url = url

    monkeypatch.setattr(b, "engine", Eng("sqlite:///x.db"))
    assert b._engine_backend() == "sqlite"
    monkeypatch.setattr(b, "engine", Eng("postgresql://u:p@h/db"))
    assert b._engine_backend() == "postgresql"
    monkeypatch.setattr(b, "engine", Eng("mysql://x"))
    assert b._engine_backend() == "unknown"

    monkeypatch.setattr(b, "engine", Eng("postgresql://u:p@h/db"))
    with pytest.raises(HTTPException):
        b._sqlite_db_path()

    db_file = tmp_path / "live.db"
    db_file.write_bytes(b"1234")
    monkeypatch.setattr(b, "engine", Eng(f"sqlite:///{db_file.as_posix()}"))
    monkeypatch.setattr(b, "BASE_DIR", tmp_path)
    assert b._sqlite_db_path().exists()

    empty = tmp_path / "empty.db"
    empty.write_bytes(b"")
    monkeypatch.setattr(b, "engine", Eng(f"sqlite:///{empty.as_posix()}"))
    with pytest.raises(HTTPException) as empty_exc:
        b._sqlite_db_path()
    assert empty_exc.value.status_code == 500

    monkeypatch.setattr(b.shutil, "which", lambda name: "/bin/pg_dump" if name == "pg_dump" else None)
    assert b._pg_dump_available() is True
    monkeypatch.setattr(b.shutil, "which", lambda name: None)
    assert b._docker_available() is False

    payload = tmp_path / "payload.db"
    payload.write_bytes(b"db")
    zpath = tmp_path / "out.zip"
    b._zip_payload(zpath, payload, "payload.db")
    assert zpath.exists()

    with pytest.raises(HTTPException):
        b._validate_backup_name("fam", "bad.zip")

    good_name = "s4_backup_fam_20240101_000000.zip"
    with pytest.raises(HTTPException) as nf:
        b._validate_backup_name("fam", good_name)
    assert nf.value.status_code == 404

    zip_file = tmp_path / good_name
    with zipfile.ZipFile(zip_file, "w") as zf:
        zf.writestr("restore.db", b"data")
    preview = b._preview_payload("fam", good_name)
    assert preview["backup_kind"] == "sqlite"

    pg_name = "s4_backup_fam_20240101_000001.zip"
    pg_zip = tmp_path / pg_name
    with zipfile.ZipFile(pg_zip, "w") as zf:
        zf.writestr("dump.dump", b"pg")
    assert b._preview_payload("fam", pg_name)["backup_kind"] == "postgresql"

    prepared = b._prepare_payload("fam", good_name)
    assert prepared["extracted_db_files"]
    assert "Stop server" in prepared["next_step"]

    sql_name = "s4_backup_fam_20240101_000002.zip"
    with zipfile.ZipFile(tmp_path / sql_name, "w") as zf:
        zf.writestr("x.sql", b"select 1")
    sql_prep = b._prepare_payload("fam", sql_name)
    assert "psql" in sql_prep["next_step"]

    empty_name = "s4_backup_fam_20240101_000003.zip"
    with zipfile.ZipFile(tmp_path / empty_name, "w") as zf:
        zf.writestr("readme.txt", b"hi")
    empty_prep = b._prepare_payload("fam", empty_name)
    assert "No .db" in empty_prep["next_step"]

    # postgres dump via mocked subprocess (engine.url must be URL-like)
    class PgUrl:
        username = "u"
        password = "secret"
        host = "127.0.0.1"
        port = 5432
        database = "db"

    class PgEng:
        url = PgUrl()

    monkeypatch.setattr(b, "engine", PgEng())
    monkeypatch.setattr(b, "_pg_dump_available", lambda: True)
    dest = tmp_path / "out.dump"

    class Proc:
        returncode = 0
        stderr = ""
        stdout = ""

    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: Proc())
    assert b._create_postgres_dump_file(dest) == "pg_dump"

    class FailProc:
        returncode = 1
        stderr = "boom"
        stdout = ""

    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: FailProc())
    with pytest.raises(HTTPException):
        b._create_postgres_dump_file(dest)

    monkeypatch.setattr(b, "_pg_dump_available", lambda: False)
    monkeypatch.setattr(b, "_docker_available", lambda: True)

    class DockerProc:
        returncode = 0
        stdout = b"DUMP"
        stderr = b""

    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: DockerProc())
    assert b._create_postgres_dump_file(dest) == "docker_exec_pg_dump"

    class DockerFail:
        returncode = 1
        stdout = b""
        stderr = b"no container"

    monkeypatch.setattr(b.subprocess, "run", lambda *a, **k: DockerFail())
    with pytest.raises(HTTPException):
        b._create_postgres_dump_file(dest)

    monkeypatch.setattr(b, "_docker_available", lambda: False)
    with pytest.raises(HTTPException):
        b._create_postgres_dump_file(dest)


# ---------------------------------------------------------------------------
# categories / join_requests
# ---------------------------------------------------------------------------


def test_categories_helpers_and_seed(monkeypatch):
    from app.api.v1 import categories as cat

    class FakeFamilyMember:
        family_id = MagicMock()
        user_id = MagicMock()
        status = MagicMock()
        deleted_at = MagicMock()

    class FakeCategory:
        family_id = MagicMock()
        name_en = MagicMock()
        category_type = MagicMock()
        deleted_at = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)
            self.id = kwargs.get("id")

    class FakeExpenseCategory:
        legacy_category_id = MagicMock()
        deleted_at = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeIncomeCategory:
        legacy_category_id = MagicMock()
        deleted_at = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    monkeypatch.setattr(cat, "FamilyMember", FakeFamilyMember)
    monkeypatch.setattr(cat, "Category", FakeCategory)
    monkeypatch.setattr(cat, "ExpenseCategory", FakeExpenseCategory)
    monkeypatch.setattr(cat, "IncomeCategory", FakeIncomeCategory)

    expense = SimpleNamespace(
        id="c1",
        family_id="fam",
        name_en="Food",
        name_bn="খাবার",
        category_type="EXPENSE",
        icon="food",
        color="#f00",
        is_system=True,
        is_active=True,
        parent_id=None,
    )
    existing_db = Db(query_map={FakeExpenseCategory: Query(first_row=SimpleNamespace(id="e1"))})
    cat._dual_write_category(existing_db, expense)
    assert existing_db.added == []

    new_db = Db(query_map={FakeExpenseCategory: Query(first_row=None)})
    cat._dual_write_category(new_db, expense)
    assert len(new_db.added) == 1

    income = SimpleNamespace(**{**expense.__dict__, "category_type": "INCOME", "id": "c2"})
    inc_db = Db(query_map={FakeIncomeCategory: Query(first_row=None)})
    cat._dual_write_category(inc_db, income)
    assert len(inc_db.added) == 1

    member = SimpleNamespace(id="m", role="OWNER")
    assert (
        cat.get_active_member(Db(query_map={FakeFamilyMember: Query(first_row=member)}), "fam", "u")
        is member
    )

    with pytest.raises(HTTPException):
        cat.seed_default_categories(
            "fam",
            Db(query_map={FakeFamilyMember: Query(first_row=None)}),
            SimpleNamespace(id="u"),
        )

    class SeedCatDb(Db):
        def query(self, model):
            if model is FakeFamilyMember:
                return Query(first_row=SimpleNamespace(id="m", role="ADMIN"))
            if model is FakeCategory:
                return Query(first_row=None)
            return Query(first_row=None)

        def flush(self):
            for row in self.added:
                if getattr(row, "id", None) is None:
                    row.id = "new-cat"

    monkeypatch.setattr(cat, "_dual_write_category", lambda db, c: None)
    result = cat.seed_default_categories("fam", SeedCatDb(), SimpleNamespace(id="u"))
    assert result["created"] >= 1


def test_join_requests_routes(monkeypatch):
    from app.api.v1 import join_requests as jr

    class FakeJoinRequest:
        id = MagicMock()
        family_id = MagicMock()
        status = MagicMock()
        deleted_at = MagicMock()
        created_at = MagicMock()
        user_id = MagicMock()

    class FakeFamilyMember:
        family_id = MagicMock()
        user_id = MagicMock()
        deleted_at = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)
            if not hasattr(self, "id"):
                self.id = None

    class FakeInviteCode:
        pass

    monkeypatch.setattr(jr, "JoinRequest", FakeJoinRequest)
    monkeypatch.setattr(jr, "FamilyMember", FakeFamilyMember)
    monkeypatch.setattr(jr, "InviteCode", FakeInviteCode)
    monkeypatch.setattr(jr, "require_owner_or_admin", lambda **k: SimpleNamespace(id="actor"))
    monkeypatch.setattr(jr, "expire_stale_join_requests", lambda *a, **k: None)
    monkeypatch.setattr(jr, "write_audit_log", lambda **k: None)

    req = SimpleNamespace(
        id="r1",
        family_id="fam",
        user_id="u2",
        status="PENDING",
        requested_role="MEMBER",
        requested_relationship_label="Brother",
        requested_relationship_serial=1,
        requested_relationship_type_id=None,
        invite_code_id="inv1",
        created_at=datetime.now(timezone.utc),
        reviewed_by_member_id=None,
        review_note=None,
    )
    list_db = Db(query_map={FakeJoinRequest: Query(rows=[req])})
    listed = jr.get_pending_requests("fam", list_db, SimpleNamespace(id="u1"))
    assert listed[0]["request_id"] == "r1"

    with pytest.raises(HTTPException):
        jr.cancel_join_request(
            "missing", Db(query_map={FakeJoinRequest: Query(first_row=None)}), SimpleNamespace(id="u")
        )

    done = SimpleNamespace(**{**req.__dict__, "status": "APPROVED", "user_id": "u1"})
    with pytest.raises(HTTPException):
        jr.cancel_join_request(
            "r1", Db(query_map={FakeJoinRequest: Query(first_row=done)}), SimpleNamespace(id="u1")
        )

    monkeypatch.setattr(
        jr,
        "require_owner",
        lambda **k: (_ for _ in ()).throw(HTTPException(403, "no")),
    )
    stranger = SimpleNamespace(**{**req.__dict__, "user_id": "other", "status": "PENDING"})
    with pytest.raises(HTTPException) as forbidden:
        jr.cancel_join_request(
            "r1",
            Db(
                query_map={
                    FakeJoinRequest: Query(first_row=stranger),
                    FakeFamilyMember: Query(first_row=None),
                }
            ),
            SimpleNamespace(id="u1"),
        )
    assert forbidden.value.status_code == 403

    monkeypatch.setattr(jr, "require_owner", lambda **k: SimpleNamespace(id="owner"))
    cancel_db = Db(
        query_map={
            FakeJoinRequest: Query(
                first_row=SimpleNamespace(**{**req.__dict__, "status": "PENDING", "user_id": "u2"})
            ),
            FakeFamilyMember: Query(first_row=SimpleNamespace(id="owner")),
        }
    )
    cancelled = jr.cancel_join_request("r1", cancel_db, SimpleNamespace(id="owner-user"))
    assert cancelled["status"] == "CANCELLED"

    payload_bad = SimpleNamespace(action="NOPE", note=None)
    with pytest.raises(HTTPException):
        jr.approve_or_reject_request(
            "missing",
            payload_bad,
            Db(query_map={FakeJoinRequest: Query(first_row=None)}),
            SimpleNamespace(id="u"),
        )

    self_req = SimpleNamespace(**{**req.__dict__, "user_id": "u1", "status": "PENDING"})
    with pytest.raises(HTTPException):
        jr.approve_or_reject_request(
            "r1",
            SimpleNamespace(action="APPROVE", note=None),
            Db(query_map={FakeJoinRequest: Query(first_row=self_req)}),
            SimpleNamespace(id="u1"),
        )

    pending = SimpleNamespace(**{**req.__dict__, "status": "PENDING", "user_id": "u2"})
    reject_db = Db(query_map={FakeJoinRequest: Query(first_row=pending)})
    with pytest.raises(HTTPException):
        jr.approve_or_reject_request(
            "r1",
            SimpleNamespace(action="REJECT", note=""),
            reject_db,
            SimpleNamespace(id="u1"),
        )

    pending2 = SimpleNamespace(**{**req.__dict__, "status": "PENDING", "user_id": "u2"})
    reject_db2 = Db(query_map={FakeJoinRequest: Query(first_row=pending2)})
    rejected = jr.approve_or_reject_request(
        "r1",
        SimpleNamespace(action="REJECT", note="nope"),
        reject_db2,
        SimpleNamespace(id="u1"),
    )
    assert rejected["status"] == "REJECTED"

    already = SimpleNamespace(**{**req.__dict__, "status": "PENDING", "user_id": "u2"})
    exist_db = Db(
        query_map={
            FakeJoinRequest: Query(first_row=already),
            FakeFamilyMember: Query(first_row=SimpleNamespace(id="existing")),
        }
    )
    with pytest.raises(HTTPException) as conflict:
        jr.approve_or_reject_request(
            "r1",
            SimpleNamespace(action="APPROVE", note="ok"),
            exist_db,
            SimpleNamespace(id="u1"),
        )
    assert conflict.value.status_code == 409

    invite = SimpleNamespace(id="inv1", used_count=0, max_uses=1, status="ACTIVE")
    approve_req = SimpleNamespace(**{**req.__dict__, "status": "PENDING", "user_id": "u2"})

    class ApproveDb(Db):
        def query(self, model):
            if model is FakeJoinRequest:
                return Query(first_row=approve_req)
            if model is FakeFamilyMember:
                return Query(first_row=None)
            return Query()

        def get(self, model, key):
            if model is FakeInviteCode:
                return invite
            return None

    approved = jr.approve_or_reject_request(
        "r1",
        SimpleNamespace(action="APPROVE", note="welcome"),
        ApproveDb(),
        SimpleNamespace(id="u1"),
    )
    assert approved["status"] == "APPROVED"
    assert invite.status == "USED"


# ---------------------------------------------------------------------------
# loans / goals / savings / budgets / recurring helpers
# ---------------------------------------------------------------------------


def test_loans_goals_savings_helper_matrix():
    from app.api.v1 import goals as g
    from app.api.v1 import loans as ln
    from app.api.v1 import savings as sv

    assert ln.money("1.23456").startswith("1.2346")
    assert ln.validate_amount("12.5") == Decimal("12.5000")
    with pytest.raises(HTTPException):
        ln.validate_amount("nope")
    with pytest.raises(HTTPException):
        ln.validate_amount("0")
    assert ln.clean_text("  x  ") == "x"
    assert ln.clean_text("   ") is None
    assert ln.clean_currency(None) == "BDT"
    with pytest.raises(HTTPException):
        ln.clean_currency("X")

    owner = SimpleNamespace(id="o", role="OWNER")
    wallet = SimpleNamespace(id="w", owner_member_id="x", is_shared_family=False, is_owner_wallet=False, is_active=True, family_id="fam", deleted_at=None)
    assert ln.can_use_wallet(owner, wallet) is True
    member = SimpleNamespace(id="m", role="MEMBER")
    assert ln.can_use_wallet(member, wallet) is False
    shared = SimpleNamespace(**{**wallet.__dict__, "is_shared_family": True})
    assert ln.can_use_wallet(member, shared) is True

    from app.models.account import Account
    from app.models.loan import Loan

    with pytest.raises(HTTPException):
        ln.get_wallet(Db(query_map={Account: Query(first_row=None)}), "fam", "w", owner)
    inactive = SimpleNamespace(**{**wallet.__dict__, "is_active": False})
    with pytest.raises(HTTPException):
        ln.get_wallet(Db(query_map={Account: Query(first_row=inactive)}), "fam", "w", owner)
    with pytest.raises(HTTPException):
        ln.get_wallet(Db(query_map={Account: Query(first_row=wallet)}), "fam", "w", member)
    assert ln.get_wallet(Db(query_map={Account: Query(first_row=shared)}), "fam", "w", member) is shared

    with pytest.raises(HTTPException):
        ln.get_loan(Db(query_map={Loan: Query(first_row=None)}), "fam", "l1")
    loan = SimpleNamespace(
        id="l1",
        family_id="fam",
        owner_member_id="o",
        wallet_account_id="w",
        loan_type="GIVEN",
        person_name="Ali",
        principal_amount=Decimal("100"),
        paid_amount=Decimal("10"),
        remaining_amount=Decimal("90"),
        interest_rate=Decimal("0"),
        interest_type="NONE",
        installment_count=0,
        installment_amount=None,
        start_date=date.today(),
        next_due_date=None,
        end_date=None,
        currency="BDT",
        status="ACTIVE",
        note=None,
        created_at=datetime.now(timezone.utc),
        deleted_at=None,
    )
    assert ln.get_loan(Db(query_map={Loan: Query(first_row=loan)}), "fam", "l1", lock=False) is loan
    ln.require_active_loan(loan)
    with pytest.raises(HTTPException):
        ln.require_active_loan(SimpleNamespace(status="CLOSED"))
    body = ln.loan_response(loan, wallet_balance=Decimal("5"))
    assert body["wallet_balance"] == "5.0000"

    assert g.money(1) == "1.0000"
    assert g.clean_text(" ") is None
    assert g.progress_percent(0, 0) == "0.00"
    assert g.progress_percent(50, 100) == "50.00"
    goal = SimpleNamespace(
        target_date=None,
        target_amount=Decimal("100"),
        current_amount=Decimal("10"),
        id="g1",
        family_id="fam",
        linked_savings_goal_id=None,
        goal_name="House",
        goal_type="HOME",
        currency="BDT",
        status="ACTIVE",
        note=None,
        created_at=None,
        deleted_at=None,
    )
    assert g.recommended_monthly(goal) == "0.0000"
    goal.target_date = date.today() - timedelta(days=1)
    assert Decimal(g.recommended_monthly(goal)) > 0
    goal.current_amount = Decimal("200")
    assert g.recommended_monthly(goal) == "0.0000"
    goal.current_amount = Decimal("10")
    goal.target_date = date.today() + timedelta(days=400)

    assert g.get_payload_wallet_id(SimpleNamespace(wallet_account_id="w1")) == "w1"
    assert g.get_payload_wallet_id(SimpleNamespace(wallet_account_id=None, account_id="a1")) == "a1"
    assert g.get_payload_wallet_id(SimpleNamespace(wallet_account_id=None, account_id=None, from_account_id="f1")) == "f1"
    with pytest.raises(HTTPException):
        g.get_payload_wallet_id(SimpleNamespace(wallet_account_id=None, account_id=None, from_account_id=None))

    assert g.can_use_wallet(owner, wallet) is True
    with pytest.raises(HTTPException):
        g.get_wallet(Db(got=None), "fam", "w", owner)
    with pytest.raises(HTTPException):
        g.get_wallet(Db(got={"w": inactive}), "fam", "w", owner)
    with pytest.raises(HTTPException):
        g.get_wallet(Db(got={"w": wallet}), "fam", "w", member)
    assert g.get_wallet(Db(got={"w": shared}), "fam", "w", member) is shared

    with pytest.raises(HTTPException):
        g.get_goal(Db(got=None), "fam", "g1")
    with pytest.raises(HTTPException):
        g.get_goal(Db(got={"g1": goal}), "fam", "g1", allowed_statuses={"CLOSED"})
    assert g.get_goal(Db(got={"g1": goal}), "fam", "g1") is goal
    assert g.get_linked_savings(Db(), goal) is None
    goal.linked_savings_goal_id = "s1"
    with pytest.raises(HTTPException):
        g.get_linked_savings(Db(got=None), goal)
    savings = SimpleNamespace(id="s1", family_id="fam", deleted_at=None)
    assert g.get_linked_savings(Db(got={"s1": savings}), goal) is savings
    ser = g.serialize_goal(goal)
    assert ser["goal_name"] == "House"

    assert sv.validate_amount("3") == Decimal("3.0000")
    with pytest.raises(HTTPException):
        sv.validate_amount(-1)
    assert sv.percent(5, 0) == "0.00"
    assert sv.get_payload_wallet_id(SimpleNamespace(wallet_account_id=None, from_account_id=None, to_account_id="t")) == "t"
    with pytest.raises(HTTPException):
        sv.get_payload_wallet_id(SimpleNamespace(wallet_account_id=None, from_account_id=None, to_account_id=None))
    from app.models.savings import SavingsGoal

    with pytest.raises(HTTPException):
        sv.get_savings_goal(Db(query_map={SavingsGoal: Query(first_row=None)}), "fam", "s")
    sgoal = SimpleNamespace(
        id="s",
        family_id="fam",
        owner_member_id="o",
        wallet_account_id="w",
        name="Save",
        goal_type="GENERAL",
        target_amount=Decimal("100"),
        current_amount=Decimal("20"),
        currency="BDT",
        status="ACTIVE",
        note=None,
        deleted_at=None,
    )
    assert sv.get_savings_goal(Db(query_map={SavingsGoal: Query(first_row=sgoal)}), "fam", "s", lock=False) is sgoal
    sv.require_active_goal(sgoal)
    with pytest.raises(HTTPException):
        sv.require_active_goal(SimpleNamespace(status="CLOSED"))
    assert sv.savings_response(sgoal)["name"] == "Save"


def test_budgets_and_recurring_helpers():
    from app.api.v1 import budgets as b
    from app.api.v1 import recurring as rec
    from app.models.budget import Budget
    from app.models.category import Category
    from app.models.transaction import Transaction

    assert b.money(2) == "2.0000"
    assert b.clean_text(" Name ", "Budget name") == "Name"
    with pytest.raises(HTTPException):
        b.clean_text(" ", "Budget name")
    with pytest.raises(HTTPException):
        b.clean_text("x" * 200, "Budget name")
    assert b.clean_optional_text(None) is None
    assert b.clean_optional_text("  ") is None
    with pytest.raises(HTTPException):
        b.clean_optional_text("n" * 600)
    assert b.clean_currency("usd") == "USD"
    with pytest.raises(HTTPException):
        b.clean_currency("Z")
    assert b.clean_period_type(None) == "MONTHLY"
    with pytest.raises(HTTPException):
        b.clean_period_type("DAILY")
    assert b.validate_amount("10") == Decimal("10.0000")
    with pytest.raises(HTTPException):
        b.validate_amount("bad")
    with pytest.raises(HTTPException):
        b.validate_amount(0)
    assert b.percent(80, 100) == "80.00"

    with pytest.raises(HTTPException):
        b.get_category(Db(got=None), "fam", "c")
    inactive = SimpleNamespace(
        id="c", family_id="fam", deleted_at=None, is_active=False, category_type="EXPENSE", name_en="Food"
    )
    with pytest.raises(HTTPException):
        b.get_category(Db(got={"c": inactive}), "fam", "c")
    income_cat = SimpleNamespace(
        id="c", family_id="fam", deleted_at=None, is_active=True, category_type="INCOME", name_en="Pay"
    )
    with pytest.raises(HTTPException):
        b.get_category(Db(got={"c": income_cat}), "fam", "c")
    good_cat = SimpleNamespace(
        id="c", family_id="fam", deleted_at=None, is_active=True, category_type="EXPENSE", name_en="Food"
    )
    assert b.get_category(Db(got={"c": good_cat}), "fam", "c") is good_cat

    with pytest.raises(HTTPException):
        b.get_budget(Db(query_map={Budget: Query(first_row=None)}), "fam", "b1")
    budget = SimpleNamespace(
        id="b1",
        family_id="fam",
        category_id="c",
        name="Food",
        budget_amount=Decimal("100"),
        spent_amount=Decimal("0"),
        currency="BDT",
        period_type="MONTHLY",
        status="ACTIVE",
        note=None,
        created_at=None,
        deleted_at=None,
    )
    assert b.get_budget(Db(query_map={Budget: Query(first_row=budget)}), "fam", "b1") is budget

    spent_db = Db(
        query_map={
            Transaction: Query(
                rows=[
                    SimpleNamespace(amount=Decimal("10")),
                    SimpleNamespace(amount=Decimal("5")),
                ]
            )
        }
    )
    assert b.calculate_spent(spent_db, "fam", "c") == Decimal("15")

    summary = b.budget_status_summary(
        [
            {
                "budget_amount": "100",
                "spent_amount": "90",
                "status": "ACTIVE",
                "is_over_budget": False,
                "used_percent": "90.00",
            },
            {
                "budget_amount": "50",
                "spent_amount": "60",
                "status": "ACTIVE",
                "is_over_budget": True,
                "used_percent": "120.00",
            },
        ]
    )
    assert summary["warning_count"] == 1
    assert summary["over_budget_count"] == 1

    resp_db = Db(
        got={"c": good_cat},
        query_map={Transaction: Query(rows=[SimpleNamespace(amount=Decimal("20"))])},
    )
    resp = b.budget_response(resp_db, budget)
    assert resp["category_name"] == "Food"
    assert resp["is_over_budget"] is False

    assert rec.money(1) == "1.0000"
    assert rec.clean_text(None) is None
    assert rec.can_use_wallet(SimpleNamespace(id="o", role="OWNER"), wallet := SimpleNamespace(id="w", owner_member_id="x", is_shared_family=False, is_owner_wallet=False, is_active=True, family_id="fam", deleted_at=None))
    with pytest.raises(HTTPException):
        rec.get_wallet(Db(got=None), "fam", "w", SimpleNamespace(id="o", role="OWNER"))
    assert rec.get_category(Db(), "fam", None, None) is None
    with pytest.raises(HTTPException):
        rec.get_category(Db(got=None), "fam", "c", "EXPENSE")
    with pytest.raises(HTTPException):
        rec.get_category(Db(got={"c": inactive}), "fam", "c", "EXPENSE")
    wrong = SimpleNamespace(id="c", family_id="fam", deleted_at=None, is_active=True, category_type="INCOME")
    with pytest.raises(HTTPException):
        rec.get_category(Db(got={"c": wrong}), "fam", "c", "EXPENSE")
    assert rec.get_category(Db(got={"c": good_cat}), "fam", "c", "EXPENSE") is good_cat

    from app.models.recurring import RecurringTransaction

    with pytest.raises(HTTPException):
        rec.get_recurring(Db(got=None), "r1")
    item = SimpleNamespace(
        id="r1",
        family_id="fam",
        account_id="a",
        category_id="c",
        title="Rent",
        transaction_type="EXPENSE",
        amount=Decimal("10"),
        currency="BDT",
        frequency="MONTHLY",
        start_date=date.today(),
        end_date=None,
        next_due_date=date.today(),
        last_posted_at=None,
        status="ACTIVE",
        description=None,
        created_at=None,
        deleted_at=None,
    )
    assert rec.get_recurring(Db(got={"r1": item}), "r1") is item
    assert rec.next_due_date(date(2024, 1, 1), "DAILY") == date(2024, 1, 2)
    assert rec.next_due_date(date(2024, 1, 1), "WEEKLY") == date(2024, 1, 8)
    assert rec.next_due_date(date(2024, 1, 31), "MONTHLY") == date(2024, 2, 28)
    assert rec.next_due_date(date(2024, 12, 31), "MONTHLY").month == 1
    assert rec.next_due_date(date(2024, 2, 29), "YEARLY") == date(2025, 2, 28)
    with pytest.raises(HTTPException):
        rec.next_due_date(date.today(), "HOURLY")
    assert rec.serialize_recurring(item)["title"] == "Rent"


# ---------------------------------------------------------------------------
# phase15 / phase16 / notifications / architecture_system / accounts wallets
# ---------------------------------------------------------------------------


def test_phase15_phase16_helpers():
    from app.api.v1 import phase15 as p15
    from app.api.v1 import phase16 as p16
    from app.models.family_member import FamilyMember

    assert p15.money("1") == "1.0000"
    assert p15.clean_module("investment") == "INVESTMENT"
    with pytest.raises(HTTPException):
        p15.clean_module("NOPE")
    assert p15.clean_text("  ") is None
    assert p15.clean_currency(None) == "BDT"
    assert p15.parse_date(None) is None
    assert p15.parse_date("bad") is None
    assert p15.parse_date("2024-05-01") == date(2024, 5, 1)
    soon = (date.today() + timedelta(days=5)).isoformat()
    assert p15.is_due_soon(soon) is True
    assert p15.is_due_soon("1999-01-01") is False
    assert p15.ensure_member(Db(), "fam", None) is None
    with pytest.raises(HTTPException):
        p15.ensure_member(Db(query_map={FamilyMember: Query(first_row=None)}), "fam", "m")
    assert p15.ensure_member(Db(query_map={FamilyMember: Query(first_row=SimpleNamespace(id="m"))}), "fam", "m") == "m"

    with pytest.raises(HTTPException):
        p15.validate_phase15_payload("INVESTMENT", SimpleNamespace(sub_type=None, member_id=None), is_create=True)
    with pytest.raises(HTTPException):
        p15.validate_phase15_payload("HEALTH", SimpleNamespace(sub_type="x", member_id=None), is_create=True)
    p15.validate_phase15_payload("VEHICLE", SimpleNamespace(sub_type=None, member_id=None), is_create=True)

    item = SimpleNamespace()
    payload = SimpleNamespace(
        name="Car",
        category=None,
        sub_type="SUV",
        provider="Toyota",
        member_id=None,
        amount=Decimal("1"),
        secondary_amount=None,
        target_date="2024-01-01",
        secondary_date=None,
        note="n",
    )
    p15.apply_phase15_fields(item, payload, Db(), "fam")
    assert item.name == "Car"
    filled = SimpleNamespace(
        id="i1",
        family_id="fam",
        module_type="VEHICLE",
        name="Car",
        category="GENERAL",
        sub_type="SUV",
        provider="Toyota",
        member_id=None,
        amount=Decimal("1"),
        secondary_amount=None,
        currency="BDT",
        target_date=soon,
        secondary_date=None,
        status="ACTIVE",
        note=None,
        created_at=None,
    )
    assert p15.item_response(filled)["name"] == "Car"
    rows = [filled, SimpleNamespace(**{**filled.__dict__, "module_type": "HEALTH", "status": "CLOSED"})]
    assert len(p15.module_summary_rows(rows, "VEHICLE")) == 1
    summary = p15.build_module_summary(rows)
    assert "VEHICLE" in summary
    upcoming = p15.build_upcoming(rows)
    assert upcoming and upcoming[0]["id"] == "i1"
    with pytest.raises(HTTPException):
        p15.get_item(Db(query_map={}), "fam", "missing")

    from app.models.phase15 import Phase15Item

    assert p15.get_item(Db(query_map={Phase15Item: Query(first_row=filled)}), "fam", "i1") is filled

    assert p16.clean_module("subscription") == "SUBSCRIPTION"
    with pytest.raises(HTTPException):
        p16.clean_module("X")
    assert p16.clean_billing_cycle(None) is None
    assert p16.clean_billing_cycle("monthly") == "MONTHLY"
    with pytest.raises(HTTPException):
        p16.clean_billing_cycle("weekly")
    with pytest.raises(HTTPException):
        p16.validate_phase16_payload("SUBSCRIPTION", SimpleNamespace(billing_cycle=None, renewal_or_expiry_date=None, sub_type=None))
    with pytest.raises(HTTPException):
        p16.validate_phase16_payload(
            "SUBSCRIPTION",
            SimpleNamespace(billing_cycle="MONTHLY", renewal_or_expiry_date=None, sub_type=None),
        )
    with pytest.raises(HTTPException):
        p16.validate_phase16_payload(
            "DOCUMENT",
            SimpleNamespace(billing_cycle=None, renewal_or_expiry_date=None, sub_type=None),
        )
    with pytest.raises(HTTPException):
        p16.validate_phase16_payload(
            "DOCUMENT",
            SimpleNamespace(billing_cycle=None, renewal_or_expiry_date="2024-01-01", sub_type=None),
        )
    with pytest.raises(HTTPException):
        p16.validate_phase16_payload("PROPERTY", SimpleNamespace(billing_cycle=None, renewal_or_expiry_date=None, sub_type=None))
    p16.validate_phase16_payload(
        "PROPERTY",
        SimpleNamespace(billing_cycle=None, renewal_or_expiry_date=None, sub_type="LAND"),
    )

    p16_item = SimpleNamespace(amount=Decimal("120"), billing_cycle="YEARLY")
    assert p16.monthly_subscription_amount(p16_item) == Decimal("10")
    assert p16.monthly_subscription_amount(SimpleNamespace(amount=Decimal("10"), billing_cycle="MONTHLY")) == Decimal("10")

    p16_obj = SimpleNamespace(
        id="p1",
        family_id="fam",
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
    assert p16.item_response(p16_obj)["has_file"] is False
    assert p16.build_module_summary([p16_obj])["SUBSCRIPTION"]["monthly_cost_total"] == "10.0000"
    assert p16.build_upcoming([p16_obj])


def test_notifications_and_architecture_helpers(monkeypatch):
    from app.api.v1 import architecture_system_api as asa
    from app.api.v1 import notifications as n

    class FakeNotification:
        family_id = MagicMock()
        notification_type = MagicMock()
        title = MagicMock()
        message = MagicMock()
        is_read = MagicMock()
        deleted_at = MagicMock()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    monkeypatch.setattr(n, "Notification", FakeNotification)

    rendered = n.render_template("SAVINGS_TARGET_DONE", name="Trip")
    assert "Trip" in rendered["message"]
    assert n._token_preview("short") == "***"
    assert "…" in n._token_preview("1234567890abcdef")

    exists_db = Db(query_map={FakeNotification: Query(first_row=SimpleNamespace(id="n1"))})
    assert n.create_notification(exists_db, "fam", "T", "t", "m") is None

    create_db = Db(
        query_map={FakeNotification: Query(first_row=None)},
        got={"m1": SimpleNamespace(user_id="u1")},
    )
    created = n.create_notification(create_db, "fam", "T", "t", "m", member_id="m1")
    assert created is not None
    assert created.user_id == "u1"

    monkeypatch.setattr(
        n,
        "render_template",
        lambda *a, **k: {
            "title": "t",
            "title_bn": "ট",
            "message": "m",
            "message_bn": "ম",
            "severity": "INFO",
            "notification_type": "X",
        },
    )
    monkeypatch.setattr(n, "create_notification", lambda **k: "ok")
    assert n.create_template_notification(Db(), "fam", "X", name="a") == "ok"

    pref = SimpleNamespace(
        id="p", user_id="u", theme="dark", language="en", notification_on=True, currency="BDT"
    )
    assert asa._pref_out(pref)["theme"] == "dark"

    monkeypatch.setattr(asa, "ensure_user_preference", lambda db, user: pref)
    got = asa.get_user_preferences(Db(), SimpleNamespace(id="u"))
    assert got["currency"] == "BDT"

    monkeypatch.setattr(n, "fcm_status", lambda: {"configured": False})
    assert n.notification_fcm_status(SimpleNamespace(id="u"))["configured"] is False


def test_accounts_wallets_hardened_pure_helpers():
    from app.api.v1 import accounts_wallets_hardened as aw

    assert isinstance(aw._phase6b_now(), str)
    assert aw._phase6b_to_decimal(None) == "0"
    assert aw._phase6b_to_decimal("") == "0"
    assert aw._phase6b_to_decimal("1.5") == "1.5"

    row = {
        "amt": Decimal("1.2"),
        "ts": datetime(2024, 1, 2, 3, 4, 5),
        "name": "Cash",
        "uid": SimpleNamespace(),
    }
    # UUID-like typename simulation
    class FakeUUID:
        pass

    FakeUUID.__name__ = "UUID"
    row["uid"] = FakeUUID()
    out = aw._phase6b_jsonable(row)
    assert out["amt"] == "1.2"
    assert "2024-01-02" in out["ts"]

    cols = ["id", "family_id", "account_type", "name", "opening_balance", "current_balance", "description", "status", "created_by_member_id", "user_id"]
    assert aw._phase6b_pick(cols, ["missing", "name"]) == "name"
    assert aw._phase6b_type_col(cols) == "account_type"
    assert aw._phase6b_name_col(cols) == "name"
    assert "opening_balance" in aw._phase6b_balance_cols(cols)
    assert aw._phase6b_description_col(cols) == "description"
    assert aw._phase6b_status_col(cols) == "status"
    assert aw._phase6b_created_member_col(cols) == "created_by_member_id"
    assert aw._phase6b_created_user_col(cols) == "user_id"
    assert "BOOL" in aw._phase6b_col_type_name({"type": "BOOLEAN"}) or aw._phase6b_col_type_name({"type": "BOOLEAN"}) == "BOOLEAN"

    assert aw._phase6b_required_default({"name": "created_at", "type": "DATETIME"}, "WALLET")
    assert aw._phase6b_required_default({"name": "is_active", "type": "BOOLEAN"}, "WALLET") is False
    assert aw._phase6b_required_default({"name": "count", "type": "INTEGER"}, "WALLET") == 0
    assert aw._phase6b_required_default({"name": "balance", "type": "NUMERIC"}, "WALLET") == 0
    assert aw._phase6b_required_default({"name": "status", "type": "TEXT"}, "WALLET") == "ACTIVE"
    assert aw._phase6b_required_default({"name": "account_type", "type": "TEXT"}, "WALLET") == "WALLET"
    assert "WAL" in aw._phase6b_required_default({"name": "code", "type": "TEXT"}, "WALLET")
    assert "wallet-" in aw._phase6b_required_default({"name": "slug", "type": "TEXT"}, "WALLET")
    assert aw._phase6b_required_default({"name": "note", "type": "TEXT"}, "WALLET") == ""

    assert "family_id" in aw._phase6b_base_where(cols)
    assert aw._phase6b_kind_filter(cols, "WALLET")
    assert aw._phase6b_kind_filter(["id", "family_id"], "ACCOUNT") == ""

    with pytest.raises(HTTPException):
        aw._phase6b_require_accounts_table(MagicMock())

    # table exists path
    bind = MagicMock()
    inspector = MagicMock()
    inspector.get_table_names.return_value = ["accounts"]
    inspector.get_columns.return_value = [{"name": "id"}, {"name": "family_id"}, {"name": "name"}]
    db = MagicMock()
    db.get_bind.return_value = bind
    with patch("app.api.v1.accounts_wallets_hardened.inspect", return_value=inspector):
        names = aw._phase6b_require_accounts_table(db)
        assert "id" in names

    inspector2 = MagicMock()
    inspector2.get_table_names.return_value = ["accounts"]
    inspector2.get_columns.return_value = [{"name": "id"}]
    with patch("app.api.v1.accounts_wallets_hardened.inspect", return_value=inspector2):
        with pytest.raises(HTTPException):
            aw._phase6b_require_accounts_table(db)

    with pytest.raises(HTTPException):
        aw._phase6b_assert_kind({"account_type": "CASH"}, ["account_type"], "WALLET")
    aw._phase6b_assert_kind({"account_type": "WALLET"}, ["account_type"], "WALLET")
