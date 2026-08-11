from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.account import Account
from app.models.audit_log import AuditLog
from app.models.notification import Notification
from app.models.recurring import RecurringTransaction
from app.models.transaction import Transaction


def move_next_due_date(item: RecurringTransaction):
    current = item.next_due_date

    if item.frequency == "DAILY":
        item.next_due_date = current + timedelta(days=1)

    elif item.frequency == "WEEKLY":
        item.next_due_date = current + timedelta(days=7)

    elif item.frequency == "MONTHLY":
        next_month = current.month + 1
        next_year = current.year

        if next_month > 12:
            next_month = 1
            next_year += 1

        max_day = monthrange(next_year, next_month)[1]

        item.next_due_date = date(
            next_year,
            next_month,
            min(current.day, max_day),
        )

    elif item.frequency == "YEARLY":
        try:
            item.next_due_date = date(
                current.year + 1,
                current.month,
                current.day,
            )
        except ValueError:
            item.next_due_date = date(
                current.year + 1,
                current.month,
                28,
            )


def process_recurring_transactions():
    db: Session = SessionLocal()

    try:
        today = date.today()

        due_items = (
            db.query(RecurringTransaction)
            .filter(
                RecurringTransaction.status == "ACTIVE",
                RecurringTransaction.next_due_date <= today,
                RecurringTransaction.deleted_at.is_(None),
            )
            .all()
        )

        for item in due_items:
            account = db.get(Account, item.account_id)

            if not account:
                continue

            amount = Decimal(str(item.amount))
            current_balance = Decimal(str(account.current_balance))

            if item.transaction_type == "EXPENSE" and current_balance < amount:
                db.add(
                    Notification(
                        family_id=item.family_id,
                        notification_type="RECURRING_FAILED",
                        title="Recurring Failed",
                        message=f"{item.title} failed due to insufficient balance",
                        severity="HIGH",
                    )
                )
                move_next_due_date(item)
                continue

            transaction = Transaction(
                family_id=item.family_id,
                transaction_type=item.transaction_type,
                amount=amount,
                currency=item.currency,
                description=f"Auto recurring: {item.title}",
                category_id=item.category_id,
                status="POSTED",
            )

            db.add(transaction)

            if item.transaction_type == "EXPENSE":
                account.current_balance = current_balance - amount

            elif item.transaction_type == "INCOME":
                account.current_balance = current_balance + amount

            db.add(
                AuditLog(
                    family_id=item.family_id,
                    action_type="POST",
                    entity_type="RECURRING",
                    entity_id=item.id,
                    title="Recurring Auto Posted",
                    description=(
                        f"{item.title} auto posted "
                        f"for {amount} {item.currency}"
                    ),
                    severity="INFO",
                )
            )

            db.add(
                Notification(
                    family_id=item.family_id,
                    notification_type="RECURRING_POSTED",
                    title="Recurring Posted",
                    message=f"{item.title} auto posted successfully",
                    severity="INFO",
                )
            )

            move_next_due_date(item)

        db.commit()

    except Exception as e:
        db.rollback()
        print("Recurring Scheduler Error:", str(e))

    finally:
        db.close()