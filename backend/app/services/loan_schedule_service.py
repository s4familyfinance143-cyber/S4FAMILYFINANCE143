"""Loan installment schedule + interest helpers."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

from sqlalchemy.orm import Session

from app.models.loan import Loan
from app.core.timeutil import utc_now
from app.models.missing_features import LoanInstallment

MONEY = Decimal("0.0001")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def parse_start_date(value: str | None) -> date:
    if not value:
        return date.today()
    text = str(value).strip()[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return date.today()


def add_months(d: date, months: int) -> date:
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def calc_total_interest(
    principal: Decimal,
    annual_rate_percent: Decimal,
    installment_count: int,
    interest_type: str = "FLAT",
) -> Decimal:
    principal = money(principal)
    rate = Decimal(annual_rate_percent or 0)
    n = max(int(installment_count or 0), 0)
    itype = (interest_type or "NONE").upper().strip()
    if n <= 0 or rate <= 0 or itype in {"NONE", "ZERO"}:
        return money(0)

    years = Decimal(n) / Decimal(12)
    if itype == "REDUCING":
        principal_each = money(principal / Decimal(n))
        remaining = principal
        total = Decimal("0")
        monthly_rate = rate / Decimal("100") / Decimal("12")
        for _ in range(n):
            total += money(remaining * monthly_rate)
            remaining = money(remaining - principal_each)
            if remaining < 0:
                remaining = Decimal("0")
        return money(total)

    return money(principal * (rate / Decimal("100")) * years)


def build_schedule_rows(
    *,
    family_id: str,
    loan_id: str,
    principal: Decimal,
    annual_rate_percent: Decimal,
    installment_count: int,
    interest_type: str,
    start: date,
) -> list[LoanInstallment]:
    n = max(int(installment_count), 1)
    principal = money(principal)
    total_interest = calc_total_interest(principal, annual_rate_percent, n, interest_type)
    principal_each = money(principal / Decimal(n))
    interest_each = money(total_interest / Decimal(n)) if total_interest else money(0)

    principal_sum = principal_each * (n - 1)
    interest_sum = interest_each * (n - 1)
    last_principal = money(principal - principal_sum)
    last_interest = money(total_interest - interest_sum)

    rows: list[LoanInstallment] = []
    for i in range(1, n + 1):
        due = add_months(start, i)
        p = last_principal if i == n else principal_each
        interest = last_interest if i == n else interest_each
        total = money(p + interest)
        rows.append(
            LoanInstallment(
                family_id=family_id,
                loan_id=loan_id,
                installment_no=i,
                due_date=due.isoformat(),
                principal_due=p,
                interest_due=interest,
                total_due=total,
                paid_amount=Decimal("0"),
                status="PENDING",
            )
        )
    return rows


def replace_loan_schedule(db: Session, loan: Loan) -> list[LoanInstallment]:
    count = int(loan.installment_count or 0)
    if count <= 0:
        return []

    existing = (
        db.query(LoanInstallment)
        .filter(
            LoanInstallment.loan_id == loan.id,
            LoanInstallment.family_id == loan.family_id,
            LoanInstallment.deleted_at.is_(None),
        )
        .all()
    )
    now = utc_now()
    for row in existing:
        if (row.status or "").upper() == "PENDING" and money(row.paid_amount) == 0:
            row.deleted_at = now

    start = parse_start_date(loan.start_date)
    rows = build_schedule_rows(
        family_id=loan.family_id,
        loan_id=loan.id,
        principal=Decimal(loan.principal_amount or 0),
        annual_rate_percent=Decimal(loan.interest_rate or 0),
        installment_count=count,
        interest_type=loan.interest_type or "FLAT",
        start=start,
    )
    for row in rows:
        db.add(row)
    db.flush()

    loan.installment_amount = rows[0].total_due if rows else None
    loan.next_due_date = rows[0].due_date if rows else None
    loan.end_date = rows[-1].due_date if rows else None
    return rows


def apply_payment_to_schedule(
    db: Session,
    *,
    family_id: str,
    loan_id: str,
    amount: Decimal,
    paid_at: str | None = None,
) -> list[LoanInstallment]:
    remaining = money(amount)
    paid_day = paid_at or date.today().isoformat()
    updated: list[LoanInstallment] = []
    rows = (
        db.query(LoanInstallment)
        .filter(
            LoanInstallment.family_id == family_id,
            LoanInstallment.loan_id == loan_id,
            LoanInstallment.deleted_at.is_(None),
            LoanInstallment.status.in_(["PENDING", "PARTIAL"]),
        )
        .order_by(LoanInstallment.installment_no.asc())
        .all()
    )
    for row in rows:
        if remaining <= 0:
            break
        due_left = money(Decimal(row.total_due or 0) - Decimal(row.paid_amount or 0))
        if due_left <= 0:
            row.status = "PAID"
            row.paid_at = row.paid_at or paid_day
            updated.append(row)
            continue
        take = min(remaining, due_left)
        row.paid_amount = money(Decimal(row.paid_amount or 0) + take)
        remaining = money(remaining - take)
        if money(row.paid_amount) >= money(row.total_due):
            row.status = "PAID"
            row.paid_at = paid_day
        else:
            row.status = "PARTIAL"
        updated.append(row)

    next_pending = (
        db.query(LoanInstallment)
        .filter(
            LoanInstallment.loan_id == loan_id,
            LoanInstallment.deleted_at.is_(None),
            LoanInstallment.status.in_(["PENDING", "PARTIAL"]),
        )
        .order_by(LoanInstallment.installment_no.asc())
        .first()
    )
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if loan:
        loan.next_due_date = next_pending.due_date if next_pending else None
    return updated


def installment_response(row: LoanInstallment) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "loan_id": row.loan_id,
        "installment_no": row.installment_no,
        "due_date": row.due_date,
        "principal_due": str(money(row.principal_due)),
        "interest_due": str(money(row.interest_due)),
        "total_due": str(money(row.total_due)),
        "paid_amount": str(money(row.paid_amount)),
        "status": row.status,
        "paid_at": row.paid_at,
    }


def list_installments(db: Session, family_id: str, loan_id: str) -> Iterable[LoanInstallment]:
    return (
        db.query(LoanInstallment)
        .filter(
            LoanInstallment.family_id == family_id,
            LoanInstallment.loan_id == loan_id,
            LoanInstallment.deleted_at.is_(None),
        )
        .order_by(LoanInstallment.installment_no.asc())
        .all()
    )
