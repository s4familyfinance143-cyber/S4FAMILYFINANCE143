"""Fan-out in-app notifications to Email + FCM channels (honest, no fake send)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.architecture_auth import PushToken
from app.models.family_member import FamilyMember
from app.models.infra_jobs import EmailOutbox, PushOutbox
from app.models.notification import Notification
from app.models.user import User
from app.services.email_service import is_smtp_configured, send_notification_email, smtp_status
from app.services.fcm_service import fcm_status, is_fcm_configured, send_fcm_push
from app.services.job_queue import enqueue_email, enqueue_push


def _member_user_ids(db: Session, family_id: str) -> list[str]:
    rows = (
        db.query(FamilyMember.user_id)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.status == "ACTIVE",
        )
        .all()
    )
    return [r[0] for r in rows if r[0]]


def _emails_for_family(db: Session, family_id: str, user_id: str | None = None) -> list[str]:
    ids = [user_id] if user_id else _member_user_ids(db, family_id)
    if not ids:
        return []
    users = db.query(User).filter(User.id.in_(ids), User.is_active.is_(True)).all()
    out = []
    for u in users:
        email = (u.email or "").strip().lower()
        if email:
            out.append(email)
    return sorted(set(out))


def _push_tokens(db: Session, family_id: str, user_id: str | None = None) -> list[PushToken]:
    q = db.query(PushToken).filter(
        PushToken.family_id == family_id,
        PushToken.deleted_at.is_(None),
        PushToken.is_active.is_(True),
    )
    if user_id:
        q = q.filter(PushToken.user_id == user_id)
    return q.all()


def _record_push_outbox(
    db: Session,
    *,
    family_id: str,
    notification_id: str | None,
    token: str,
    title: str,
    body: str,
    status: str,
    last_error: str | None = None,
) -> PushOutbox:
    row = PushOutbox(
        family_id=family_id,
        notification_id=notification_id,
        fcm_token_preview=f"{token[:8]}…{token[-4:]}" if token and len(token) > 12 else "***",
        title=title[:200],
        body=(body or "")[:2000],
        status=status,
        attempts=1,
        last_error=(last_error or None) and str(last_error)[:500],
        sent_at=datetime.now(timezone.utc) if status == "SENT" else None,
    )
    db.add(row)
    return row


def deliver_notification_channels(db: Session, notification: Notification) -> dict:
    """Deliver one notification over configured channels. Always records honest outcomes."""
    family_id = notification.family_id
    title = (notification.title or "S4 notification").split(" | ")[0].strip()
    body = (notification.message or "").split(" | ")[0].strip()
    email_results = []
    push_results = []

    # --- Email ---
    if settings.NOTIFICATION_EMAIL_ENABLED:
        emails = _emails_for_family(db, family_id, notification.user_id)
        for to_email in emails:
            if settings.CELERY_ENABLED:
                queued = enqueue_email(
                    to_email,
                    f"S4 Family Finance — {title}",
                    f"{title}\n\n{body}\n",
                    f"<h3>{title}</h3><p>{body}</p>",
                )
                email_results.append({"to": to_email, "queued": True, **queued})
            else:
                # Persist outbox row then attempt real SMTP
                outbox = EmailOutbox(
                    family_id=family_id,
                    to_email=to_email,
                    subject=f"S4 Family Finance — {title}",
                    body_text=f"{title}\n\n{body}\n",
                    body_html=f"<h3>{title}</h3><p>{body}</p>",
                    status="PROCESSING",
                )
                db.add(outbox)
                db.flush()
                if is_smtp_configured():
                    result = send_notification_email(to_email=to_email, title=title, message=body)
                    outbox.attempts = 1
                    if result.sent:
                        outbox.status = "SENT"
                        outbox.sent_at = datetime.now(timezone.utc)
                        outbox.last_error = None
                    else:
                        outbox.status = "FAILED"
                        outbox.last_error = (result.reason or "send failed")[:500]
                    email_results.append({"to": to_email, **result.as_dict(), "email_outbox_id": outbox.id})
                else:
                    outbox.status = "QUEUED"
                    outbox.attempts = 0
                    outbox.last_error = "SMTP not configured — kept in email_outbox"
                    email_results.append(
                        {
                            "to": to_email,
                            "sent": False,
                            "queued": True,
                            "reason": outbox.last_error,
                            "email_outbox_id": outbox.id,
                        }
                    )
    else:
        email_results.append({"sent": False, "reason": "NOTIFICATION_EMAIL_ENABLED=false"})

    # --- FCM ---
    if settings.NOTIFICATION_FCM_ENABLED:
        tokens = _push_tokens(db, family_id, notification.user_id)
        if not tokens:
            push_results.append({"sent": False, "reason": "No active push tokens"})
        for device in tokens:
            token = device.fcm_token
            if settings.CELERY_ENABLED and is_fcm_configured():
                queued = enqueue_push(
                    token,
                    title,
                    body,
                    {
                        "family_id": family_id,
                        "notification_id": notification.id,
                        "type": notification.notification_type or "",
                    },
                )
                _record_push_outbox(
                    db,
                    family_id=family_id,
                    notification_id=notification.id,
                    token=token,
                    title=title,
                    body=body,
                    status="QUEUED",
                )
                push_results.append({"device_id": device.id, "queued": True, **queued})
            elif is_fcm_configured():
                result = send_fcm_push(
                    token=token,
                    title=title,
                    body=body,
                    data={
                        "family_id": family_id,
                        "notification_id": notification.id,
                        "type": notification.notification_type or "",
                    },
                )
                _record_push_outbox(
                    db,
                    family_id=family_id,
                    notification_id=notification.id,
                    token=token,
                    title=title,
                    body=body,
                    status="SENT" if result.sent else "FAILED",
                    last_error=None if result.sent else result.reason,
                )
                push_results.append({"device_id": device.id, **result.as_dict()})
            else:
                _record_push_outbox(
                    db,
                    family_id=family_id,
                    notification_id=notification.id,
                    token=token,
                    title=title,
                    body=body,
                    status="QUEUED",
                    last_error=fcm_status().get("note"),
                )
                push_results.append(
                    {
                        "device_id": device.id,
                        "sent": False,
                        "queued": True,
                        "reason": fcm_status().get("note"),
                    }
                )
    else:
        push_results.append({"sent": False, "reason": "NOTIFICATION_FCM_ENABLED=false"})

    return {
        "notification_id": notification.id,
        "in_app": True,
        "email": email_results,
        "push": push_results,
        "smtp": smtp_status(),
        "fcm": fcm_status(),
    }


def fanout_notification_ids(db: Session, family_id: str, notification_ids: list[str]) -> dict:
    if not notification_ids:
        return {"delivered": 0, "results": []}
    rows = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.id.in_(notification_ids),
            Notification.deleted_at.is_(None),
        )
        .all()
    )
    results = [deliver_notification_channels(db, row) for row in rows]
    db.commit()
    return {"delivered": len(results), "results": results}


def pipeline_status() -> dict:
    """Architecture pipeline readiness (code-complete regardless of live cloud keys)."""
    fcm = fcm_status()
    smtp = smtp_status()
    return {
        "in_app": {"enabled": bool(settings.NOTIFICATION_IN_APP_ENABLED), "status": "DONE"},
        "email": {
            "enabled": bool(settings.NOTIFICATION_EMAIL_ENABLED),
            "smtp_configured": bool(smtp.get("configured")),
            "outbox": "DONE",
            "status": "DONE",
            "note": smtp.get("note")
            or (
                "Set SMTP_* + NOTIFICATION_EMAIL_ENABLED=true for live SMTP; "
                "outbox queue is always available."
            ),
        },
        "fcm": {
            "enabled": bool(settings.NOTIFICATION_FCM_ENABLED),
            "configured": bool(fcm.get("configured")),
            "outbox": "DONE",
            "status": "DONE",
            "note": fcm.get("note"),
        },
        "architecture_status": "DONE",
    }
