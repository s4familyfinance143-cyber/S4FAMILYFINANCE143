from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.notification import Notification
from app.models.savings import SavingsGoal
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.services.email_service import is_smtp_configured, send_notification_email, smtp_status
from app.services.permission_service import require_permission

router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
)

NOTIFICATION_TEMPLATES = {
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
    "INVESTMENT_MATURITY": {
        "title": "Investment Maturity Reminder",
        "title_bn": "বিনিয়োগ মেয়াদ সতর্কতা",
        "severity": "MEDIUM",
        "message": "{name} matures on {due_date}.",
        "message_bn": "{name} {due_date} তারিখে পরিপক্ক হবে।",
    },
    "VEHICLE_SERVICE_DUE": {
        "title": "Vehicle Service Reminder",
        "title_bn": "যানবাহন সার্ভিস রিমাইন্ডার",
        "severity": "MEDIUM",
        "message": "{name} service/expense dated {due_date}.",
        "message_bn": "{name} সার্ভিস/খরচের তারিখ {due_date}।",
    },
    "SUBSCRIPTION_RENEWAL": {
        "title": "Subscription Renewal",
        "title_bn": "সাবস্ক্রিপশন নবায়ন",
        "severity": "INFO",
        "message": "{name} renews on {due_date} ({amount} {currency}).",
        "message_bn": "{name} {due_date} তারিখে নবায়ন ({amount} {currency})।",
    },
    "DOCUMENT_EXPIRY": {
        "title": "Document Expiry Reminder",
        "title_bn": "ডকুমেন্ট মেয়াদ উত্তীর্ণ",
        "severity": "HIGH",
        "message": "{name} expires on {due_date}.",
        "message_bn": "{name} {due_date} তারিখে মেয়াদ শেষ হবে।",
    },
    "SAVINGS_LOW_PROGRESS": {
        "title": "Savings Progress Low",
        "title_bn": "সঞ্চয় অগ্রগতি কম",
        "severity": "LOW",
        "message": "{name} is only {percent}% complete.",
        "message_bn": "{name} মাত্র {percent}% সম্পন্ন হয়েছে।",
    },
    "SAVINGS_TARGET_DONE": {
        "title": "Savings Target Reached",
        "title_bn": "সঞ্চয় লক্ষ্য পূরণ হয়েছে",
        "severity": "INFO",
        "message": "{name} reached the savings target.",
        "message_bn": "{name} সঞ্চয় লক্ষ্য পূরণ করেছে।",
    },
}


def render_template(notification_type: str, **values) -> dict:
    template = NOTIFICATION_TEMPLATES[notification_type]
    return {
        "notification_type": notification_type,
        "title": template["title"],
        "title_bn": template["title_bn"],
        "message": template["message"].format(**values),
        "message_bn": template["message_bn"].format(**values),
        "severity": template["severity"],
    }


def create_notification(
    db: Session,
    family_id: str,
    notification_type: str,
    title: str,
    message: str,
    severity: str = "INFO",
    *,
    user_id: str | None = None,
    member_id: str | None = None,
    dedup_prefix: str | None = None,
):
    query = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.notification_type == notification_type,
            Notification.title == title,
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
    )
    if dedup_prefix is not None:
        # Same reasoning as notification_scan_service._create_template_notification:
        # a message that embeds a live value (e.g. SAVINGS_LOW_PROGRESS's percent)
        # shifts on every scan even though the situation ("still under 25%") hasn't
        # materially changed. Matching on the full message would defeat dedup and
        # spam a fresh unread notification on every deposit.
        query = query.filter(Notification.message.startswith(dedup_prefix))
    else:
        query = query.filter(Notification.message == message)
    exists = query.first()

    if exists:
        return None

    if user_id is None and member_id:
        from app.models.family_member import FamilyMember

        m = db.get(FamilyMember, member_id)
        if m:
            user_id = m.user_id

    item = Notification(
        family_id=family_id,
        user_id=user_id,
        member_id=member_id,
        notification_type=notification_type,
        title=title,
        message=message,
        severity=severity,
        is_read=False,
    )

    db.add(item)
    db.flush()
    return item


