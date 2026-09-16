"""Celery app — Redis broker when REDIS_URL set.

Falls back to always-eager (in-process) so local/dev still works without a worker.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import settings
from app.core.sentry_init import init_sentry

# Worker/beat processes do not import app.main — init Sentry here when DSN is set.
init_sentry()


def _broker_url() -> str:
    url = (settings.REDIS_URL or "").strip()
    return url or "memory://"


celery_app = Celery(
    "s4_family_finance",
    broker=_broker_url(),
    backend=_broker_url() if (settings.REDIS_URL or "").strip() else None,
)

# ENABLE_RECURRING_WORKER / ENABLE_AUTO_BACKUP_WORKER only gated the in-process
# asyncio workers in main.py's lifespan — celery beat scheduled these two
# unconditionally, so an operator setting them to false (e.g.
# Dockerfile.backend does both by default) had zero effect once a celery_beat
# process was running. Worse for auto-backup specifically:
# auto_backup_worker.process_auto_backup() hard-raises RuntimeError on any
# non-SQLite DATABASE_URL, and production is required to run PostgreSQL — so
# an unconditionally-scheduled auto-backup-hourly would crash every hour on
# any real production deployment that runs celery_beat.
_beat_schedule = {
    "sync-outbox-every-minute": {
        "task": "app.workers.celery_tasks.process_sync_outbox_task",
        "schedule": 60.0,
    },
    "reminders-every-minute": {
        "task": "app.workers.celery_tasks.process_scheduled_reminders_task",
        "schedule": 60.0,
    },
    "due-notification-scan": {
        "task": "app.workers.celery_tasks.scan_due_notifications_task",
        "schedule": float(settings.LOAN_REMINDER_SCAN_HOURS * 3600),
    },
}
if settings.ENABLE_RECURRING_WORKER:
    _beat_schedule["recurring-every-minute"] = {
        "task": "app.workers.celery_tasks.process_recurring_task",
        "schedule": 60.0,
    }
if settings.ENABLE_AUTO_BACKUP_WORKER:
    _beat_schedule["auto-backup-hourly"] = {
        "task": "app.workers.celery_tasks.process_auto_backup_task",
        "schedule": 3600.0,
    }

celery_app.conf.update(
    task_always_eager=not (
        bool(settings.CELERY_ENABLED) and bool((settings.REDIS_URL or "").strip())
    ),
    task_eager_propagates=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule=_beat_schedule,
)

celery_app.autodiscover_tasks(["app.workers"])

# Ensure task modules register with the worker process (autodiscover alone misses celery_tasks.py).
import app.workers.celery_tasks  # noqa: F401, E402
