"""Queue helpers — prefer Celery when enabled, else run inline."""

from __future__ import annotations

from app.core.config import settings


def enqueue_push(token: str, title: str, body: str, data: dict | None = None) -> dict:
    from app.workers.celery_tasks import send_push_task

    if settings.CELERY_ENABLED:
        async_result = send_push_task.delay(token, title, body, data or {})
        return {"queued": True, "task_id": async_result.id}
    return send_push_task(token, title, body, data or {})


def enqueue_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> dict:
    from app.workers.celery_tasks import send_email_task

    if settings.CELERY_ENABLED:
        async_result = send_email_task.delay(to_email, subject, text_body, html_body)
        return {"queued": True, "task_id": async_result.id}
    return send_email_task(to_email, subject, text_body, html_body)


def enqueue_report(family_id: str, report_type: str = "overview") -> dict:
    from app.workers.celery_tasks import generate_report_task

    if settings.CELERY_ENABLED:
        async_result = generate_report_task.delay(family_id, report_type)
        return {"queued": True, "task_id": async_result.id}
    return generate_report_task(family_id, report_type)


def enqueue_export_job(job_id: str) -> dict:
    from app.workers.celery_tasks import export_job_task

    if settings.CELERY_ENABLED:
        async_result = export_job_task.delay(job_id)
        return {"queued": True, "task_id": async_result.id}
    return export_job_task(job_id)