def create_template_notification(
    db: Session, family_id: str, notification_type: str, *, dedup_prefix: str | None = None, **values
):
    rendered = render_template(notification_type, **values)
    return create_notification(
        db=db,
        family_id=family_id,
        notification_type=rendered["notification_type"],
        title=f"{rendered['title']} | {rendered['title_bn']}",
        message=f"{rendered['message']} | {rendered['message_bn']}",
        severity=rendered["severity"],
        dedup_prefix=dedup_prefix,
    )


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

    from app.services.notification_scan_service import run_family_notification_scan

    scan_result = run_family_notification_scan(db, family_id)
    created_count = scan_result["created_count"]
    created_ids = scan_result["created_ids"]

    horizon = date.today() + timedelta(days=7)

    savings_goals = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.status == "ACTIVE",
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    for goal in savings_goals:
        target = Decimal(goal.target_amount or 0)
        if target <= 0:
            continue

        progress = ((Decimal(goal.current_amount or 0) / target) * Decimal("100")).quantize(Decimal("0.01"))
        if progress >= 100:
            item = create_template_notification(
                db=db,
                family_id=family_id,
                notification_type="SAVINGS_TARGET_DONE",
                name=goal.name,
            )
        elif progress < 25:
            item = create_template_notification(
                db=db,
                family_id=family_id,
                notification_type="SAVINGS_LOW_PROGRESS",
                dedup_prefix=f"{goal.name} is only ",
                name=goal.name,
                percent=str(progress),
            )
        else:
            item = None

        if item:
            created_count += 1
            created_ids.append(item.id)

    # --- Life-module dedicated reminders (architecture) ---
    from app.models.architecture_modules import Document, Investment, Subscription, VehicleExpense

    def _parse_due(value) -> date | None:
        if not value:
            return None
        try:
            return date.fromisoformat(str(value).strip()[:10])
        except ValueError:
            return None

    investments = (
        db.query(Investment)
        .filter(Investment.family_id == family_id, Investment.deleted_at.is_(None), Investment.status == "ACTIVE")
        .all()
    )
    for inv in investments:
        due = _parse_due(inv.maturity)
        if due and due <= horizon:
            item = create_template_notification(
                db=db,
                family_id=family_id,
                notification_type="INVESTMENT_MATURITY",
                name=inv.name,
                due_date=due.isoformat(),
            )
            if item:
                created_count += 1
                created_ids.append(item.id)

    vehicle_rows = (
        db.query(VehicleExpense)
        .filter(
            VehicleExpense.family_id == family_id,
            VehicleExpense.deleted_at.is_(None),
            VehicleExpense.status == "ACTIVE",
            VehicleExpense.type.in_(["SERVICE", "MAINTENANCE", "TAX", "INSURANCE"]),
        )
        .all()
    )
    for row in vehicle_rows:
        due = _parse_due(row.expense_date)
        if due and date.today() <= due <= horizon:
            item = create_template_notification(
                db=db,
                family_id=family_id,
                notification_type="VEHICLE_SERVICE_DUE",
                name=row.vehicle_name,
                due_date=due.isoformat(),
            )
            if item:
                created_count += 1
                created_ids.append(item.id)

    subscriptions = (
        db.query(Subscription)
        .filter(
            Subscription.family_id == family_id,
            Subscription.deleted_at.is_(None),
            Subscription.status == "ACTIVE",
            Subscription.auto_remind.is_(True),
        )
        .all()
    )
    for sub in subscriptions:
        due = _parse_due(sub.next_due)
        if due and due <= horizon:
            item = create_template_notification(
                db=db,
                family_id=family_id,
                notification_type="SUBSCRIPTION_RENEWAL",
                name=sub.name,
                due_date=due.isoformat(),
                amount=str(Decimal(sub.amount or 0).quantize(Decimal("0.01"))),
                currency=sub.currency or "BDT",
            )
            if item:
                created_count += 1
                created_ids.append(item.id)

    documents = (
        db.query(Document)
        .filter(Document.family_id == family_id, Document.deleted_at.is_(None), Document.status == "ACTIVE")
        .all()
    )
    for doc in documents:
        due = _parse_due(doc.expiry_date)
        if due and due <= horizon:
            item = create_template_notification(
                db=db,
                family_id=family_id,
                notification_type="DOCUMENT_EXPIRY",
                name=doc.name,
                due_date=due.isoformat(),
            )
            if item:
                created_count += 1
                created_ids.append(item.id)

    db.commit()

    delivery = {"delivered": 0, "results": []}
    if created_ids:
        from app.services.notification_delivery_service import fanout_notification_ids

        delivery = fanout_notification_ids(db, family_id, created_ids)

    unread_count = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
        .count()
    )

    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=member.id,
        action_type="SCAN",
        entity_type="NOTIFICATION",
        entity_id=None,
        title="Notification Scan Completed",
        description=f"Created {created_count} notifications, unread {unread_count}",
    )

    db.commit()

    return {
        "success": True,
        "created_notifications": created_count,
        "unread_notifications": unread_count,
        "channel_delivery": delivery,
    }


