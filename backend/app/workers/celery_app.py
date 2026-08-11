"""Celery app — Redis broker when REDIS_URL set.

Falls back to always-eager (in-process) so local/dev still works without a worker.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import settings


def _broker_url() -> str:
    url = (settings.REDIS_URL or "").strip()
    return url or "memory://"


celery_app = Celery(
    "s4_family_finance",
    broker=_broker_url(),
    backend=_broker_url() if (settings.REDIS_URL or "").strip() else None,
)

celery_app.conf.update(
    task_always_eager=not (
        bool(settings.CELERY_ENABLED) and bool((settings.REDIS_URL or "").strip())
    ),
    task_eager_propagates=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "recurring-every-minute": {
            "task": "app.workers.celery_tasks.process_recurring_task",
            "schedule": 60.0,
        },
        "auto-backup-hourly": {
            "task": "app.workers.celery_tasks.process_auto_backup_task",
            "schedule": 3600.0,
        },
        "sync-outbox-every-minute": {
            "task": "app.workers.celery_tasks.process_sync_outbox_task",
            "schedule": 60.0,
        },
        "reminders-every-minute": {
            "task": "app.workers.celery_tasks.process_scheduled_reminders_task",
            "schedule": 60.0,
        },
    },
)

celery_app.autodiscover_tasks(["app.workers"])

# Ensure task modules register with the worker process (autodiscover alone misses celery_tasks.py).
import app.workers.celery_tasks  # noqa: F401, E402
