"""Notification scan logic shared by HTTP endpoints and background workers."""

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.budget import Budget
from app.models.loan import Loan
from app.models.missing_features import LoanInstallment
from app.models.notification import Notification
from app.models.recurring import RecurringTransaction


SCAN_TEMPLATES = {
    "BUDGET_OVER": {
        "title": "Budget Limit Exceeded",
        "title_bn": "বাজেট সীমা অতিক্রম করেছে",
        "severity": "HIGH",
        "message": "{name} exceeded budget limit.",
        "message_bn": "{name} বাজেট সীমা অতিক্রম করেছে।",
    },
    "BUDGET_WARNING": {
        "title": "Budget Warning",
        "title_bn": "বাজেট সতর্কতা",
        "severity": "MEDIUM",
        "message": "{name} reached {percent}% usage.",
        "message_bn": "{name} বাজেটের {percent}% ব্যবহার হয়েছে।",
    },
    "RECURRING_DUE": {
        "title": "Recurring Transaction Due",
        "title_bn": "পুনরাবৃত্ত লেনদেন বাকি",
        "severity": "INFO",
        "message": "{name} due on {due_date}.",
        "message_bn": "{name} {due_date} তারিখে বাকি আছে।",
    },
    "LOAN_ACTIVE": {
        "title": "Loan Balance Reminder",
        "title_bn": "ঋণ বাকি সতর্কতা",
        "severity": "MEDIUM",
        "message": "{name} has {amount} {currency} remaining.",
        "message_bn": "{name} এর {amount} {currency} বাকি আছে।",
    },
    "LOAN_INSTALLMENT_DUE": {
        "title": "Loan Installment Due",
        "title_bn": "ঋণ কিস্তি বাকি",
        "severity": "HIGH",
        "message": "{name} installment #{installment_no} of {amount} {currency} due on {due_date}.",
        "message_bn": "{name} এর কিস্তি #{installment_no} — {amount} {currency} বাকি {due_date}।",
    },
}


def _create_template_notification(
    db: Session,
    family_id: str,
    notification_type: str,
    **values,
) -> Notification | None:
    template = SCAN_TEMPLATES[notification_type]
    title = f"{template['title']} | {template['title_bn']}"
    message = (
        f"{template['message'].format(**values)} | "
        f"{template['message_bn'].format(**values)}"
    )
    existing = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.notification_type == notification_type,
            Notification.title == title,
            Notification.message == message,
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        return None

    item = Notification(
        family_id=family_id,
        notification_type=notification_type,
        title=title,
        message=message,
        severity=template["severity"],
        is_read=False,
    )
    db.add(item)
    db.flush()
    return item


def run_family_notification_scan(db: Session, family_id: str) -> dict:
    """Create due budget, recurring, and loan notifications for one family.

    Transaction ownership remains with the caller so HTTP and Celery callers can
    choose their own commit/rollback boundary.
    """
    created_ids: list[str] = []

    def remember(item: Notification | None) -> None:
        if item is not None:
            created_ids.append(item.id)

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.status == "ACTIVE",
            Budget.deleted_at.is_(None),
        )
        .all()
    )
    for budget in budgets:
        budget_amount = Decimal(budget.budget_amount or 0)
        spent_amount = Decimal(budget.spent_amount or 0)
        if budget_amount <= 0:
            continue
        used = (spent_amount / budget_amount) * Decimal("100")
        if used >= 100:
            remember(
                _create_template_notification(
                    db, family_id, "BUDGET_OVER", name=budget.name
                )
            )
        elif used >= 80:
            remember(
                _create_template_notification(
                    db,
                    family_id,
                    "BUDGET_WARNING",
                    name=budget.name,
                    percent=str(used.quantize(Decimal("0.01"))),
                )
            )

    recurring_due = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.family_id == family_id,
            RecurringTransaction.status == "ACTIVE",
            RecurringTransaction.next_due_date <= date.today() + timedelta(days=7),
            RecurringTransaction.deleted_at.is_(None),
        )
        .all()
    )
    for recurring in recurring_due:
        remember(
            _create_template_notification(
                db,
                family_id,
                "RECURRING_DUE",
                name=recurring.title,
                due_date=str(recurring.next_due_date),
            )
        )

    active_loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.status == "ACTIVE",
            Loan.remaining_amount > 0,
            Loan.deleted_at.is_(None),
        )
        .all()
    )
    for loan in active_loans:
        remember(
            _create_template_notification(
                db,
                family_id,
                "LOAN_ACTIVE",
                name=loan.person_name,
                amount=str(Decimal(loan.remaining_amount or 0).quantize(Decimal("0.01"))),
                currency=loan.currency,
            )
        )

    horizon = date.today() + timedelta(days=7)
    due_installments = (
        db.query(LoanInstallment)
        .filter(
            LoanInstallment.family_id == family_id,
            LoanInstallment.deleted_at.is_(None),
            LoanInstallment.status.in_(["PENDING", "PARTIAL"]),
        )
        .all()
    )
    loans_by_id = {loan.id: loan for loan in active_loans}
    for installment in due_installments:
        try:
            due = date.fromisoformat(str(installment.due_date)[:10])
        except ValueError:
            continue
        if due > horizon:
            continue
        loan = loans_by_id.get(installment.loan_id)
        if loan is None:
            continue
        due_left = Decimal(installment.total_due or 0) - Decimal(
            installment.paid_amount or 0
        )
        remember(
            _create_template_notification(
                db,
                family_id,
                "LOAN_INSTALLMENT_DUE",
                name=loan.person_name,
                installment_no=str(installment.installment_no),
                amount=str(due_left.quantize(Decimal("0.01"))),
                currency=loan.currency,
                due_date=str(installment.due_date),
            )
        )

    return {
        "created_count": len(created_ids),
        "created_ids": created_ids,
    }