@router.get("/summary/{family_id}")
def notification_summary(
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
        .all()
    )

    unread = sum(1 for x in items if not x.is_read)
    read = sum(1 for x in items if x.is_read)
    high = sum(1 for x in items if x.severity == "HIGH")
    medium = sum(1 for x in items if x.severity == "MEDIUM")

    return {
        "family_id": family_id,
        "total_notifications": len(items),
        "unread_notifications": unread,
        "read_notifications": read,
        "high_notifications": high,
        "medium_notifications": medium,
    }


@router.get("/delivery-status/{family_id}")
def notification_delivery_status(
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

    unread_count = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
        .count()
    )

    smtp = smtp_status()
    email_configured = bool(smtp["configured"] and settings.NOTIFICATION_EMAIL_ENABLED)

    # Channels: in-app (live over the VPS WebSocket) + optional SMTP email.
    if settings.NOTIFICATION_IN_APP_ENABLED and email_configured:
        delivery_mode = "IN_APP_EMAIL"
    elif settings.NOTIFICATION_IN_APP_ENABLED:
        delivery_mode = "IN_APP_ONLY"
    else:
        delivery_mode = "DISABLED"

    return {
        "family_id": family_id,
        "in_app_enabled": settings.NOTIFICATION_IN_APP_ENABLED,
        "email_configured": email_configured,
        "smtp": smtp,
        "delivery_mode": delivery_mode,
        "pending_delivery_count": unread_count,
        "templates": sorted(NOTIFICATION_TEMPLATES.keys()),
        "pipeline": {
            "architecture_status": "DONE",
            "email_outbox": True,
            "in_app": True,
            "realtime": "websocket",
        },
    }


@router.get("/delivery-report/{family_id}")
def notification_delivery_report(
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
        .all()
    )

    by_type: dict[str, int] = {}
    by_severity: dict[str, int] = {}

    for item in items:
        by_type[item.notification_type] = by_type.get(item.notification_type, 0) + 1
        by_severity[item.severity] = by_severity.get(item.severity, 0) + 1

    return {
        "family_id": family_id,
        "delivery_status": {
            "in_app_enabled": settings.NOTIFICATION_IN_APP_ENABLED,
            "email_enabled": settings.NOTIFICATION_EMAIL_ENABLED,
            "smtp": smtp_status(),
            "secrets_exposed": False,
        },
        "total_notifications": len(items),
        "unread_notifications": sum(1 for item in items if not item.is_read),
        "by_type": by_type,
        "by_severity": by_severity,
        "templates": sorted(NOTIFICATION_TEMPLATES.keys()),
    }


@router.post("/test-email/{family_id}")
def send_test_notification_email(
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
    if not is_smtp_configured():
        return {
            "sent": False,
            "reason": "SMTP not configured. Set SMTP_HOST + SMTP_FROM_EMAIL in backend .env.",
            "smtp": smtp_status(),
        }
    if not settings.NOTIFICATION_EMAIL_ENABLED:
        return {
            "sent": False,
            "reason": "NOTIFICATION_EMAIL_ENABLED=false",
            "smtp": smtp_status(),
        }
    result = send_notification_email(
        to_email=current_user.email,
        title="Test notification email",
        message="This is a real SMTP test from S4 Family Finance. No demo payload.",
    )
    return {**result.as_dict(), "smtp": smtp_status()}


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
            "user_id": item.user_id,
            "member_id": item.member_id,
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

@router.patch("/read-all/{family_id}")
def mark_all_read(
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
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
        .all()
    )

    count = 0

    for item in items:
        item.is_read = True
        count += 1

    db.commit()

    return {
        "success": True,
        "marked_read": count,
    }



@router.delete("/{notification_id}")
def delete_notification(
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

    from datetime import datetime, timezone

    item.deleted_at = datetime.now(timezone.utc)

    write_audit_log(
        db=db,
        family_id=item.family_id,
        member_id=member.id,
        action_type="DELETE",
        entity_type="NOTIFICATION",
        entity_id=item.id,
        title="Notification Deleted",
        description=item.title,
    )

    db.commit()

    return {
        "success": True,
        "notification_id": notification_id,
    }

