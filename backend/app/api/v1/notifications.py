from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.architecture_auth import PushToken
from app.models.notification import Notification
from app.models.savings import SavingsGoal
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.services.email_service import is_smtp_configured, send_notification_email, smtp_status
from app.services.fcm_service import fcm_status, is_fcm_configured, send_fcm_push
from app.services.permission_service import get_active_member_or_403, require_permission
from pydantic import BaseModel, Field

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


class PushDeviceRegisterRequest(BaseModel):
    token: str = Field(min_length=8, max_length=512)
    platform: str = Field(default="UNKNOWN", max_length=40)
    provider: str = Field(default="FCM", max_length=40)
    device_label: str | None = Field(default=None, max_length=120)


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


def create_template_notification(db: Session, family_id: str, notification_type: str, **values):
    rendered = render_template(notification_type, **values)
    return create_notification(
        db=db,
        family_id=family_id,
        notification_type=rendered["notification_type"],
        title=f"{rendered['title']} | {rendered['title_bn']}",
        message=f"{rendered['message']} | {rendered['message_bn']}",
        severity=rendered["severity"],
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

    fcm = fcm_status()
    fcm_configured = bool(fcm["configured"])
    smtp = smtp_status()
    email_configured = bool(smtp["configured"] and settings.NOTIFICATION_EMAIL_ENABLED)

    if settings.NOTIFICATION_IN_APP_ENABLED and email_configured and fcm_configured:
        delivery_mode = "IN_APP_EMAIL_FCM"
    elif settings.NOTIFICATION_IN_APP_ENABLED and email_configured:
        delivery_mode = "IN_APP_EMAIL"
    elif settings.NOTIFICATION_IN_APP_ENABLED and fcm_configured:
        delivery_mode = "IN_APP_FCM"
    elif settings.NOTIFICATION_IN_APP_ENABLED:
        delivery_mode = "IN_APP_ONLY"
    else:
        delivery_mode = "DISABLED"

    return {
        "family_id": family_id,
        "in_app_enabled": settings.NOTIFICATION_IN_APP_ENABLED,
        "fcm_configured": fcm_configured,
        "fcm": fcm,
        "email_configured": email_configured,
        "smtp": smtp,
        "delivery_mode": delivery_mode,
        "pending_delivery_count": unread_count,
        "templates": sorted(NOTIFICATION_TEMPLATES.keys()),
        "pipeline": {
            "architecture_status": "DONE",
            "email_outbox": True,
            "push_outbox": True,
            "in_app": True,
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
            "fcm_enabled": settings.NOTIFICATION_FCM_ENABLED,
            "fcm": fcm_status(),
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


@router.get("/fcm-status")
def notification_fcm_status(current_user: User = Depends(get_current_user)):
    _ = current_user
    return fcm_status()


def _token_preview(token: str) -> str:
    return f"{token[:8]}…{token[-4:]}" if token and len(token) > 12 else "***"


@router.get("/devices/{family_id}")
def list_push_devices(
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
    rows = (
        db.query(PushToken)
        .filter(
            PushToken.family_id == family_id,
            PushToken.user_id == current_user.id,
            PushToken.deleted_at.is_(None),
            PushToken.is_active.is_(True),
        )
        .order_by(PushToken.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "platform": row.platform,
            "provider": "FCM",
            "device_label": row.device_id,
            "token_preview": _token_preview(row.fcm_token),
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/devices/{family_id}")
def register_push_device(
    family_id: str,
    payload: PushDeviceRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = get_active_member_or_403(db, family_id, current_user.id)
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )
    token = payload.token.strip()
    platform = (payload.platform or "UNKNOWN").upper().strip()
    existing = (
        db.query(PushToken)
        .filter(
            PushToken.user_id == current_user.id,
            PushToken.fcm_token == token,
        )
        .first()
    )
    if existing:
        existing.family_id = family_id
        existing.platform = platform
        existing.device_id = payload.device_label
        existing.is_active = True
        existing.deleted_at = None
        db.commit()
        db.refresh(existing)
        device = existing
    else:
        device = PushToken(
            family_id=family_id,
            user_id=current_user.id,
            device_id=payload.device_label,
            fcm_token=token,
            platform=platform,
            is_active=True,
        )
        db.add(device)
        db.commit()
        db.refresh(device)

    try:
        from app.services.architecture_system_hooks import upsert_device_registry

        upsert_device_registry(
            db,
            user_id=current_user.id,
            device_fingerprint=device.device_id or device.id,
            platform=device.platform,
            family_id=family_id,
        )
        db.commit()
    except Exception:
        db.rollback()

    try:
        write_audit_log(
            db=db,
            family_id=family_id,
            member_id=member.id,
            action_type="CREATE",
            entity_type="PUSH_DEVICE",
            entity_id=device.id,
            title="Push device registered",
            description=f"{device.platform}/FCM",
        )
        db.commit()
    except Exception:
        db.rollback()

    return {
        "id": device.id,
        "platform": device.platform,
        "provider": "FCM",
        "device_label": device.device_id,
        "registered": True,
        "fcm": fcm_status(),
    }


@router.delete("/devices/{device_id}")
def unregister_push_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.get(PushToken, device_id)
    if not device or device.deleted_at is not None:
        raise HTTPException(404, "Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(403, "Not your device token")
    from datetime import datetime, timezone

    device.is_active = False
    device.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"deleted": True, "id": device_id}


@router.post("/test-push/{family_id}")
def send_test_push(
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
    status = fcm_status()
    if not is_fcm_configured():
        return {
            "sent": False,
            "reason": status["note"],
            "fcm": status,
            "devices_targeted": 0,
        }

    devices = (
        db.query(PushToken)
        .filter(
            PushToken.family_id == family_id,
            PushToken.user_id == current_user.id,
            PushToken.deleted_at.is_(None),
            PushToken.is_active.is_(True),
        )
        .all()
    )
    if not devices:
        return {
            "sent": False,
            "reason": "No registered push devices for this user. Register a token first.",
            "fcm": status,
            "devices_targeted": 0,
        }

    results = []
    sent_count = 0
    for device in devices:
        from app.services.job_queue import enqueue_push

        queued = enqueue_push(
            device.fcm_token,
            "S4 Family Finance test push",
            "Real FCM test — no demo payload.",
            {"family_id": family_id, "type": "TEST_PUSH"},
        )
        # When CELERY_ENABLED=false, enqueue runs inline and returns send result
        if queued.get("queued"):
            results.append({"device_id": device.id, "queued": True, "task_id": queued.get("task_id")})
            sent_count += 1
        else:
            ok = bool(queued.get("ok"))
            results.append({"device_id": device.id, **queued})
            if ok:
                sent_count += 1

    return {
        "sent": sent_count > 0,
        "reason": "sent" if sent_count else (results[0].get("detail") or results[0].get("reason") if results else "No send"),
        "devices_targeted": len(devices),
        "sent_count": sent_count,
        "results": results,
        "fcm": status,
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

