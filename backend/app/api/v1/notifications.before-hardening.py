from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.budget import Budget
from app.models.notification import Notification
from app.models.recurring import RecurringTransaction
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission

router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
)


def create_notification(
    db: Session,
    family_id: str,
    notification_type: str,
    title: str,
    message: str,
    severity: str = "INFO",
):
    exists = (
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

    if exists:
        return None

    item = Notification(
        family_id=family_id,
        notification_type=notification_type,
        title=title,
        message=message,
        severity=severity,
        is_read=False,
    )

    db.add(item)
    return item


@router.post("/scan/{family_id}")
def scan_notifications(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    created_count = 0

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
            item = create_notification(
                db=db,
                family_id=family_id,
                notification_type="BUDGET_OVER",
                title="Budget Limit Exceeded",
                message=f"{budget.name} exceeded budget limit.",
                severity="HIGH",
            )
            if item:
                created_count += 1

        elif used >= 80:
            item = create_notification(
                db=db,
                family_id=family_id,
                notification_type="BUDGET_WARNING",
                title="Budget Warning",
                message=f"{budget.name} reached {used.quantize(Decimal('0.01'))}% usage.",
                severity="MEDIUM",
            )
            if item:
                created_count += 1

    recurring_due = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.family_id == family_id,
            RecurringTransaction.status == "ACTIVE",
            RecurringTransaction.deleted_at.is_(None),
        )
        .all()
    )

    for recurring in recurring_due:
        item = create_notification(
            db=db,
            family_id=family_id,
            notification_type="RECURRING_DUE",
            title="Recurring Transaction Due",
            message=f"{recurring.title} due on {recurring.next_due_date}",
            severity="INFO",
        )
        if item:
            created_count += 1

    db.commit()

    unread_count = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
        .count()
    )

    return {
        "success": True,
        "created_notifications": created_count,
        "unread_notifications": unread_count,
    }


@router.get("/{family_id}")
def list_notifications(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    items = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.deleted_at.is_(None),
        )
        .order_by(Notification.created_at.desc())
        .all()
    )

    return [
        {
            "id": item.id,
            "notification_type": item.notification_type,
            "title": item.title,
            "message": item.message,
            "severity": item.severity,
            "is_read": item.is_read,
            "created_at": item.created_at,
        }
        for item in items
    ]


@router.patch("/read/{notification_id}")
def mark_as_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.get(Notification, notification_id)

    if not item or item.deleted_at is not None:
        raise HTTPException(404, "Notification not found")

    member = require_permission(
        db=db,
        family_id=item.family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    item.is_read = True

    write_audit_log(
        db=db,
        family_id=item.family_id,
        member_id=member.id,
        action_type="READ",
        entity_type="NOTIFICATION",
        entity_id=item.id,
        title="Notification Marked Read",
        description=f"{item.title} marked as read",
    )

    db.commit()

    return {
        "success": True,
        "notification_id": item.id,
        "is_read": item.is_read,
    }