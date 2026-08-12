from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.account import Account
from app.models.audit_log import AuditLog
from app.models.family_member import FamilyMember
from app.models.notification import Notification
from app.models.recurring import RecurringTransaction
from app.models.transaction import Transaction


def _add_months(value: date, months: int = 1) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def move_next_due_date(item: RecurringTransaction) -> None:
    current = item.next_due_date or date.today()

    if item.frequency == "DAILY":
        item.next_due_date = current + timedelta(days=1)
    elif item.frequency == "WEEKLY":
        item.next_due_date = current + timedelta(days=7)
    elif item.frequency == "MONTHLY":
        item.next_due_date = _add_months(current, 1)
    elif item.frequency == "YEARLY":
        item.next_due_date = _add_months(current, 12)
    else:
        item.next_due_date = _add_months(current, 1)


def _get_active_family_member_id(db: Session, family_id: str) -> str | None:
    owner = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.role == "OWNER",
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )

    if owner:
        return owner.id

    member = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )

    return member.id if member else None


def _notify(
    db: Session,
    family_id: str,
    notification_type: str,
    title: str,
    message: str,
    severity: str = "INFO",
) -> None:
    db.add(
        Notification(
            family_id=family_id,
            notification_type=notification_type,
            title=title,
            message=message,
            severity=severity,
        )
    )


def process_recurring_transactions() -> None:
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
            try:
                account = (
                    db.query(Account)
                    .filter(
                        Account.id == item.account_id,
                        Account.family_id == item.family_id,
                        Account.deleted_at.is_(None),
                    )
                    .first()
                )

                if not account:
                    _notify(
                        db=db,
                        family_id=item.family_id,
                        notification_type="RECURRING_FAILED",
                        title="Recurring Failed",
                        message=f"{item.title} failed because wallet/account was not found",
                        severity="HIGH",
                    )
                    move_next_due_date(item)
                    db.commit()
                    continue

                created_by_member_id = item.created_by_member_id or _get_active_family_member_id(
                    db=db,
                    family_id=item.family_id,
                )

                if not created_by_member_id:
                    _notify(
                        db=db,
                        family_id=item.family_id,
                        notification_type="RECURRING_FAILED",
                        title="Recurring Failed",
                        message=f"{item.title} failed because no active family member was found",
                        severity="HIGH",
                    )
                    move_next_due_date(item)
                    db.commit()
                    continue

                amount = Decimal(str(item.amount))
                current_balance = Decimal(str(account.current_balance or 0))

                if item.transaction_type == "EXPENSE" and current_balance < amount:
                    _notify(
                        db=db,
                        family_id=item.family_id,
                        notification_type="RECURRING_FAILED",
                        title="Recurring Failed",
                        message=f"{item.title} failed due to insufficient balance",
                        severity="HIGH",
                    )

                    db.add(
                        AuditLog(
                            family_id=item.family_id,
                            action_type="POST_FAILED",
                            entity_type="RECURRING",
                            entity_id=item.id,
                            title="Recurring Auto Post Failed",
                            description=f"{item.title} failed due to insufficient balance",
                            severity="HIGH",
                        )
                    )

                    move_next_due_date(item)
                    db.commit()
                    continue

                transaction = Transaction(
                    family_id=item.family_id,
                    created_by_member_id=created_by_member_id,
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
                        description=f"{item.title} auto posted for {amount} {item.currency}",
                        severity="INFO",
                    )
                )

                _notify(
                    db=db,
                    family_id=item.family_id,
                    notification_type="RECURRING_POSTED",
                    title="Recurring Posted",
                    message=f"{item.title} auto posted successfully",
                    severity="INFO",
                )

                move_next_due_date(item)
                db.commit()

            except Exception as item_error:
                db.rollback()
                print(f"Recurring Scheduler Item Error [{getattr(item, 'id', 'unknown')}]:", str(item_error))

    except Exception as e:
        db.rollback()
        print("Recurring Scheduler Error:", str(e))

    finally:
        db.close()
