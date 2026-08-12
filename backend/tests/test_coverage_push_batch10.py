"""Batch-10 coverage push: reports, dashboard, and notifications API modules."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

NOW = datetime(2024, 6, 15, 12, 0, 0)
USER = SimpleNamespace(id="u1")
MEMBER = SimpleNamespace(id="m1")
FAMILY = SimpleNamespace(default_currency="BDT")


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
        self.flush_count += 1
        for i, row in enumerate(self.added):
            if getattr(row, "id", None) is None:
                row.id = f"id-{i + 1}"

    def commit(self):
        self.commit_count += 1

    def refresh(self, entity):
        self.refresh_count += 1
        return entity


def _account(aid="a1", name="Cash"):
    return SimpleNamespace(id=aid, name=name, account_type="CASH", currency="BDT")


def _category(cid="c1"):
    return SimpleNamespace(
        id=cid,
        name_en="Food",
        name_bn="খাবার",
        category_type="EXPENSE",
        icon="x",
        color="#000",
    )


def _tx(tid, tx_type, amount, category_id="c1"):
    return SimpleNamespace(
        id=tid,
        amount=Decimal(str(amount)),
        currency="BDT",
        category_id=category_id,
        description=f"{tx_type} tx",
        created_at=NOW,
        status="POSTED",
        transaction_type=tx_type,
        deleted_at=None,
        family_id="fam1",
    )


def _line(account_id="a1", debit=0, credit=0):
    return SimpleNamespace(account_id=account_id, debit=debit, credit=credit)


@pytest.fixture
def patch_report_access(monkeypatch):
    from app.api.v1 import reports as r

    monkeypatch.setattr(r, "require_report_access", lambda *a, **k: MEMBER)
    return r


@pytest.fixture
def patch_dashboard(monkeypatch):
    from app.api.v1 import dashboard as d

    monkeypatch.setattr(d, "require_permission", lambda **k: MEMBER)
    monkeypatch.setattr(d, "_ensure_client_request_id_column", lambda db: None)
    monkeypatch.setattr("app.services.redis_cache.cache_get", lambda key: None)
    monkeypatch.setattr("app.services.redis_cache.cache_set", lambda *a, **k: None)
    return d


@pytest.fixture
def patch_notifications(monkeypatch):
    from app.api.v1 import notifications as n

    monkeypatch.setattr(n, "require_permission", lambda **k: MEMBER)
    monkeypatch.setattr(n, "get_active_member_or_403", lambda *a, **k: MEMBER)
    monkeypatch.setattr(n, "write_audit_log", lambda **k: None)
    return n


# ---------------------------------------------------------------------------
# reports.py — helpers
# ---------------------------------------------------------------------------


def test_reports_money_and_percent_helpers():
    from app.api.v1.reports import money, percent

    assert money(None) == "0.0000"
    assert money("2.5") == "2.5000"
    assert percent(0, 100) == "0.00"
    assert percent(75, 300) == "25.00"


def test_reports_date_parsers():
    from app.api.v1.reports import parse_date_end, parse_date_start

    assert parse_date_start(None) is None
    assert parse_date_end(None) is None
    start = parse_date_start("2024-03-10")
    end = parse_date_end("2024-03-10")
    assert start.hour == 0 and end.hour == 23


def test_reports_currency_rate_and_serialize(patch_report_access):
    from app.api.v1.reports import report_currency_rate, serialize_account, serialize_category
    from app.models.currency import ExchangeRate

    assert report_currency_rate(Db(), "BDT", "BDT") == Decimal("1")
    no_rate = Db(query_map={ExchangeRate: Query(first_row=None)})
    assert report_currency_rate(no_rate, "USD", "BDT") == Decimal("0")

    acct = _account()
    db = Db(got={"a1": acct})
    assert serialize_account(db, "a1")["name"] == "Cash"
    assert serialize_category(db, None) is None
    cat = _category()
    db.got = {"c1": cat}
    assert serialize_category(db, "c1")["name_en"] == "Food"


# ---------------------------------------------------------------------------
# reports.py — endpoint builders
# ---------------------------------------------------------------------------


def test_income_report_aggregates(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    income = _tx("t1", "INCOME", 500)
    db = Db(
        query_map={
            Transaction: Query(rows=[income, _tx("t2", "EXPENSE", 50)]),
            TransactionLine: Query(rows=[_line(debit=500)]),
        },
        got={"c1": _category(), "a1": _account()},
    )
    out = r.income_report("fam1", None, None, db=db, current_user=USER)
    assert out["summary"]["total_income"] == "500.0000"
    assert out["summary"]["transaction_count"] == 1
    assert out["category_income"][0]["category"]["name_en"] == "Food"


def test_expense_report_aggregates(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    expense = _tx("t1", "EXPENSE", 120)
    db = Db(
        query_map={
            Transaction: Query(rows=[expense]),
            TransactionLine: Query(rows=[_line(credit=120)]),
        },
        got={"c1": _category(), "a1": _account()},
    )
    out = r.expense_report("fam1", None, None, db=db, current_user=USER)
    assert out["summary"]["total_expense"] == "120.0000"
    assert out["wallet_expense"][0]["wallet_name"] == "Cash"


def test_wallet_report_balances(patch_report_access):
    from app.models.account import Account
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    wallet = SimpleNamespace(
        id="w1",
        name="Bank",
        account_type="BANK",
        currency="BDT",
        opening_balance=Decimal("100"),
        is_active=True,
        deleted_at=None,
    )
    db = Db(
        query_map={
            Account: Query(rows=[wallet]),
            TransactionLine: Query(rows=[_line(debit=50, credit=20)]),
        }
    )
    out = r.wallet_report("fam1", db=db, current_user=USER)
    assert out["summary"]["wallet_count"] == 1
    assert Decimal(out["wallets"][0]["balance"]) == Decimal("130.0000")


def test_family_summary_report_totals(patch_report_access):
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction

    r = patch_report_access
    db = Db(
        query_map={
            Transaction: Query(rows=[_tx("i", "INCOME", 1000), _tx("e", "EXPENSE", 200)]),
            FinancialGoal: Query(rows=[SimpleNamespace(target_amount=500, current_amount=100, deleted_at=None)]),
            Loan: Query(rows=[SimpleNamespace(remaining_amount=50, deleted_at=None)]),
            SavingsGoal: Query(rows=[SimpleNamespace(current_amount=75, deleted_at=None)]),
        }
    )
    out = r.family_summary_report("fam1", db=db, current_user=USER)
    assert out["summary"]["total_income"] == "1000.0000"
    assert out["summary"]["total_expense"] == "200.0000"
    assert out["counts"]["goals"] == 1


def test_report_dashboard_net_worth(patch_report_access):
    from app.models.account import Account
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    wallet = SimpleNamespace(id="w1", deleted_at=None)
    db = Db(
        query_map={
            Transaction: Query(rows=[_tx("i", "INCOME", 300), _tx("e", "EXPENSE", 100)]),
            SavingsGoal: Query(rows=[SimpleNamespace(current_amount=50)]),
            FinancialGoal: Query(rows=[SimpleNamespace(current_amount=25)]),
            Loan: Query(rows=[SimpleNamespace(remaining_amount=10)]),
            Account: Query(rows=[wallet]),
            TransactionLine: Query(rows=[_line(debit=40, credit=10)]),
        }
    )
    out = r.report_dashboard("fam1", db=db, current_user=USER)
    dash = out["dashboard"]
    assert dash["total_income"] == "300.0000"
    assert dash["cashflow"] == "200.0000"
    assert dash["wallet_balance"] == "30.0000"
    assert dash["net_worth"] == "95.0000"


def test_category_wise_report_splits(patch_report_access):
    from app.models.transaction import Transaction

    r = patch_report_access
    db = Db(
        query_map={
            Transaction: Query(rows=[_tx("i", "INCOME", 80), _tx("e", "EXPENSE", 30)]),
        },
        got={"c1": _category()},
    )
    out = r.category_wise_report("fam1", None, None, db=db, current_user=USER)
    assert out["summary"]["total_income"] == "80.0000"
    assert out["summary"]["total_expense"] == "30.0000"


def test_monthly_trend_report(patch_report_access):
    from app.models.transaction import Transaction

    r = patch_report_access
    db = Db(query_map={Transaction: Query(rows=[_tx("i", "INCOME", 60), _tx("e", "EXPENSE", 15)])})
    out = r.monthly_trend_report("fam1", db=db, current_user=USER)
    assert out["months"][0]["month"] == "2024-06"
    assert out["months"][0]["cashflow"] == "45.0000"


def test_yearly_trend_report(patch_report_access):
    from app.models.transaction import Transaction

    r = patch_report_access
    db = Db(query_map={Transaction: Query(rows=[_tx("i", "INCOME", 1000)])})
    out = r.yearly_trend_report("fam1", db=db, current_user=USER)
    assert out["years"][0]["year"] == "2024"
    assert out["years"][0]["income"] == "1000.0000"


def test_goal_report_with_contributions(patch_report_access):
    from app.models.goal import FinancialGoal
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    goal = SimpleNamespace(
        id="g1",
        goal_name="Trip",
        goal_type="TRAVEL",
        linked_savings_goal_id=None,
        target_amount=Decimal("1000"),
        current_amount=Decimal("200"),
        currency="BDT",
        target_date=date(2025, 12, 31),
        status="ACTIVE",
        note=None,
        created_at=NOW,
        deleted_at=None,
    )
    contrib = SimpleNamespace(
        id="tx-g",
        goal_id="g1",
        transaction_type="GOAL_CONTRIBUTION",
        amount=Decimal("50"),
        currency="BDT",
        description="save",
        created_at=NOW,
        status="POSTED",
        deleted_at=None,
        family_id="fam1",
    )
    db = Db(
        query_map={
            FinancialGoal: Query(rows=[goal]),
            Transaction: Query(rows=[contrib]),
            TransactionLine: Query(rows=[_line(debit=50)]),
        },
        got={"a1": _account()},
    )
    out = r.goal_report("fam1", None, None, None, 500, 0, db=db, current_user=USER)
    assert out["summary"]["goal_count"] == 1
    assert out["goals"][0]["contribution_total"] == "50.0000"


def test_savings_report_progress(patch_report_access):
    from app.models.savings import SavingsGoal

    r = patch_report_access
    saving = SimpleNamespace(
        id="s1",
        name="Emergency",
        goal_type="EMERGENCY",
        target_amount=Decimal("1000"),
        current_amount=Decimal("250"),
        currency="BDT",
        status="ACTIVE",
    )
    db = Db(query_map={SavingsGoal: Query(rows=[saving])})
    out = r.savings_report("fam1", db=db, current_user=USER)
    assert out["summary"]["total_saved_amount"] == "250.0000"
    assert out["savings"][0]["progress_percent"] == "25.00"


def test_savings_trend_report_chart(patch_report_access):
    from app.models.savings import SavingsGoal

    r = patch_report_access
    items = [
        SimpleNamespace(
            id="s1",
            name="A",
            goal_type="X",
            target_amount=Decimal("100"),
            current_amount=Decimal("10"),
            deleted_at=None,
            created_at=NOW,
        ),
        SimpleNamespace(
            id="s2",
            name="B",
            goal_type="Y",
            target_amount=Decimal("200"),
            current_amount=Decimal("20"),
            deleted_at=None,
            created_at=NOW,
        ),
    ]
    db = Db(query_map={SavingsGoal: Query(rows=items)})
    out = r.savings_trend_report("fam1", db=db, current_user=USER)
    assert out["point_count"] == 2
    assert out["total_saved"] == "30.0000"
    assert len(out["chart"]["bar"]) == 2


def test_loan_report_progress(patch_report_access):
    from app.models.loan import Loan

    r = patch_report_access
    loan = SimpleNamespace(
        id="l1",
        person_name="Ali",
        loan_type="GIVEN",
        principal_amount=Decimal("1000"),
        remaining_amount=Decimal("400"),
        currency="BDT",
        status="ACTIVE",
    )
    db = Db(query_map={Loan: Query(rows=[loan])})
    out = r.loan_report("fam1", db=db, current_user=USER)
    assert out["summary"]["total_paid_amount"] == "600.0000"
    assert out["loans"][0]["progress_percent"] == "60.00"


def test_budget_report_active_and_closed(patch_report_access):
    from app.models.budget import Budget
    from app.models.transaction import Transaction

    r = patch_report_access
    active = SimpleNamespace(
        id="b1",
        name="Food Budget",
        category_id="c1",
        budget_amount=Decimal("500"),
        currency="BDT",
        period_type="MONTHLY",
        status="ACTIVE",
        note=None,
        created_at=NOW,
        deleted_at=None,
    )
    closed = SimpleNamespace(
        id="b2",
        name="Old",
        category_id="c1",
        budget_amount=Decimal("100"),
        currency="BDT",
        period_type="MONTHLY",
        status="CLOSED",
        note=None,
        created_at=NOW,
        deleted_at=None,
    )
    db = Db(
        query_map={
            Budget: Query(rows=[active, closed]),
            Transaction: Query(rows=[_tx("e", "EXPENSE", 600)]),
        },
        got={"c1": _category()},
    )
    out = r.budget_report("fam1", db=db, current_user=USER)
    assert out["summary"]["active_budget_count"] == 1
    assert out["active_budgets"][0]["over_budget"] is True


def test_income_currency_report_converts(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    income = _tx("t1", "INCOME", 100)
    db = Db(
        query_map={
            Transaction: Query(rows=[income]),
            TransactionLine: Query(rows=[_line(debit=100)]),
        },
        got={"fam1": FAMILY, "c1": _category(), "a1": _account()},
    )
    out = r.income_currency_report("fam1", None, None, db=db, current_user=USER)
    assert out["base_currency"] == "BDT"
    assert out["summary"]["total_income_base"] == "100.0000"


def test_income_currency_report_family_missing(patch_report_access):
    r = patch_report_access
    out = r.income_currency_report("missing", None, None, db=Db(got={}), current_user=USER)
    assert out["detail"] == "Family not found"


def test_transaction_wallet_info_transfer(patch_report_access):
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    lines = [
        SimpleNamespace(account_id="a1", credit=Decimal("100"), debit=Decimal("0")),
        SimpleNamespace(account_id="a2", credit=Decimal("0"), debit=Decimal("100")),
    ]
    db = Db(
        query_map={TransactionLine: Query(rows=lines)},
        got={"a1": _account("a1", "From"), "a2": _account("a2", "To")},
    )
    info = r.transaction_wallet_info(db, SimpleNamespace(id="t1", transaction_type="TRANSFER"))
    assert info["transfer"]["from_wallet"]["name"] == "From"
    assert info["transfer"]["to_wallet"]["name"] == "To"


# ---------------------------------------------------------------------------
# reports.py — export helpers
# ---------------------------------------------------------------------------


def test_transaction_export_rows_with_transfer(patch_report_access):
    r = patch_report_access
    rows = r._transaction_export_rows(
        {
            "transactions": [
                {
                    "created_at": NOW,
                    "transaction_type": "TRANSFER",
                    "amount": "50",
                    "currency": "BDT",
                    "wallet": {},
                    "transfer": {
                        "from_wallet": {"name": "A"},
                        "to_wallet": {"name": "B"},
                    },
                    "category": {},
                    "description": "move",
                    "status": "POSTED",
                    "transaction_id": "t1",
                }
            ]
        }
    )
    assert rows[0]["From Wallet"] == "A"
    assert rows[0]["To Wallet"] == "B"


def test_cashflow_export_rows_all_sections(patch_report_access):
    r = patch_report_access
    rows = r._cashflow_export_rows(
        {
            "summary": {
                "total_inflow": "1",
                "total_outflow": "2",
                "net_cashflow": "-1",
                "transaction_count": 3,
            },
            "monthly_cashflow": [{"month": "2024-06", "inflow": "1", "outflow": "2", "net": "-1"}],
            "income_categories": [{"name_en": "Salary", "total_amount": "1"}],
            "expense_categories": [{"name_en": "Rent", "total_amount": "2"}],
            "wallet_cashflow": [{"name": "Cash", "inflow": "1", "outflow": "2", "net": "-1"}],
        }
    )
    sections = {row["Section"] for row in rows}
    assert {"SUMMARY", "MONTHLY", "INCOME CATEGORY", "EXPENSE CATEGORY", "WALLET"} <= sections


def test_export_transactions_excel_mocked(patch_report_access, monkeypatch):
    r = patch_report_access
    fake_report = {"transactions": []}
    monkeypatch.setattr(r, "transaction_report", lambda **k: fake_report)
    resp = r.export_transactions_excel("fam1", None, None, None, None, None, db=Db(), current_user=USER)
    assert resp.media_type.endswith("sheet")


def test_export_cashflow_pdf_mocked(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(
        r,
        "cashflow_report",
        lambda **k: {
            "summary": {
                "total_inflow": "0",
                "total_outflow": "0",
                "net_cashflow": "0",
                "transaction_count": 0,
            },
            "monthly_cashflow": [],
            "income_categories": [],
            "expense_categories": [],
            "wallet_cashflow": [],
        },
    )
    resp = r.export_cashflow_pdf("fam1", None, None, db=Db(), current_user=USER)
    assert resp.media_type == "application/pdf"


# ---------------------------------------------------------------------------
# dashboard.py
# ---------------------------------------------------------------------------


def test_dashboard_summary_cache_miss(patch_dashboard):
    from app.models.account import Account
    from app.models.budget import Budget
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction

    d = patch_dashboard
    account = SimpleNamespace(
        id="a1",
        name="Cash",
        account_type="CASH",
        current_balance=Decimal("500"),
        currency="BDT",
        is_owner_wallet=True,
        is_shared_family=False,
        is_active=True,
        deleted_at=None,
    )
    tx = SimpleNamespace(
        id="tx1",
        amount=Decimal("100"),
        transaction_type="INCOME",
        currency="BDT",
        description="pay",
        created_at=NOW,
    )
    budget = SimpleNamespace(status="ACTIVE", spent_amount=Decimal("600"), budget_amount=Decimal("500"), deleted_at=None)
    loan = SimpleNamespace(loan_type="GIVEN", remaining_amount=Decimal("50"), deleted_at=None)
    db = Db(
        query_map={
            Account: Query(rows=[account]),
            Transaction: Query(rows=[tx]),
            SavingsGoal: Query(rows=[SimpleNamespace(target_amount=100, current_amount=25, deleted_at=None)]),
            Loan: Query(rows=[loan]),
            FinancialGoal: Query(rows=[SimpleNamespace(target_amount=200, current_amount=50, deleted_at=None)]),
            Budget: Query(rows=[budget]),
        }
    )
    out = d.dashboard_summary("fam1", db=db, current_user=USER)
    assert out["_cache"] == "miss"
    assert out["summary"]["wallet_count"] == 1
    assert out["budgets"]["over_budget_count"] == 1


def test_dashboard_summary_cache_hit(patch_dashboard, monkeypatch):
    from app.api.v1 import dashboard as d

    cached = {"family_id": "fam1", "summary": {"wallet_count": 2}}
    monkeypatch.setattr("app.services.redis_cache.cache_get", lambda key: cached)
    out = d.dashboard_summary("fam1", db=Db(), current_user=USER)
    assert out["_cache"] == "hit"
    assert out["summary"]["wallet_count"] == 2


def test_dashboard_currency_summary(patch_dashboard):
    from app.models.account import Account
    from app.models.family import Family

    d = patch_dashboard
    account = SimpleNamespace(
        name="USD Wallet",
        currency="USD",
        current_balance=Decimal("10"),
        is_active=True,
        deleted_at=None,
    )
    db = Db(
        query_map={Account: Query(rows=[account])},
        got={"fam1": FAMILY},
    )
    with patch.object(d, "get_rate_to_base", return_value=Decimal("110")):
        out = d.dashboard_currency_summary("fam1", db=db, current_user=USER)
    assert out["base_currency"] == "BDT"
    assert out["total_balance"] == "1100.0000"


def test_dashboard_currency_family_not_found(patch_dashboard):
    d = patch_dashboard
    out = d.dashboard_currency_summary("missing", db=Db(got={}), current_user=USER)
    assert out["detail"] == "Family not found"


def test_networth_currency_summary(patch_dashboard):
    from app.models.account import Account
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal

    d = patch_dashboard
    db = Db(
        query_map={
            Account: Query(rows=[SimpleNamespace(name="Cash", currency="BDT", current_balance=Decimal("1000"), is_active=True, deleted_at=None)]),
            SavingsGoal: Query(rows=[SimpleNamespace(name="Fund", currency="BDT", current_amount=Decimal("200"), deleted_at=None)]),
            Loan: Query(rows=[SimpleNamespace(person_name="Bob", loan_type="TAKEN", currency="BDT", remaining_amount=Decimal("100"), deleted_at=None)]),
        },
        got={"fam1": FAMILY},
    )
    with patch.object(d, "get_rate_to_base", return_value=Decimal("1")):
        out = d.networth_currency_summary("fam1", db=db, current_user=USER)
    assert out["summary"]["net_worth"] == "1100.0000"


def test_dashboard_rate_helpers():
    from app.api.v1.dashboard import get_rate_to_base, money, percent
    from app.models.currency import ExchangeRate

    assert money(1.5) == "1.5000"
    assert percent(1, 4) == "25.00"
    assert get_rate_to_base(Db(), "BDT", "BDT") == Decimal("1")
    db = Db(query_map={ExchangeRate: Query(first_row=SimpleNamespace(rate="2"))})
    assert get_rate_to_base(db, "USD", "BDT", rate_date=date.today()) == Decimal("2")


# ---------------------------------------------------------------------------
# notifications.py
# ---------------------------------------------------------------------------


def test_render_template_budget_over():
    from app.api.v1.notifications import render_template

    out = render_template("BUDGET_OVER", name="Food")
    assert "Food" in out["message"]
    assert out["severity"] == "HIGH"


def test_render_template_loan_installment():
    from app.api.v1.notifications import render_template

    out = render_template(
        "LOAN_INSTALLMENT_DUE",
        name="Car",
        installment_no=3,
        amount="5000",
        currency="BDT",
        due_date="2024-07-01",
    )
    assert "#3" in out["message"]
    assert "Car" in out["message_bn"]


def test_create_notification_skips_duplicate(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    db = Db(query_map={Notification: Query(first_row=SimpleNamespace(id="n1"))})
    assert n.create_notification(db, "fam1", "T", "title", "msg") is None


def test_create_notification_adds_new(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    db = Db(query_map={Notification: Query(first_row=None)})
    item = n.create_notification(db, "fam1", "ALERT", "Hi", "Body", severity="LOW", user_id="u1")
    assert item is not None
    assert item.severity == "LOW"
    assert db.flush_count == 1


def test_create_template_notification(patch_notifications, monkeypatch):
    n = patch_notifications
    monkeypatch.setattr(
        n,
        "render_template",
        lambda *a, **k: {
            "notification_type": "X",
            "title": "T",
            "title_bn": "ট",
            "message": "M",
            "message_bn": "ম",
            "severity": "INFO",
        },
    )
    created = []
    monkeypatch.setattr(n, "create_notification", lambda **k: created.append(k) or "ok")
    assert n.create_template_notification(Db(), "fam1", "X", name="a") == "ok"
    assert created[0]["title"] == "T | ট"


def test_token_preview_lengths():
    from app.api.v1.notifications import _token_preview

    assert _token_preview("short") == "***"
    assert "…" in _token_preview("1234567890abcdef")


def test_notification_summary_counts(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    items = [
        SimpleNamespace(is_read=False, severity="HIGH"),
        SimpleNamespace(is_read=True, severity="MEDIUM"),
        SimpleNamespace(is_read=False, severity="LOW"),
    ]
    db = Db(query_map={Notification: Query(rows=items)})
    out = n.notification_summary("fam1", db=db, current_user=USER)
    assert out["total_notifications"] == 3
    assert out["unread_notifications"] == 2
    assert out["high_notifications"] == 1


def test_list_notifications(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    item = SimpleNamespace(
        id="n1",
        user_id="u1",
        member_id="m1",
        notification_type="TEST",
        title="T",
        message="M",
        severity="INFO",
        is_read=False,
        created_at=NOW,
    )
    db = Db(query_map={Notification: Query(rows=[item])})
    rows = n.list_notifications("fam1", db=db, current_user=USER)
    assert rows[0]["id"] == "n1"


def test_mark_as_read_success(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    item = SimpleNamespace(
        id="n1",
        family_id="fam1",
        title="Alert",
        deleted_at=None,
        is_read=False,
    )
    db = Db(got={"n1": item})
    out = n.mark_as_read("n1", db=db, current_user=USER)
    assert out["success"] is True
    assert item.is_read is True
    assert db.commit_count == 1


def test_mark_as_read_not_found(patch_notifications):
    n = patch_notifications
    with pytest.raises(HTTPException) as exc:
        n.mark_as_read("missing", db=Db(got={}), current_user=USER)
    assert exc.value.status_code == 404


def test_mark_all_read(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    items = [
        SimpleNamespace(is_read=False, deleted_at=None),
        SimpleNamespace(is_read=False, deleted_at=None),
    ]
    db = Db(query_map={Notification: Query(rows=items)})
    out = n.mark_all_read("fam1", db=db, current_user=USER)
    assert out["marked_read"] == 2
    assert all(x.is_read for x in items)


def test_delete_notification(patch_notifications):
    from app.models.notification import Notification

    n = patch_notifications
    item = SimpleNamespace(
        id="n1",
        family_id="fam1",
        title="X",
        deleted_at=None,
    )
    db = Db(got={"n1": item})
    out = n.delete_notification("n1", db=db, current_user=USER)
    assert out["success"] is True
    assert item.deleted_at is not None


def test_list_push_devices(patch_notifications):
    from app.models.architecture_auth import PushToken

    n = patch_notifications
    token = SimpleNamespace(
        id="d1",
        platform="ANDROID",
        device_id="Pixel",
        fcm_token="1234567890abcdef",
        created_at=NOW,
    )
    db = Db(query_map={PushToken: Query(rows=[token])})
    rows = n.list_push_devices("fam1", db=db, current_user=USER)
    assert rows[0]["platform"] == "ANDROID"
    assert "…" in rows[0]["token_preview"]


def test_register_push_device_new(patch_notifications, monkeypatch):
    from app.models.architecture_auth import PushToken

    n = patch_notifications
    monkeypatch.setattr(n, "fcm_status", lambda: {"configured": False})
    monkeypatch.setattr("app.services.architecture_system_hooks.upsert_device_registry", lambda *a, **k: None)
    db = Db(query_map={PushToken: Query(first_row=None)})
    payload = n.PushDeviceRegisterRequest(token="1234567890", platform="ios", device_label="Phone")
    out = n.register_push_device("fam1", payload, db=db, current_user=USER)
    assert out["registered"] is True
    assert db.commit_count >= 1


def test_unregister_push_device(patch_notifications):
    from app.models.architecture_auth import PushToken

    n = patch_notifications
    device = SimpleNamespace(id="d1", user_id="u1", deleted_at=None, is_active=True)
    db = Db(got={"d1": device})
    out = n.unregister_push_device("d1", db=db, current_user=USER)
    assert out["deleted"] is True
    assert device.is_active is False


def test_send_test_push_no_devices(patch_notifications, monkeypatch):
    from app.models.architecture_auth import PushToken

    n = patch_notifications
    monkeypatch.setattr(n, "is_fcm_configured", lambda: True)
    monkeypatch.setattr(n, "fcm_status", lambda: {"configured": True, "note": "ok"})
    db = Db(query_map={PushToken: Query(rows=[])})
    out = n.send_test_push("fam1", db=db, current_user=USER)
    assert out["sent"] is False
    assert out["devices_targeted"] == 0
