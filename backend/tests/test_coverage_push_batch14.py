"""Batch-14 coverage push: remaining reports.py endpoints and Phase 8B audit reports."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

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

    def offset(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def distinct(self, *args, **kwargs):
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

    def query(self, model, *extra):
        key = (model,) + extra if extra else model
        payload = self.query_map.get(key)
        if payload is None and extra:
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

    def commit(self):
        self.commit_count += 1

    def refresh(self, entity):
        self.refresh_count += 1
        return entity

    def execute(self, stmt, params=None):
        self.executed.append((stmt, params))
        if self.execute_results:
            return self.execute_results.pop(0)
        result = MagicMock()
        result.first.return_value = None
        result.fetchall.return_value = []
        return result

    def rollback(self):
        self.rollback_count += 1


def _account(aid="a1", name="Cash", balance="100"):
    return SimpleNamespace(
        id=aid,
        name=name,
        account_type="CASH",
        currency="BDT",
        current_balance=Decimal(str(balance)),
        opening_balance=Decimal("0"),
        is_active=True,
        deleted_at=None,
        balance=Decimal(str(balance)),
    )


def _category(cid="c1"):
    return SimpleNamespace(
        id=cid,
        name_en="Food",
        name_bn="খাবার",
        category_type="EXPENSE",
        icon="x",
        color="#000",
    )


def _tx(tid, tx_type, amount, category_id="c1", member_id="m1", description=None):
    return SimpleNamespace(
        id=tid,
        amount=Decimal(str(amount)),
        currency="BDT",
        category_id=category_id,
        description=description or f"{tx_type} tx",
        created_at=NOW,
        status="POSTED",
        transaction_type=tx_type,
        deleted_at=None,
        family_id="fam1",
        created_by_member_id=member_id,
        loan_id=None,
        goal_id=None,
        transaction_number=f"N-{tid}",
    )


def _line(account_id="a1", debit=0, credit=0):
    return SimpleNamespace(
        account_id=account_id,
        debit=debit,
        credit=credit,
        transaction_id="t1",
        line_type="DEBIT" if Decimal(str(debit or 0)) > 0 else "CREDIT",
        description="line",
    )


def _member(mid="m1", name="Ali"):
    return SimpleNamespace(
        id=mid,
        user_id="u1",
        role="OWNER",
        relationship_display_label="Self",
        user=SimpleNamespace(full_name=name),
        deleted_at=None,
    )


def _loan(lid="l1", loan_type="GIVEN", principal=1000, remaining=400, paid=600, status="ACTIVE"):
    return SimpleNamespace(
        id=lid,
        person_name="Ali",
        loan_type=loan_type,
        principal_amount=Decimal(str(principal)),
        remaining_amount=Decimal(str(remaining)),
        paid_amount=Decimal(str(paid)),
        currency="BDT",
        status=status,
        deleted_at=None,
        owner_member_id="m1",
    )


def _goal(gid="g1", name="Trip", target=1000, current=250, status="ACTIVE"):
    return SimpleNamespace(
        id=gid,
        goal_name=name,
        name=name,
        goal_type="TRAVEL",
        target_amount=Decimal(str(target)),
        current_amount=Decimal(str(current)),
        currency="BDT",
        target_date=date(2025, 12, 31),
        status=status,
        note=None,
        created_at=NOW,
        deleted_at=None,
        created_by_member_id="m1",
    )


def _saving(sid="s1", name="Emergency", target=1000, current=250):
    return SimpleNamespace(
        id=sid,
        name=name,
        goal_type="EMERGENCY",
        target_amount=Decimal(str(target)),
        current_amount=Decimal(str(current)),
        currency="BDT",
        status="ACTIVE",
        deleted_at=None,
        created_at=NOW,
        owner_member_id="m1",
    )


def _budget(bid="b1", amount=500, spent=100, status="ACTIVE"):
    return SimpleNamespace(
        id=bid,
        name="Food Budget",
        category_id="c1",
        budget_amount=Decimal(str(amount)),
        spent_amount=Decimal(str(spent)),
        currency="BDT",
        period_type="MONTHLY",
        status=status,
        note=None,
        created_at=NOW,
        deleted_at=None,
        is_over_budget=Decimal(str(spent)) > Decimal(str(amount)),
    )


def _audit(aid="al1", action="CREATE", entity="WALLET", severity="INFO"):
    return SimpleNamespace(
        id=aid,
        member_id="m1",
        action_type=action,
        entity_type=entity,
        entity_id="e1",
        title="t",
        description="d",
        severity=severity,
        ip_address="127.0.0.1",
        user_agent="ua",
        created_at=NOW,
        deleted_at=None,
    )


def _rows_result(rows):
    result = MagicMock()
    row_mocks = []
    for row in rows:
        m = MagicMock()
        m._mapping = row
        row_mocks.append(m)
    result.fetchall.return_value = row_mocks
    return result


def _first_mapping(data):
    result = MagicMock()
    first = MagicMock()
    first._mapping = data
    result.first.return_value = first
    return result


@pytest.fixture
def patch_report_access(monkeypatch):
    from app.api.v1 import reports as r

    monkeypatch.setattr(r, "require_report_access", lambda *a, **k: MEMBER)
    return r


def _tx_db(rows, extra=None, got=None):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    query_map = {
        Transaction: Query(rows=rows),
        TransactionLine: Query(rows=[_line(debit=10)]),
    }
    if extra:
        query_map.update(extra)
    got_map = {"fam1": FAMILY, "c1": _category(), "a1": _account()}
    if got:
        got_map.update(got)
    return Db(query_map=query_map, got=got_map)


# ---------------------------------------------------------------------------
# reports.py — currency / analytics endpoints not covered in batch10
# ---------------------------------------------------------------------------


def test_expense_currency_report(patch_report_access):
    r = patch_report_access
    out = r.expense_currency_report("fam1", None, None, db=_tx_db([_tx("t1", "EXPENSE", 80)]), current_user=USER)
    assert out["base_currency"] == "BDT"
    assert out["summary"]["total_expense_base"] == "80.0000"
    assert out["monthly_expense_base"][0]["month"] == "2024-06"


def test_expense_currency_family_missing(patch_report_access):
    r = patch_report_access
    out = r.expense_currency_report("missing", None, None, db=Db(got={}), current_user=USER)
    assert out["detail"] == "Family not found"


def test_loan_currency_report_given_taken(patch_report_access):
    from app.models.loan import Loan

    r = patch_report_access
    db = Db(
        query_map={
            Loan: Query(rows=[_loan("l1", "GIVEN", 1000, 400, 600), _loan("l2", "TAKEN", 200, 50, 150)]),
        },
        got={"fam1": FAMILY},
    )
    out = r.loan_currency_report("fam1", db=db, current_user=USER)
    assert out["summary"]["loan_count"] == 2
    assert out["summary"]["given_remaining_base"] == "400.0000"
    assert out["summary"]["taken_remaining_base"] == "50.0000"
    assert out["summary"]["net_loan_position_base"] == "350.0000"


def test_transfer_currency_report(patch_report_access):
    r = patch_report_access
    out = r.transfer_currency_report("fam1", None, None, db=_tx_db([_tx("t1", "TRANSFER", 40)]), current_user=USER)
    assert out["summary"]["total_transfer_base"] == "40.0000"
    assert out["transfers"][0]["transaction_id"] == "t1"


def test_budget_currency_report(patch_report_access):
    from app.models.budget import Budget
    from app.models.transaction import Transaction

    r = patch_report_access
    db = Db(
        query_map={
            Budget: Query(rows=[_budget(amount=500, spent=100)]),
            Transaction: Query(rows=[_tx("e", "EXPENSE", 120)]),
        },
        got={"fam1": FAMILY, "c1": _category()},
    )
    out = r.budget_currency_report("fam1", db=db, current_user=USER)
    assert out["summary"]["budget_count"] == 1
    assert out["budgets"][0]["spent_amount"] == "120.0000"
    assert Decimal(out["summary"]["used_percent"]) > 0


def test_net_worth_report(patch_report_access):
    from app.models.account import Account
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    db = Db(
        query_map={
            Account: Query(rows=[_account()]),
            TransactionLine: Query(rows=[_line(debit=80, credit=20)]),
            SavingsGoal: Query(rows=[_saving(current=50)]),
            FinancialGoal: Query(rows=[_goal(current=25)]),
            Loan: Query(rows=[_loan(remaining=10)]),
        }
    )
    out = r.net_worth_report("fam1", db=db, current_user=USER)
    assert out["summary"]["wallet_balance"] == "60.0000"
    assert out["summary"]["net_worth"] == "125.0000"


def test_net_worth_currency_report(patch_report_access):
    from app.models.account import Account
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal

    r = patch_report_access
    db = Db(
        query_map={
            Account: Query(rows=[_account(balance=200)]),
            SavingsGoal: Query(rows=[_saving(current=50)]),
            FinancialGoal: Query(rows=[_goal(current=25)]),
            Loan: Query(rows=[_loan("g", "GIVEN", remaining=10), _loan("t", "TAKEN", remaining=5)]),
        },
        got={"fam1": FAMILY},
    )
    out = r.net_worth_currency_report("fam1", db=db, current_user=USER)
    assert out["summary"]["wallet_balance_base"] == "200.0000"
    assert out["summary"]["loan_given_base"] == "10.0000"
    assert out["summary"]["loan_taken_base"] == "5.0000"


def test_trial_balance_currency_report(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(
        "app.services.accounting_service.generate_trial_balance",
        lambda db, fid: {
            "rows": [
                {"account_name": "Cash", "coa_class": "ASSET", "currency": "BDT", "debit": "100", "credit": "0"},
                {"account_name": "Equity", "account_type": "EQUITY", "currency": "BDT", "debit": "0", "credit": "100"},
            ]
        },
    )
    out = r.trial_balance_currency_report("fam1", db=Db(got={"fam1": FAMILY}), current_user=USER)
    assert out["balanced"] is True
    assert out["debit_total_base"] == "100.0000"
    assert len(out["rows"]) == 2


def test_profit_loss_currency_report(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr("app.services.accounting_service.generate_income_statement", lambda db, fid: {"ok": True})
    db = _tx_db([_tx("i", "INCOME", 300), _tx("e", "EXPENSE", 80)])
    out = r.profit_loss_currency_report("fam1", None, None, db=db, current_user=USER)
    assert out["summary"]["total_income_base"] == "300.0000"
    assert out["summary"]["net_profit_base"] == "220.0000"
    assert out["coa_income_statement"]["ok"] is True


def test_balance_sheet_currency_report(patch_report_access):
    from app.models.account import Account
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal

    r = patch_report_access
    db = Db(
        query_map={
            Account: Query(rows=[_account(balance=500)]),
            SavingsGoal: Query(rows=[_saving(current=100)]),
            FinancialGoal: Query(rows=[_goal(current=50)]),
            Loan: Query(rows=[_loan("g", "GIVEN", remaining=20), _loan("t", "TAKEN", remaining=30)]),
        },
        got={"fam1": FAMILY},
    )
    out = r.balance_sheet_currency_report("fam1", db=db, current_user=USER)
    assert out["balance_sheet"]["balanced"] is True
    assert len(out["assets"]["receivables"]) == 1
    assert len(out["liabilities"]) == 1


def test_financial_statement_currency_report(patch_report_access):
    from app.models.account import Account
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    db = Db(
        query_map={
            Account: Query(rows=[_account(balance=100)]),
            SavingsGoal: Query(rows=[_saving(current=20)]),
            FinancialGoal: Query(rows=[_goal(current=10)]),
            Loan: Query(rows=[_loan("g", "GIVEN", remaining=5), _loan("t", "TAKEN", remaining=8)]),
            Transaction: Query(rows=[_tx("i", "INCOME", 50), _tx("e", "EXPENSE", 15), _tx("tr", "TRANSFER", 7)]),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY, "c1": _category(), "a1": _account()},
    )
    out = r.financial_statement_currency_report("fam1", db=db, current_user=USER)
    assert out["statement"]["profit_loss"]["income"] == "50.0000"
    assert out["statement"]["profit_loss"]["transfer"] == "7.0000"


def test_report_dashboard_currency(patch_report_access):
    r = patch_report_access
    out = r.report_dashboard_currency(
        "fam1",
        db=_tx_db([_tx("i", "INCOME", 90), _tx("e", "EXPENSE", 30), _tx("tr", "TRANSFER", 5)]),
        current_user=USER,
    )
    assert out["summary"]["cashflow_base"] == "60.0000"
    assert out["monthly"][0]["month"] == "2024-06"


def test_member_wise_report(patch_report_access):
    from app.models.family_member import FamilyMember
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction

    r = patch_report_access
    db = Db(
        query_map={
            FamilyMember: Query(rows=[_member()]),
            Transaction: Query(rows=[_tx("i", "INCOME", 80), _tx("e", "EXPENSE", 20)]),
            SavingsGoal: Query(rows=[_saving(current=15)]),
            FinancialGoal: Query(rows=[_goal(current=10)]),
            Loan: Query(rows=[_loan(remaining=5)]),
        }
    )
    out = r.member_wise_report("fam1", db=db, current_user=USER)
    assert out["member_count"] == 1
    assert out["members"][0]["member_name"] == "Ali"
    assert out["members"][0]["income"] == "80.0000"


def test_goal_analytics_report(patch_report_access):
    from app.models.goal import FinancialGoal

    r = patch_report_access
    db = Db(
        query_map={
            FinancialGoal: Query(
                rows=[
                    _goal("g1", "A", 100, 80, "ACTIVE"),
                    _goal("g2", "B", 100, 100, "COMPLETED"),
                    _goal("g3", "C", 100, 10, "CLOSED"),
                ]
            )
        }
    )
    out = r.goal_analytics_report("fam1", db=db, current_user=USER)
    assert out["summary"]["active_goals"] == 1
    assert out["summary"]["completed_goals"] == 1
    assert out["summary"]["closed_goals"] == 1
    assert out["goals"][0]["progress_percent"] == "100.00"


def test_savings_currency_report(patch_report_access):
    from app.models.savings import SavingsGoal

    r = patch_report_access
    db = Db(query_map={SavingsGoal: Query(rows=[_saving(current=250, target=1000)])}, got={"fam1": FAMILY})
    out = r.savings_currency_report("fam1", db=db, current_user=USER)
    assert out["summary"]["savings_count"] == 1
    assert out["savings"][0]["progress_percent"] == "25.00"


def test_goal_currency_report(patch_report_access):
    from app.models.goal import FinancialGoal

    r = patch_report_access
    db = Db(query_map={FinancialGoal: Query(rows=[_goal(current=250, target=1000)])}, got={"fam1": FAMILY})
    out = r.goal_currency_report("fam1", db=db, current_user=USER)
    assert out["summary"]["goal_count"] == 1
    assert out["goals"][0]["current_base"] == "250.0000"


def test_loan_analytics_report(patch_report_access):
    from app.models.loan import Loan

    r = patch_report_access
    db = Db(
        query_map={
            Loan: Query(
                rows=[
                    _loan("g", "GIVEN", 1000, 400, 600, "ACTIVE"),
                    _loan("t", "TAKEN", 200, 0, 200, "CLOSED"),
                ]
            )
        }
    )
    out = r.loan_analytics_report("fam1", db=db, current_user=USER)
    assert out["summary"]["active_loans"] == 1
    assert out["summary"]["closed_loans"] == 1
    assert out["summary"]["given_total"] == "1000.0000"


def test_transaction_register_report(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    db = Db(
        query_map={
            Transaction: Query(rows=[_tx("t1", "INCOME", 55)]),
            TransactionLine: Query(rows=[_line(debit=55)]),
        },
        got={"a1": _account()},
    )
    out = r.transaction_register_report("fam1", "2024-01-01", "2024-12-31", "INCOME", "POSTED", db=db, current_user=USER)
    assert out["summary"]["transaction_count"] == 1
    assert out["transactions"][0]["transaction_number"] == "N-t1"


def test_export_transaction_register_excel(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(
        r,
        "transaction_register_report",
        lambda **k: {
            "transactions": [
                {
                    "created_at": NOW,
                    "transaction_id": "t1",
                    "transaction_number": "N1",
                    "transaction_type": "EXPENSE",
                    "amount": "10",
                    "currency": "BDT",
                    "status": "POSTED",
                    "wallet": {"name": "Cash"},
                    "transfer": None,
                    "goal_id": None,
                    "loan_id": None,
                    "budget_id": None,
                    "description": "x",
                }
            ]
        },
    )
    resp = r.export_transaction_register_excel("fam1", None, None, None, None, db=Db(), current_user=USER)
    assert resp.media_type.endswith("sheet")


def test_export_transaction_register_pdf(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(r, "transaction_register_report", lambda **k: {"transactions": []})
    resp = r.export_transaction_register_pdf("fam1", None, None, None, None, db=Db(), current_user=USER)
    assert resp.media_type == "application/pdf"


def test_executive_dashboard_report(patch_report_access, monkeypatch):
    from app.models.account import Account
    from app.models.budget import Budget
    from app.models.family_member import FamilyMember

    r = patch_report_access
    monkeypatch.setattr(
        r,
        "report_dashboard",
        lambda *a, **k: {
            "dashboard": {
                "total_income": "400",
                "total_expense": "100",
                "cashflow": "300",
                "total_savings": "5",
                "net_worth": "50",
                "wallet_balance": "80",
            },
            "summary": {},
        },
    )
    monkeypatch.setattr(r, "category_wise_report", lambda *a, **k: {"summary": {}})
    monkeypatch.setattr(
        r,
        "goal_analytics_report",
        lambda *a, **k: {"summary": {"overall_progress_percent": "10", "active_goals": "1", "total_target_amount": "100"}},
    )
    monkeypatch.setattr(
        r,
        "loan_analytics_report",
        lambda *a, **k: {"summary": {"given_remaining": "0", "taken_remaining": "40"}},
    )
    monkeypatch.setattr(r, "wallet_report", lambda *a, **k: {"summary": {"total_balance": "80"}})
    db = Db(
        query_map={
            Budget: Query(rows=[_budget(amount=50, spent=90)]),
            FamilyMember: Query(rows=[_member()]),
            Account: Query(rows=[_account()]),
            Account.currency: Query(rows=[("BDT",), ("USD",)]),
        }
    )
    out = r.executive_dashboard_report("fam1", db=db, current_user=USER)
    assert out["metadata"]["mixed_currency"] is True
    assert out["financial_overview"]["cashflow"] == "300.0000"
    alert_types = {a["type"] for a in out["executive_alerts"]}
    assert "OVER_BUDGET" in alert_types
    assert "LOW_SAVINGS" in alert_types


def test_cashflow_report_inflow_outflow_transfer(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    transfer_lines = [
        SimpleNamespace(account_id="a1", credit=Decimal("25"), debit=Decimal("0"), transaction_id="tr"),
        SimpleNamespace(account_id="a2", credit=Decimal("0"), debit=Decimal("25"), transaction_id="tr"),
    ]
    db = Db(
        query_map={
            Transaction: Query(rows=[_tx("i", "INCOME", 100), _tx("e", "EXPENSE", 40), _tx("tr", "TRANSFER", 25)]),
            TransactionLine: Query(rows=transfer_lines),
        },
        got={"c1": _category(), "a1": _account("a1", "From"), "a2": _account("a2", "To")},
    )
    out = r.cashflow_report("fam1", None, None, db=db, current_user=USER)
    assert out["summary"]["total_inflow"] == "100.0000"
    assert out["summary"]["total_outflow"] == "40.0000"
    assert out["summary"]["net_cashflow"] == "60.0000"
    names = {w["name"] for w in out["wallet_cashflow"]}
    assert "From" in names and "To" in names


def test_transaction_report_type_totals(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    rows = [
        _tx("i", "INCOME", 10),
        _tx("e", "EXPENSE", 4),
        _tx("tr", "TRANSFER", 3),
        _tx("sd", "SAVINGS_DEPOSIT", 2),
        _tx("sw", "SAVINGS_WITHDRAW", 1),
        _tx("lg", "LOAN_GIVEN", 6),
        _tx("lt", "LOAN_TAKEN", 7),
        _tx("lp", "LOAN_TAKEN_PAYMENT", 1),
        _tx("gc", "GOAL_CONTRIBUTION", 8),
        _tx("gw", "GOAL_WITHDRAW", 2),
    ]
    db = Db(
        query_map={
            Transaction: Query(rows=rows),
            TransactionLine: Query(rows=[_line(debit=10)]),
        },
        got={"c1": _category(), "a1": _account()},
    )
    out = r.transaction_report("fam1", None, None, None, None, None, 100, 0, db=db, current_user=USER)
    assert out["summary"]["income"] == "10.0000"
    assert out["summary"]["loan_payment"] == "1.0000"
    assert out["summary"]["goal_contribution"] == "8.0000"
    assert out["summary"]["count"] == 10


def test_export_transactions_pdf(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(r, "transaction_report", lambda **k: {"transactions": []})
    resp = r.export_transactions_pdf("fam1", None, None, None, None, None, db=Db(), current_user=USER)
    assert resp.media_type == "application/pdf"


def test_export_cashflow_excel(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(
        r,
        "cashflow_report",
        lambda **k: {
            "summary": {"total_inflow": "0", "total_outflow": "0", "net_cashflow": "0", "transaction_count": 0},
            "monthly_cashflow": [],
            "income_categories": [],
            "expense_categories": [],
            "wallet_cashflow": [],
        },
    )
    resp = r.export_cashflow_excel("fam1", None, None, db=Db(), current_user=USER)
    assert resp.media_type.endswith("sheet")


def test_export_goals_excel(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr(
        r,
        "goal_report",
        lambda **k: {
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
                    "note": "",
                }
            ]
        },
    )
    resp = r.export_goals_excel("fam1", None, None, None, db=Db(), current_user=USER)
    assert resp.media_type.endswith("sheet")


def test_cash_flow_currency_report(patch_report_access, monkeypatch):
    r = patch_report_access
    monkeypatch.setattr("app.services.accounting_service.generate_cash_flow", lambda db, fid: {"engine": True})
    out = r.cash_flow_currency_report(
        "fam1",
        None,
        None,
        db=_tx_db([_tx("i", "INCOME", 70), _tx("e", "EXPENSE", 20), _tx("tr", "TRANSFER", 5)]),
        current_user=USER,
    )
    assert out["summary"]["net_cash_flow_base"] == "50.0000"
    assert out["coa_cash_flow"]["engine"] is True


def test_family_summary_currency_report(patch_report_access):
    from app.models.account import Account
    from app.models.goal import FinancialGoal
    from app.models.loan import Loan
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    db = Db(
        query_map={
            Account: Query(rows=[_account(balance=300)]),
            SavingsGoal: Query(rows=[_saving(current=40)]),
            FinancialGoal: Query(rows=[_goal(current=20)]),
            Loan: Query(rows=[_loan("g", "GIVEN", remaining=15), _loan("t", "TAKEN", remaining=5)]),
            Transaction: Query(rows=[_tx("i", "INCOME", 90), _tx("e", "EXPENSE", 10)]),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY},
    )
    out = r.family_summary_currency_report("fam1", db=db, current_user=USER)
    assert out["counts"]["wallets"] == 1
    assert out["summary"]["income_base"] == "90.0000"


def test_member_contribution_currency_report(patch_report_access):
    from app.models.family_member import FamilyMember
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    txs = [
        _tx("i", "INCOME", 100),
        _tx("e", "EXPENSE", 20),
        _tx("tr", "TRANSFER", 5),
        _tx("sd", "SAVINGS_DEPOSIT", 8),
        _tx("sw", "SAVINGS_WITHDRAW", 2),
        _tx("lg", "LOAN_GIVEN", 3),
        _tx("lt", "LOAN_TAKEN", 4),
    ]
    db = Db(
        query_map={
            FamilyMember: Query(rows=[_member()]),
            Transaction: Query(rows=txs),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY},
    )
    out = r.member_contribution_currency_report("fam1", None, None, db=db, current_user=USER)
    assert out["summary"]["member_count"] == 1
    assert out["members"][0]["income_base"] == "100.0000"


def test_category_analytics_currency_report(patch_report_access):
    r = patch_report_access
    out = r.category_analytics_currency_report(
        "fam1",
        None,
        None,
        db=_tx_db([_tx("i", "INCOME", 80), _tx("e", "EXPENSE", 20)]),
        current_user=USER,
    )
    assert out["summary"]["total_income_base"] == "80.0000"
    assert out["income_categories"][0]["category"]["name_en"] == "Food"


def test_member_performance_ranking_report(patch_report_access):
    from app.models.family_member import FamilyMember
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    db = Db(
        query_map={
            FamilyMember: Query(rows=[_member("m1", "Ali"), _member("m2", "Bina")]),
            Transaction: Query(rows=[_tx("i", "INCOME", 90, member_id="m1"), _tx("e", "EXPENSE", 10, member_id="m2")]),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY},
    )
    out = r.member_performance_ranking_report("fam1", None, None, db=db, current_user=USER)
    assert out["ranking"][0]["rank"] == 1
    assert out["ranking"][0]["member_name"] == "Ali"


def test_family_audit_report(patch_report_access):
    from app.models.audit_log import AuditLog

    r = patch_report_access
    log = _audit()
    db = Db(query_map={AuditLog: Query(rows=[log])}, got={"m1": _member()})
    out = r.family_audit_report("fam1", "CREATE", "WALLET", "INFO", 100, 0, db=db, current_user=USER)
    assert out["summary"]["total_logs"] == 1
    assert out["logs"][0]["member_name"] == "Ali"
    assert out["summary"]["by_action"]["CREATE"] == 1


def test_general_ledger_currency_report(patch_report_access):
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    line = _line(debit=40, credit=0)
    tx = _tx("t1", "INCOME", 40)
    db = Db(
        query_map={TransactionLine: Query(rows=[(line, tx)])},
        got={"fam1": FAMILY, "a1": _account()},
    )
    out = r.general_ledger_currency_report("fam1", "a1", None, None, 500, 0, db=db, current_user=USER)
    assert out["ledger"][0]["debit_base"] == "40.0000"
    assert out["ledger"][0]["account_name"] == "Cash"


def test_member_statement_currency_report(patch_report_access):
    from app.models.family_member import FamilyMember
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    txs = [
        _tx("i", "INCOME", 50),
        _tx("gc", "GOAL_CONTRIBUTION", 5),
        _tx("gw", "GOAL_WITHDRAW", 1),
        _tx("lgp", "LOAN_GIVEN_PAYMENT", 2),
        _tx("ltp", "LOAN_TAKEN_PAYMENT", 3),
    ]
    db = Db(
        query_map={
            FamilyMember: Query(rows=[_member()]),
            Transaction: Query(rows=txs),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY},
    )
    out = r.member_statement_currency_report("fam1", "m1", None, None, 500, 0, db=db, current_user=USER)
    assert out["member_count"] == 1
    assert out["members"][0]["summary"]["income_base"] == "50.0000"
    assert out["members"][0]["summary"]["goal_contribution_base"] == "5.0000"


def test_audit_analytics_report(patch_report_access):
    from app.models.audit_log import AuditLog

    r = patch_report_access
    db = Db(
        query_map={AuditLog: Query(rows=[_audit(), _audit("al2", "UPDATE", "LOAN", "WARN")])},
        got={"m1": _member()},
    )
    out = r.audit_analytics_report("fam1", "2024-01-01", "2024-12-31", db=db, current_user=USER)
    assert out["summary"]["total_logs"] == 2
    assert out["daily_activity"][0]["date"] == "2024-06-15"
    assert out["member_activity"][0]["log_count"] == 2


def test_family_audit_currency(patch_report_access):
    from app.models.audit_log import AuditLog
    from app.models.family_member import FamilyMember
    from app.models.user import User

    r = patch_report_access
    db = Db(
        query_map={
            AuditLog: Query(rows=[_audit(severity="WARNING")]),
            FamilyMember: Query(first_row=_member()),
            User: Query(first_row=SimpleNamespace(full_name="Ali")),
        }
    )
    out = r.family_audit_currency("fam1", "m1", "WARNING", 500, 0, db=db, current_user=USER)
    assert out["summary"]["warning_count"] == 1
    assert out["audit_logs"][0]["member_name"] == "Ali"


def test_wallets_currency_report(patch_report_access):
    from app.models.account import Account
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    line = _line(debit=15, credit=5)
    tx = _tx("t1", "INCOME", 15)
    db = Db(
        query_map={
            Account: Query(rows=[_account(balance=90)]),
            TransactionLine: Query(rows=[(line, tx)]),
        },
        got={"fam1": FAMILY},
    )
    out = r.wallets_currency_report("fam1", "a1", "2024-01-01", "2024-12-31", db=db, current_user=USER)
    assert out["summary"]["wallet_count"] == 1
    assert out["wallets"][0]["line_count"] == 1
    assert out["wallets"][0]["current_balance_base"] == "90.0000"


def test_savings_statement_currency_report(patch_report_access):
    from app.models.savings import SavingsGoal
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    saving = _saving(name="Emergency")
    txs = [
        _tx("d", "SAVINGS_DEPOSIT", 30, description="Emergency deposit"),
        _tx("w", "SAVINGS_WITHDRAW", 10, description="Emergency withdraw"),
        _tx("x", "INCOME", 5, description="other"),
    ]
    db = Db(
        query_map={
            SavingsGoal: Query(rows=[saving]),
            Transaction: Query(rows=txs),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY},
    )
    out = r.savings_statement_currency_report("fam1", "s1", None, None, db=db, current_user=USER)
    assert out["savings"][0]["deposit_base"] == "30.0000"
    assert out["savings"][0]["withdraw_base"] == "10.0000"
    assert len(out["savings"][0]["movements"]) == 2


def test_goal_statement_currency_report(patch_report_access):
    from app.models.goal import FinancialGoal
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine

    r = patch_report_access
    goal = _goal(name="Trip")
    txs = [
        _tx("c", "GOAL_CONTRIBUTION", 40, description="Trip save"),
        _tx("w", "GOAL_WITHDRAW", 5, description="Trip spend"),
    ]
    db = Db(
        query_map={
            FinancialGoal: Query(rows=[goal]),
            Transaction: Query(rows=txs),
            TransactionLine: Query(rows=[_line()]),
        },
        got={"fam1": FAMILY},
    )
    out = r.goal_statement_currency_report("fam1", "g1", None, None, db=db, current_user=USER)
    assert out["goals"][0]["contribution_base"] == "40.0000"
    assert out["goals"][0]["withdraw_base"] == "5.0000"


def test_currency_reports_family_not_found(patch_report_access):
    r = patch_report_access
    empty = Db(got={})
    assert r.loan_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.transfer_currency_report("x", None, None, db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.budget_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.net_worth_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.trial_balance_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.profit_loss_currency_report("x", None, None, db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.balance_sheet_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.financial_statement_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.report_dashboard_currency("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.savings_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"
    assert r.goal_currency_report("x", db=empty, current_user=USER)["detail"] == "Family not found"


# ---------------------------------------------------------------------------
# reports_audit_integration_hardened.py
# ---------------------------------------------------------------------------


def test_phase8b_first_json_and_columns():
    from app.api.v1 import reports_audit_integration_hardened as mod

    assert mod._phase8b_first({"Family_ID": {}}, ["family_id"]) == "Family_ID"
    assert mod._phase8b_first({}, ["id"]) is None
    ts = datetime(2024, 3, 1, 12, 0, 0)
    assert mod._phase8b_json(ts) == ts.isoformat()
    assert mod._phase8b_json(b"hello") == "hello"
    nested = mod._phase8b_json({"a": [Decimal("2"), {"b": ts}]})
    assert nested["a"][0] == 2.0
    db = Db()
    db._bind.get_table_names.return_value = ["accounts"]
    db._bind.get_columns.return_value = [{"name": "id"}]
    with patch.object(mod, "inspect", return_value=db._bind):
        assert "accounts" in mod._phase8b_tables(db)
        assert "id" in mod._phase8b_columns(db, "accounts")
        assert mod._phase8b_columns(db, "missing") == {}


def test_phase8b_require_any_permission_paths(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod

    calls = []

    def deny_then_allow(db, family_id, user, permission):
        calls.append(permission)
        if permission == "reports.view":
            raise HTTPException(status_code=403, detail="no")
        return MEMBER

    monkeypatch.setattr(mod, "_phase5b_require_permission", deny_then_allow)
    assert mod._phase8b_require_any_permission(Db(), "fam1", USER, ["reports.view", "dashboard.view"]) is MEMBER

    def boom(db, family_id, user, permission):
        raise HTTPException(status_code=500, detail="broken")

    monkeypatch.setattr(mod, "_phase5b_require_permission", boom)
    with pytest.raises(HTTPException) as exc:
        mod._phase8b_require_any_permission(Db(), "fam1", USER, ["reports.view"])
    assert exc.value.status_code == 500

    with pytest.raises(HTTPException) as empty:
        mod._phase8b_require_any_permission(Db(), "fam1", USER, [])
    assert empty.value.status_code == 403


def test_phase8b_insert_audit_paths(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod

    monkeypatch.setattr(mod, "_phase8b_tables", lambda db: set())
    db = Db()
    mod._phase8b_insert_audit(db, "fam1", USER, "REPORT_VIEW", "x", "d")
    assert db.commit_count == 0

    monkeypatch.setattr(mod, "_phase8b_tables", lambda db: {"audit_logs"})
    monkeypatch.setattr(
        mod,
        "_phase8b_columns",
        lambda db, name: {
            "id": {},
            "family_id": {},
            "user_id": {},
            "action": {},
            "entity_type": {},
            "entity_id": {},
            "description": {},
            "details": {},
            "metadata": {},
            "created_at": {},
            "updated_at": {},
        },
    )
    db2 = Db()
    mod._phase8b_insert_audit(db2, "fam1", USER, "REPORT_VIEW", "wallet-summary", "viewed")
    assert db2.commit_count == 1
    assert db2.executed

    db3 = Db()
    db3.execute = MagicMock(side_effect=RuntimeError("fail"))
    mod._phase8b_insert_audit(db3, "fam1", USER, "REPORT_VIEW", "x", "d")
    assert db3.rollback_count == 1


def test_phase8b_financial_summary_missing_table(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod

    monkeypatch.setattr(mod, "_phase8b_require_any_permission", lambda *a, **k: MEMBER)
    monkeypatch.setattr(mod, "_phase8b_tables", lambda db: {"transactions"})
    with pytest.raises(HTTPException) as exc:
        mod.phase8b_financial_summary("fam1", None, None, db=Db(), current_user=USER)
    assert exc.value.status_code == 500


def test_phase8b_financial_summary_ok(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod

    monkeypatch.setattr(mod, "_phase8b_require_any_permission", lambda *a, **k: MEMBER)
    monkeypatch.setattr(mod, "_phase8b_tables", lambda db: {"transactions", "transaction_lines", "accounts"})
    monkeypatch.setattr(
        mod,
        "_phase8b_columns",
        lambda db, name: {
            "id": {},
            "transaction_id": {},
            "account_id": {},
            "debit": {},
            "credit": {},
            "family_id": {},
            "transaction_date": {},
            "status": {},
            "account_type": {},
        },
    )
    monkeypatch.setattr(mod, "_phase8b_insert_audit", lambda *a, **k: None)
    db = Db(
        execute_results=[
            _first_mapping({"transaction_count": 2, "line_count": 4, "total_debit": Decimal("10"), "total_credit": Decimal("10")}),
            _rows_result([{"account_type": "CASH", "total_debit": 10, "total_credit": 10, "transaction_count": 2}]),
        ]
    )
    out = mod.phase8b_financial_summary("fam1", "2024-01-01", "2024-12-31", db=db, current_user=USER)
    assert out["status"] == "ok"
    assert out["summary"]["transaction_count"] == 2
    assert out["account_type_summary"][0]["account_type"] == "CASH"


def test_phase8b_account_ledger_not_found_and_ok(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod
    from app.models.account import Account

    monkeypatch.setattr(mod, "_phase8b_require_any_permission", lambda *a, **k: MEMBER)
    monkeypatch.setattr(
        mod,
        "_phase8b_columns",
        lambda db, name: {
            "id": {},
            "transaction_id": {},
            "account_id": {},
            "debit": {},
            "credit": {},
            "family_id": {},
            "transaction_date": {},
            "status": {},
            "name": {},
            "description": {},
        },
    )
    monkeypatch.setattr(mod, "_phase8b_insert_audit", lambda *a, **k: None)

    with pytest.raises(HTTPException) as missing:
        mod.phase8b_account_ledger("fam1", "a1", None, None, 100, db=Db(query_map={Account: Query(first_row=None)}), current_user=USER)
    assert missing.value.status_code == 404

    acct = _account()
    db = Db(
        query_map={Account: Query(first_row=acct)},
        execute_results=[_rows_result([{"transaction_id": "t1", "debit": 12, "credit": 2, "description": "x"}])],
    )
    out = mod.phase8b_account_ledger("fam1", "a1", None, None, 100, db=db, current_user=USER)
    assert out["account"]["name"] == "Cash"
    assert out["rows"][0]["running_balance"] == 10.0


def test_phase8b_wallet_summary(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod

    monkeypatch.setattr(mod, "_phase8b_require_any_permission", lambda *a, **k: MEMBER)
    monkeypatch.setattr(mod, "_phase8b_insert_audit", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_phase8b_columns", lambda db, name: {})
    with pytest.raises(HTTPException) as exc:
        mod.phase8b_wallet_summary("fam1", db=Db(), current_user=USER)
    assert "Account id column missing" in exc.value.detail

    monkeypatch.setattr(
        mod,
        "_phase8b_columns",
        lambda db, name: {
            "id": {},
            "name": {},
            "account_type": {},
            "currency": {},
            "opening_balance": {},
            "current_balance": {},
            "is_owner_wallet": {},
            "is_shared_family": {},
            "is_active": {},
        },
    )
    db = Db(execute_results=[_rows_result([{"id": "a1", "name": "Cash", "current_balance": Decimal("40")}])])
    out = mod.phase8b_wallet_summary("fam1", db=db, current_user=USER)
    assert out["wallet_count"] == 1
    assert out["total_current_balance"] == 40.0


def test_phase8b_audit_activity(monkeypatch):
    from app.api.v1 import reports_audit_integration_hardened as mod

    monkeypatch.setattr(mod, "_phase8b_require_any_permission", lambda *a, **k: MEMBER)
    monkeypatch.setattr(mod, "_phase8b_insert_audit", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_phase8b_tables", lambda db: set())
    empty = mod.phase8b_audit_activity("fam1", 50, db=Db(), current_user=USER)
    assert empty["available"] is False

    monkeypatch.setattr(mod, "_phase8b_tables", lambda db: {"audit_logs"})
    monkeypatch.setattr(mod, "_phase8b_columns", lambda db, name: {"action": {}})
    with pytest.raises(HTTPException) as exc:
        mod.phase8b_audit_activity("fam1", 50, db=Db(), current_user=USER)
    assert exc.value.status_code == 500

    monkeypatch.setattr(
        mod,
        "_phase8b_columns",
        lambda db, name: {
            "family_id": {},
            "created_at": {},
            "action": {},
            "entity_type": {},
            "description": {},
            "metadata": {},
        },
    )
    db = Db(execute_results=[_rows_result([{"action": "REPORT_VIEW", "entity_type": "REPORT"}])])
    out = mod.phase8b_audit_activity("fam1", 50, db=db, current_user=USER)
    assert out["available"] is True
    assert out["rows"][0]["action"] == "REPORT_VIEW"
