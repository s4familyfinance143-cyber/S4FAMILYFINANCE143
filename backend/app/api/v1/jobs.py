"""Async job endpoints — export + reminders + report enqueue."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.infra_jobs import ExportJob, ReminderSchedule
from app.models.user import User
from app.services.job_queue import enqueue_export_job, enqueue_report
from app.services.permission_service import require_permission

router = APIRouter(prefix="/jobs", tags=["Background Jobs"])


class ExportJobCreate(BaseModel):
    family_id: str
    report_type: str = "overview"
    format: str = "txt"


class ReminderCreate(BaseModel):
    family_id: str
    title: str = Field(min_length=1, max_length=200)
    remind_at: datetime
    channel: str = "PUSH"


class ReportEnqueue(BaseModel):
    family_id: str
    report_type: str = "overview"


@router.post("/export")
def create_export_job(
    payload: ExportJobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, current_user.id, "report.read")
    job = ExportJob(
        family_id=payload.family_id,
        user_id=current_user.id,
        report_type=payload.report_type,
        format=payload.format,
        status="PENDING",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    queued = enqueue_export_job(job.id)
    return {"job": {"id": job.id, "status": job.status}, "queue": queued}


@router.get("/export/{family_id}")
def list_export_jobs(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    rows = (
        db.query(ExportJob)
        .filter(ExportJob.family_id == family_id, ExportJob.deleted_at.is_(None))
        .order_by(ExportJob.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "report_type": r.report_type,
            "format": r.format,
            "status": r.status,
            "file_path": r.file_path,
            "error": r.error,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/reminders")
def create_reminder(
    payload: ReminderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, current_user.id, "dashboard.read")
    row = ReminderSchedule(
        family_id=payload.family_id,
        title=payload.title.strip(),
        remind_at=payload.remind_at,
        channel=(payload.channel or "PUSH").upper(),
        status="SCHEDULED",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "title": row.title,
        "remind_at": row.remind_at.isoformat(),
        "status": row.status,
    }


@router.get("/reminders/{family_id}")
def list_reminders(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    rows = (
        db.query(ReminderSchedule)
        .filter(ReminderSchedule.family_id == family_id, ReminderSchedule.deleted_at.is_(None))
        .order_by(ReminderSchedule.remind_at.asc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": r.id,
            "title": r.title,
            "remind_at": r.remind_at.isoformat() if r.remind_at else None,
            "channel": r.channel,
            "status": r.status,
        }
        for r in rows
    ]


@router.post("/reports/enqueue")
def enqueue_report_job(
    payload: ReportEnqueue,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, current_user.id, "report.read")
    return enqueue_report(payload.family_id, payload.report_type)
