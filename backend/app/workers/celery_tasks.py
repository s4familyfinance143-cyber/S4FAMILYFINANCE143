"""Celery background jobs — push, email, reports, sync, reminders, export."""

from __future__ import annotations

from datetime import datetime, timezone

from app.workers.celery_app import celery_app
from app.workers.auto_backup_worker import process_auto_backup
from app.workers.recurring_scheduler import process_recurring_transactions


@celery_app.task(name="app.workers.celery_tasks.process_recurring_task")
def process_recurring_task() -> dict:
    process_recurring_transactions()
    return {"ok": True, "task": "recurring"}


@celery_app.task(name="app.workers.celery_tasks.process_auto_backup_task")
def process_auto_backup_task() -> dict:
    result = process_auto_backup()
    return {"ok": True, "task": "auto_backup", "result": result}


@celery_app.task(name="app.workers.celery_tasks.send_push_task")
def send_push_task(token: str, title: str, body: str, data: dict | None = None) -> dict:
    from app.services.fcm_service import send_fcm_push

    result = send_fcm_push(token=token, title=title, body=body, data=data or {})
    return {
        "ok": bool(getattr(result, "sent", False) or getattr(result, "ok", False) or getattr(result, "success", False)),
        "task": "push",
        "detail": getattr(result, "reason", None) or getattr(result, "detail", None) or str(result),
    }


@celery_app.task(name="app.workers.celery_tasks.send_email_task")
def send_email_task(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> dict:
    from app.core.database import SessionLocal
    from app.models.infra_jobs import EmailOutbox
    from app.services.email_service import send_email

    db = SessionLocal()
    row = None
    try:
        row = EmailOutbox(
            to_email=to_email,
            subject=subject,
            body_text=text_body,
            body_html=html_body,
            status="PROCESSING",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        result = send_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
        ok = bool(
            getattr(result, "sent", False)
            or getattr(result, "ok", False)
            or getattr(result, "success", False)
        )
        row.status = "SENT" if ok else "FAILED"
        row.attempts = (row.attempts or 0) + 1
        row.sent_at = datetime.now(timezone.utc) if ok else None
        row.last_error = None if ok else (
            getattr(result, "reason", None) or getattr(result, "detail", None) or str(result)
        )
        db.commit()
        return {"ok": ok, "task": "email", "email_outbox_id": row.id, "reason": getattr(result, "reason", None)}
    except Exception as exc:
        if row is not None:
            row.status = "FAILED"
            row.attempts = (row.attempts or 0) + 1
            row.last_error = str(exc)[:500]
            db.commit()
        return {"ok": False, "task": "email", "error": str(exc)}
    finally:
        db.close()


@celery_app.task(name="app.workers.celery_tasks.generate_report_task")
def generate_report_task(family_id: str, report_type: str = "overview") -> dict:
    """Heavy report snapshot for async consumers."""
    from app.core.database import SessionLocal
    from app.models.account import Account
    from app.models.transaction import Transaction

    db = SessionLocal()
    try:
        wallets = (
            db.query(Account)
            .filter(Account.family_id == family_id, Account.deleted_at.is_(None))
            .count()
        )
        txs = (
            db.query(Transaction)
            .filter(Transaction.family_id == family_id, Transaction.deleted_at.is_(None))
            .count()
        )
        return {
            "ok": True,
            "task": "report",
            "family_id": family_id,
            "report_type": report_type,
            "wallet_count": wallets,
            "transaction_count": txs,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        db.close()


@celery_app.task(name="app.workers.celery_tasks.process_sync_outbox_task")
def process_sync_outbox_task(limit: int = 50) -> dict:
    from app.core.database import SessionLocal
    from app.models.sync_tables import SyncOutbox

    db = SessionLocal()
    try:
        rows = (
            db.query(SyncOutbox)
            .filter(SyncOutbox.status == "PENDING")
            .order_by(SyncOutbox.created_at.asc())
            .limit(max(1, min(limit, 200)))
            .all()
        )
        updated_at = datetime.now(timezone.utc)
        for row in rows:
            row.status = "PROCESSED"
            row.updated_at = updated_at
        db.commit()
        return {"ok": True, "task": "sync_processor", "processed": len(rows)}
    except Exception as exc:
        db.rollback()
        return {"ok": False, "task": "sync_processor", "error": str(exc)}
    finally:
        db.close()


@celery_app.task(name="app.workers.celery_tasks.scan_due_notifications_task")
def scan_due_notifications_task(limit: int = 200) -> dict:
    """Scan active families for due budget, recurring, and loan notifications."""
    from app.core.database import SessionLocal
    from app.models.family import Family
    from app.services.notification_scan_service import run_family_notification_scan

    db = SessionLocal()
    scanned = 0
    created_count = 0
    created_ids: list[str] = []
    failures: list[dict[str, str]] = []
    try:
        families = (
            db.query(Family)
            .filter(Family.is_active.is_(True), Family.deleted_at.is_(None))
            .order_by(Family.id)
            .limit(max(1, min(limit, 200)))
            .all()
        )
        for family in families:
            try:
                result = run_family_notification_scan(db, family.id)
                db.commit()
                scanned += 1
                created_count += result["created_count"]
                created_ids.extend(result["created_ids"])
            except Exception as exc:
                db.rollback()
                failures.append({"family_id": family.id, "error": str(exc)[:500]})
        return {
            "ok": not failures,
            "task": "notification_scan",
            "families_scanned": scanned,
            "created_count": created_count,
            "created_ids": created_ids,
            "failures": failures,
        }
    finally:
        db.close()


@celery_app.task(name="app.workers.celery_tasks.process_scheduled_reminders_task")
def process_scheduled_reminders_task() -> dict:
    from app.core.database import SessionLocal
    from app.models.infra_jobs import ReminderSchedule
    from app.models.notification import Notification

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due = (
            db.query(ReminderSchedule)
            .filter(
                ReminderSchedule.status == "SCHEDULED",
                ReminderSchedule.remind_at <= now,
                ReminderSchedule.deleted_at.is_(None),
            )
            .limit(100)
            .all()
        )
        for row in due:
            db.add(
                Notification(
                    family_id=row.family_id,
                    notification_type="SCHEDULED_REMINDER",
                    title=row.title,
                    message=row.title,
                    severity="INFO",
                    is_read=False,
                )
            )
            row.status = "SENT"
        db.commit()
        return {"ok": True, "task": "reminders", "sent": len(due)}
    finally:
        db.close()


@celery_app.task(name="app.workers.celery_tasks.export_job_task")
def export_job_task(job_id: str) -> dict:
    from pathlib import Path

    from app.core.database import SessionLocal
    from app.models.infra_jobs import ExportJob

    db = SessionLocal()
    try:
        job = db.get(ExportJob, job_id)
        if not job:
            return {"ok": False, "task": "export", "error": "job not found"}
        job.status = "PROCESSING"
        db.commit()
        out_dir = Path(__file__).resolve().parents[2] / "exports"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{job.id}_{job.report_type}.{job.format or 'txt'}"
        out_path.write_text(
            f"family_id={job.family_id}\nreport_type={job.report_type}\nexported_at={datetime.now(timezone.utc).isoformat()}\n",
            encoding="utf-8",
        )
        job.file_path = str(out_path)
        job.status = "DONE"
        db.commit()
        return {"ok": True, "task": "export", "job_id": job.id, "file_path": job.file_path}
    except Exception as exc:
        if job:
            job.status = "FAILED"
            job.error = str(exc)[:500]
            db.commit()
        return {"ok": False, "task": "export", "error": str(exc)}
    finally:
        db.close()
