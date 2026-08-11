"""Focused unit coverage for finance, relationship, notification, and crypto helpers."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.zakat import apply_zakat_values, clean_currency, money as zakat_money
from app.api.v1.zakat import resolve_metal_values, zakat_response
from app.core.security import hash_password, verify_password
from app.models.budget import Budget
from app.models.loan import Loan
from app.models.missing_features import LoanInstallment, MetalRate
from app.models.notification import Notification
from app.models.recurring import RecurringTransaction
from app.models.transaction_line import TransactionLine
from app.models.zakat import ZakatRecord
from app.schemas.zakat import ZakatCalculateRequest
from app.services.accounting_service import _apply_line_to_account, _money, _money_pos, validate_balance
from app.services.loan_schedule_service import (
    add_months,
    apply_payment_to_schedule,
    build_schedule_rows,
    calc_total_interest,
    installment_response,
    money,
    parse_start_date,
    replace_loan_schedule,
)
from app.services.notification_scan_service import (
    _create_template_notification,
    run_family_notification_scan,
)
from app.services.relationship_rules import (
    group_for_label,
    resolve_serial_rank,
    validate_relationship_payload,
)


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class QueuedDb:
    def __init__(self, rows_by_model):
        self.rows_by_model = {model: list(queues) for model, queues in rows_by_model.items()}
        self.added = []
        self.flushes = 0

    def query(self, model):
        return FakeQuery(self.rows_by_model[model].pop(0))

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flushes += 1
        for row in self.added:
            if getattr(row, "id", None) is None:
                row.id = str(uuid4())


def test_password_hash_and_verify_round_trip():
    encoded = hash_password("Correct Horse 9!")
    assert encoded != "Correct Horse 9!"
    assert verify_password("Correct Horse 9!", encoded)
    assert not verify_password("wrong", encoded)


def test_accounting_money_and_balanced_lines():
    assert _money("1.23456") == Decimal("1.2346")
    assert _money_pos("0.004") == Decimal("0.0040")
    debit, credit = validate_balance(
        [
            {"account_id": "cash", "debit": "10", "credit": 0},
            {"account_id": "income", "debit": 0, "credit": "10.0000"},
        ]
    )
    assert debit == credit == Decimal("10.0000")

    model_line = TransactionLine(account_id="cash", debit=Decimal("3"), credit=Decimal("0"))
    other_line = TransactionLine(account_id="income", debit=Decimal("0"), credit=Decimal("3"))
    assert validate_balance([model_line, other_line]) == (Decimal("3.0000"), Decimal("3.0000"))


@pytest.mark.parametrize(
    ("lines", "detail"),
    [
        (None, "at least 2"),
        ([{"account_id": "a", "debit": 1}], "at least 2"),
        (
            [
                {"account_id": "a", "debit": -1, "credit": 0},
                {"account_id": "b", "debit": 0, "credit": 1},
            ],
            "cannot be negative",
        ),
        (
            [
                {"account_id": "a", "debit": 1, "credit": 1},
                {"account_id": "b", "debit": 0, "credit": 1},
            ],
            "both debit and credit",
        ),
        (
            [
                {"account_id": "a", "debit": 0, "credit": 0},
                {"account_id": "b", "debit": 0, "credit": 1},
            ],
            "must have debit or credit",
        ),
        (
            [
                {"debit": 1, "credit": 0},
                {"account_id": "b", "debit": 0, "credit": 1},
            ],
            "account_id",
        ),
        (
            [
                {"account_id": "a", "debit": 2, "credit": 0},
                {"account_id": "b", "debit": 0, "credit": 1},
            ],
            "Unbalanced",
        ),
    ],
)
def test_validate_balance_rejects_bad_journals(lines, detail):
    with pytest.raises(HTTPException, match=detail):
        validate_balance(lines)


def test_accounting_money_and_account_normal_sides():
    with pytest.raises(HTTPException, match="Invalid amount"):
        _money("not-money")
    with pytest.raises(HTTPException, match="greater than zero"):
        _money_pos(0)

    asset = SimpleNamespace(account_type="CASH", current_balance=Decimal("20"))
    liability = SimpleNamespace(account_type="LIABILITY", current_balance=Decimal("20"))
    _apply_line_to_account(asset, Decimal("5"), Decimal("2"))
    _apply_line_to_account(liability, Decimal("5"), Decimal("2"))
    assert asset.current_balance == Decimal("23")
    assert liability.current_balance == Decimal("17")


def test_relationship_group_serial_and_payload_rules():
    assert group_for_label(" Son ") == "CHILDREN"
    assert group_for_label("unknown") is None
    assert resolve_serial_rank("SPOUSE", "ELDER", 3) is None
    assert resolve_serial_rank("CHILDREN", "SECOND", None) == 2
    assert resolve_serial_rank("CHILDREN", "CUSTOM", 7) == 7
    assert resolve_serial_rank("SIBLINGS", None, 4) == 4

    child = validate_relationship_payload(
        relationship_label="Son", serial_label="YOUNGEST", linked_member_id="member"
    )
    assert child["group"] == "CHILDREN"
    assert child["relationship_serial"] == 9
    assert child["relationship_display_label"] == "Son (Youngest)"

    free_form = validate_relationship_payload(
        relationship_label="Cousin", relationship_note=" maternal "
    )
    assert free_form["group"] == "GUARDIAN_OTHER"
    assert free_form["relationship_note"] == "maternal"


@pytest.mark.parametrize(
    ("kwargs", "detail"),
    [
        ({"relationship_label": ""}, "required"),
        ({"relationship_label": "Father", "relationship_serial": 1}, "does not use"),
        ({"relationship_label": "Guardian"}, "manual relationship note"),
        ({"relationship_label": "Son's Wife"}, "linked_member_id"),
        ({"relationship_label": "Son", "serial_label": "TENTH"}, "Invalid children"),
        ({"relationship_label": "Brother", "serial_label": "CUSTOM"}, "requires relationship_serial"),
    ],
)
def test_relationship_payload_rejects_invalid_combinations(kwargs, detail):
    with pytest.raises(HTTPException, match=detail):
        validate_relationship_payload(**kwargs)


def test_loan_math_dates_and_schedule_rounding():
    assert money("1.23456") == Decimal("1.2346")
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert add_months(date(2024, 12, 31), 2) == date(2025, 2, 28)
    assert parse_start_date("2025-03-04T09:30:00") == date(2025, 3, 4)
    assert parse_start_date("invalid") == date.today()
    assert calc_total_interest(Decimal("1200"), Decimal("12"), 12, "NONE") == 0
    assert calc_total_interest(Decimal("1200"), Decimal("12"), 12, "FLAT") == Decimal("144.0000")
    reducing = calc_total_interest(Decimal("1200"), Decimal("12"), 12, "REDUCING")
    assert reducing == Decimal("78.0000")

    rows = build_schedule_rows(
        family_id="family",
        loan_id="loan",
        principal=Decimal("100"),
        annual_rate_percent=Decimal("12"),
        installment_count=3,
        interest_type="FLAT",
        start=date(2025, 1, 31),
    )
    assert len(rows) == 3
    assert sum(row.principal_due for row in rows) == Decimal("100.0000")
    assert sum(row.interest_due for row in rows) == Decimal("3.0000")
    assert rows[0].due_date == "2025-02-28"
    assert installment_response(rows[-1])["status"] == "PENDING"


def test_replace_schedule_and_apply_payment_updates_loan():
    old_pending = SimpleNamespace(status="PENDING", paid_amount=0, deleted_at=None)
    old_partial = SimpleNamespace(status="PARTIAL", paid_amount=1, deleted_at=None)
    replace_db = QueuedDb({LoanInstallment: [[old_pending, old_partial]]})
    loan = SimpleNamespace(
        id="loan",
        family_id="family",
        installment_count=2,
        start_date="2025-01-15",
        principal_amount=Decimal("200"),
        interest_rate=Decimal("0"),
        interest_type="NONE",
        installment_amount=None,
        next_due_date=None,
        end_date=None,
    )
    created = replace_loan_schedule(replace_db, loan)
    assert len(created) == 2
    assert old_pending.deleted_at is not None
    assert old_partial.deleted_at is None
    assert loan.installment_amount == Decimal("100.0000")
    assert loan.next_due_date == "2025-02-15"
    assert loan.end_date == "2025-03-15"

    paid = SimpleNamespace(total_due=10, paid_amount=10, status="PENDING", paid_at=None, due_date="d0")
    first = SimpleNamespace(total_due=100, paid_amount=0, status="PENDING", paid_at=None, due_date="d1")
    second = SimpleNamespace(total_due=100, paid_amount=0, status="PENDING", paid_at=None, due_date="d2")
    loan_row = SimpleNamespace(next_due_date=None)
    payment_db = QueuedDb(
        {
            LoanInstallment: [[paid, first, second], [second]],
            Loan: [[loan_row]],
        }
    )
    updated = apply_payment_to_schedule(
        payment_db, family_id="family", loan_id="loan", amount=Decimal("150"), paid_at="2025-04-01"
    )
    assert updated == [paid, first, second]
    assert paid.status == first.status == "PAID"
    assert second.status == "PARTIAL"
    assert second.paid_amount == Decimal("50.0000")
    assert loan_row.next_due_date == "d2"


def test_replace_schedule_skips_zero_installments():
    db = QueuedDb({})
    assert replace_loan_schedule(db, SimpleNamespace(installment_count=0)) == []


def test_notification_scan_covers_all_templates_and_skips_invalid_installments():
    today = date.today()
    budgets = [
        SimpleNamespace(name="Zero", budget_amount=0, spent_amount=10),
        SimpleNamespace(name="Warning", budget_amount=100, spent_amount=85),
        SimpleNamespace(name="Over", budget_amount=100, spent_amount=110),
    ]
    recurring = [SimpleNamespace(title="Rent", next_due_date=today + timedelta(days=2))]
    loan = SimpleNamespace(
        id="loan", person_name="Lender", remaining_amount=Decimal("50.5"), currency="BDT"
    )
    installments = [
        SimpleNamespace(due_date="bad-date", loan_id="loan"),
        SimpleNamespace(due_date=(today + timedelta(days=20)).isoformat(), loan_id="loan"),
        SimpleNamespace(due_date=today.isoformat(), loan_id="missing"),
        SimpleNamespace(
            due_date=today.isoformat(),
            loan_id="loan",
            total_due=Decimal("100"),
            paid_amount=Decimal("25"),
            installment_no=3,
        ),
    ]
    db = QueuedDb(
        {
            Budget: [budgets],
            RecurringTransaction: [recurring],
            Loan: [[loan]],
            LoanInstallment: [installments],
            Notification: [[], [], [], [], []],
        }
    )
    result = run_family_notification_scan(db, "family")
    assert result["created_count"] == 5
    assert {item.notification_type for item in db.added} == {
        "BUDGET_WARNING",
        "BUDGET_OVER",
        "RECURRING_DUE",
        "LOAN_ACTIVE",
        "LOAN_INSTALLMENT_DUE",
    }
    assert any("75.00 BDT" in item.message for item in db.added)


def test_notification_creation_is_idempotent_for_unread_duplicate():
    existing = SimpleNamespace(id="existing")
    db = QueuedDb({Notification: [[existing]]})
    result = _create_template_notification(db, "family", "LOAN_ACTIVE", name="A", amount="1", currency="BDT")
    assert result is None
    assert db.added == []


class RateDb:
    def __init__(self, rates):
        self.rates = list(rates)

    def query(self, model):
        assert model is MetalRate
        return FakeQuery([self.rates.pop(0)] if self.rates and self.rates[0] is not None else [])


def test_zakat_helpers_resolve_rates_and_shape_record():
    payload = ZakatCalculateRequest(
        family_id="family",
        calculation_year=" 2026 ",
        currency=" bdt ",
        cash_amount=Decimal("100"),
        gold_grams=Decimal("2"),
        silver_grams=Decimal("3"),
        nisab_metal="GOLD",
        note=" annual ",
    )
    rates = [
        SimpleNamespace(rate_bdt=Decimal("100")),
        SimpleNamespace(rate_bdt=Decimal("10")),
        SimpleNamespace(rate_bdt=Decimal("100")),
    ]
    gold, silver, nisab = resolve_metal_values(RateDb(rates), payload)
    assert (gold, silver) == (Decimal("200.0000"), Decimal("30.0000"))
    assert nisab == Decimal("8748.0000")
    assert clean_currency(" usd ") == "USD"
    assert zakat_money("1.23456") == "1.2346"

    record = ZakatRecord(id="z", family_id="family")
    apply_zakat_values(
        record,
        payload,
        "member",
        Decimal("330"),
        Decimal("8.25"),
        gold_value=gold,
        silver_value=silver,
        nisab_amount=nisab,
    )
    result = zakat_response(record)
    assert result["calculation_year"] == "2026"
    assert result["zakat_due"] == "8.2500"
    assert result["is_zakat_due"] is False
    assert result["note"] == "annual"


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        (
            ZakatCalculateRequest(
                family_id="f", calculation_year="2026", gold_grams=1, nisab_amount=1
            ),
            "Gold rate not configured",
        ),
        (
            ZakatCalculateRequest(
                family_id="f", calculation_year="2026", silver_grams=1, nisab_amount=1
            ),
            "Silver rate not configured",
        ),
        (
            ZakatCalculateRequest(family_id="f", calculation_year="2026"),
            "rate not configured",
        ),
    ],
)
def test_zakat_rate_validation(payload, error):
    with pytest.raises(HTTPException, match=error):
        resolve_metal_values(RateDb([None]), payload)
