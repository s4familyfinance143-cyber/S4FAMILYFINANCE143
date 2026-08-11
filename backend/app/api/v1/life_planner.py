from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.life_planner import CalendarEvent, FamilyTask, OwnershipTransferRequest
from app.models.user import User
from app.schemas.life_planner import (
    CalendarEventCreateRequest,
    CalendarEventUpdateRequest,
    MemberRoleUpdateRequest,
    OwnershipTransferCreateRequest,
    TaskCreateRequest,
    TaskUpdateRequest,
)
from app.services.permission_service import require_permission

router = APIRouter(tags=["Life Planner"])


def _member(db: Session, family_id: str, user_id: str) -> FamilyMember:
    row = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user_id,
            FamilyMember.deleted_at.is_(None),
            FamilyMember.status == "ACTIVE",
        )
        .first()
    )
    if not row:
        raise HTTPException(403, "Not an active family member")
    return row


def _is_owner(member: FamilyMember) -> bool:
    return str(member.role or "").upper() == "OWNER"


def _task_dict(row: FamilyTask) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "created_by_member_id": row.created_by_member_id,
        "assigned_to_member_id": row.assigned_to_member_id,
        "title": row.title,
        "description": row.description,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "priority": row.priority,
        "status": row.status,
        "reminder_at": row.reminder_at.isoformat() if row.reminder_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _event_dict(row: CalendarEvent) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "created_by_member_id": row.created_by_member_id,
        "title": row.title,
        "description": row.description,
        "event_date": row.event_date.isoformat() if row.event_date else None,
        "start_time": row.start_time,
        "end_time": row.end_time,
        "event_type": row.event_type,
        "status": row.status,
        "reminder_at": row.reminder_at.isoformat() if row.reminder_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _transfer_dict(row: OwnershipTransferRequest) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "from_member_id": row.from_member_id,
        "to_member_id": row.to_member_id,
        "status": row.status,
        "note": row.note,
        "admin_approved_by_member_id": getattr(row, "admin_approved_by_member_id", None),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/tasks/{family_id}")
def list_tasks(
    family_id: str,
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    q = db.query(FamilyTask).filter(FamilyTask.family_id == family_id, FamilyTask.deleted_at.is_(None))
    if status:
        q = q.filter(FamilyTask.status == status.upper())
    rows = q.order_by(FamilyTask.created_at.desc()).all()
    return [_task_dict(r) for r in rows]


@router.post("/tasks")
def create_task(
    payload: TaskCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, current_user.id, "dashboard.read")
    member = _member(db, payload.family_id, current_user.id)
    row = FamilyTask(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        assigned_to_member_id=payload.assigned_to_member_id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        due_date=payload.due_date,
        priority=(payload.priority or "MEDIUM").upper(),
        status="OPEN",
        reminder_at=payload.reminder_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _task_dict(row)


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    row = (
        db.query(FamilyTask)
        .filter(FamilyTask.id == task_id, FamilyTask.family_id == family_id, FamilyTask.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Task not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key in {"title", "description"} and isinstance(value, str):
            value = value.strip() or None
            if key == "title" and not value:
                raise HTTPException(422, "Title required")
        if key in {"priority", "status"} and value:
            value = str(value).upper()
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _task_dict(row)


@router.post("/tasks/{task_id}/complete")
def complete_task(
    task_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    row = (
        db.query(FamilyTask)
        .filter(FamilyTask.id == task_id, FamilyTask.family_id == family_id, FamilyTask.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Task not found")
    row.status = "DONE"
    db.commit()
    db.refresh(row)
    return _task_dict(row)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    row = (
        db.query(FamilyTask)
        .filter(FamilyTask.id == task_id, FamilyTask.family_id == family_id, FamilyTask.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Task not found")
    row.deleted_at = datetime.now(timezone.utc)
    row.status = "CANCELLED"
    db.commit()
    return {"success": True, "id": task_id}


@router.get("/calendar/{family_id}")
def list_calendar(
    family_id: str,
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    q = db.query(CalendarEvent).filter(
        CalendarEvent.family_id == family_id,
        CalendarEvent.deleted_at.is_(None),
    )
    if from_date:
        q = q.filter(CalendarEvent.event_date >= from_date)
    if to_date:
        q = q.filter(CalendarEvent.event_date <= to_date)
    if not from_date and not to_date:
        today = date.today()
        q = q.filter(CalendarEvent.event_date >= today)
    rows = q.order_by(CalendarEvent.event_date.asc(), CalendarEvent.created_at.desc()).all()
    return [_event_dict(r) for r in rows]


@router.post("/calendar")
def create_calendar_event(
    payload: CalendarEventCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, current_user.id, "dashboard.read")
    member = _member(db, payload.family_id, current_user.id)
    row = CalendarEvent(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        event_date=payload.event_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        event_type=(payload.event_type or "GENERAL").upper(),
        status="SCHEDULED",
        reminder_at=payload.reminder_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _event_dict(row)


@router.patch("/calendar/{event_id}")
def update_calendar_event(
    event_id: str,
    payload: CalendarEventUpdateRequest,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    row = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.id == event_id, CalendarEvent.family_id == family_id, CalendarEvent.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Event not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key in {"title", "description"} and isinstance(value, str):
            value = value.strip() or None
            if key == "title" and not value:
                raise HTTPException(422, "Title required")
        if key in {"event_type", "status"} and value:
            value = str(value).upper()
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _event_dict(row)


@router.delete("/calendar/{event_id}")
def delete_calendar_event(
    event_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    row = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.id == event_id, CalendarEvent.family_id == family_id, CalendarEvent.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Event not found")
    row.deleted_at = datetime.now(timezone.utc)
    row.status = "CANCELLED"
    db.commit()
    return {"success": True, "id": event_id}


def _count_active_admins(db: Session, family_id: str) -> int:
    return (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.role == "ADMIN",
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .count()
    )


@router.get("/families/{family_id}/ownership-transfer")
def list_ownership_transfers(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "dashboard.read")
    rows = (
        db.query(OwnershipTransferRequest)
        .filter(
            OwnershipTransferRequest.family_id == family_id,
            OwnershipTransferRequest.deleted_at.is_(None),
        )
        .order_by(OwnershipTransferRequest.created_at.desc())
        .limit(20)
        .all()
    )
    return [_transfer_dict(r) for r in rows]


@router.post("/families/{family_id}/ownership-transfer")
def create_ownership_transfer(
    family_id: str,
    payload: OwnershipTransferCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = _member(db, family_id, current_user.id)
    if not _is_owner(member):
        raise HTTPException(403, "Only owner can start ownership transfer")
    has_admin = _count_active_admins(db, family_id) >= 1
    target = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.id == payload.to_member_id,
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
            FamilyMember.status == "ACTIVE",
        )
        .first()
    )
    if not target:
        raise HTTPException(404, "Target member not found")
    if target.id == member.id:
        raise HTTPException(422, "Cannot transfer ownership to yourself")
    pending = (
        db.query(OwnershipTransferRequest)
        .filter(
            OwnershipTransferRequest.family_id == family_id,
            OwnershipTransferRequest.status.in_(["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"]),
            OwnershipTransferRequest.deleted_at.is_(None),
        )
        .first()
    )
    if pending:
        raise HTTPException(409, "A pending ownership transfer already exists")
    # Architecture: second admin approval when available; otherwise skip to accept
    row = OwnershipTransferRequest(
        family_id=family_id,
        from_member_id=member.id,
        to_member_id=target.id,
        status="PENDING_ADMIN" if has_admin else "PENDING_ACCEPT",
        note=(payload.note or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _transfer_dict(row)


@router.post("/families/{family_id}/ownership-transfer/{request_id}/admin-approve")
def admin_approve_ownership_transfer(
    family_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = _member(db, family_id, current_user.id)
    if str(member.role or "").upper() != "ADMIN":
        raise HTTPException(403, "Only a second Admin can approve ownership transfer")
    row = (
        db.query(OwnershipTransferRequest)
        .filter(
            OwnershipTransferRequest.id == request_id,
            OwnershipTransferRequest.family_id == family_id,
            OwnershipTransferRequest.status.in_(["PENDING_ADMIN", "PENDING"]),
            OwnershipTransferRequest.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Transfer request not found")
    if member.id in {row.from_member_id, row.to_member_id}:
        raise HTTPException(403, "Approving admin must be a different member")
    row.admin_approved_by_member_id = member.id
    row.status = "PENDING_ACCEPT"
    db.commit()
    db.refresh(row)
    return _transfer_dict(row)


@router.post("/families/{family_id}/ownership-transfer/{request_id}/accept")
def accept_ownership_transfer(
    family_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = _member(db, family_id, current_user.id)
    row = (
        db.query(OwnershipTransferRequest)
        .filter(
            OwnershipTransferRequest.id == request_id,
            OwnershipTransferRequest.family_id == family_id,
            OwnershipTransferRequest.status == "PENDING_ACCEPT",
            OwnershipTransferRequest.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Transfer not ready — waiting for second Admin approval then target accept")
    if row.to_member_id != member.id:
        raise HTTPException(403, "Only the target member can accept")
    if not row.admin_approved_by_member_id:
        raise HTTPException(409, "Second admin approval required first")
    from_member = db.query(FamilyMember).filter(FamilyMember.id == row.from_member_id).first()
    to_member = db.query(FamilyMember).filter(FamilyMember.id == row.to_member_id).first()
    if not from_member or not to_member:
        raise HTTPException(404, "Members missing")
    family = db.query(Family).filter(Family.id == family_id).first()
    if not family:
        raise HTTPException(404, "Family not found")
    from_member.role = "ADMIN"
    to_member.role = "OWNER"
    family.owner_user_id = to_member.user_id
    family.main_responsible_member_id = to_member.id
    row.status = "ACCEPTED"
    db.commit()
    db.refresh(row)
    return _transfer_dict(row)


@router.post("/families/{family_id}/ownership-transfer/{request_id}/cancel")
def cancel_ownership_transfer(
    family_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = _member(db, family_id, current_user.id)
    row = (
        db.query(OwnershipTransferRequest)
        .filter(
            OwnershipTransferRequest.id == request_id,
            OwnershipTransferRequest.family_id == family_id,
            OwnershipTransferRequest.status.in_(["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"]),
            OwnershipTransferRequest.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Transfer request not found")
    if row.from_member_id != member.id and not _is_owner(member):
        raise HTTPException(403, "Only owner can cancel")
    row.status = "CANCELLED"
    db.commit()
    db.refresh(row)
    return _transfer_dict(row)


@router.patch("/families/{family_id}/members/{member_id}/role")
def set_member_role(
    family_id: str,
    member_id: str,
    payload: MemberRoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = _member(db, family_id, current_user.id)
    if not _is_owner(actor):
        raise HTTPException(403, "Only owner can change roles")
    role = str(payload.role or "").upper().strip()
    if role not in {"MEMBER", "ADMIN", "VIEWER", "CHILD"}:
        raise HTTPException(422, "Role must be MEMBER, ADMIN, VIEWER, or CHILD")
    target = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.id == member_id,
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )
    if not target:
        raise HTTPException(404, "Member not found")
    if str(target.role or "").upper() == "OWNER":
        raise HTTPException(422, "Cannot demote owner via role update — use ownership transfer")
    target.role = role
    db.commit()
    db.refresh(target)
    return {
        "id": target.id,
        "role": target.role,
        "family_id": family_id,
    }


@router.delete("/families/{family_id}/members/{member_id}")
def remove_family_member(
    family_id: str,
    member_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import datetime, timezone

    actor = _member(db, family_id, current_user.id)
    if not _is_owner(actor) and str(actor.role or "").upper() != "ADMIN":
        raise HTTPException(403, "Only owner/admin can remove members")
    target = (
        db.query(FamilyMember)
        .filter(FamilyMember.id == member_id, FamilyMember.family_id == family_id, FamilyMember.deleted_at.is_(None))
        .first()
    )
    if not target:
        raise HTTPException(404, "Member not found")
    if str(target.role or "").upper() == "OWNER":
        raise HTTPException(422, "Owner cannot be deleted — transfer ownership first")
    if target.id == actor.id and _is_owner(actor):
        raise HTTPException(422, "Owner cannot delete themselves")
    if str(actor.role or "").upper() == "ADMIN" and str(target.role or "").upper() == "ADMIN":
        raise HTTPException(403, "Admin cannot remove another admin")
    target.status = "REMOVED"
    target.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "id": member_id}


@router.post("/families/{family_id}/deactivate")
def deactivate_family(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = _member(db, family_id, current_user.id)
    if not _is_owner(actor):
        raise HTTPException(403, "Only owner can deactivate family")
    # Sole owner may archive the family. They cannot remove themselves as a member
    # without ownership transfer (enforced on DELETE /members).
    pending = (
        db.query(OwnershipTransferRequest)
        .filter(
            OwnershipTransferRequest.family_id == family_id,
            OwnershipTransferRequest.status.in_(["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"]),
            OwnershipTransferRequest.deleted_at.is_(None),
        )
        .first()
    )
    if pending:
        raise HTTPException(409, "Cancel pending ownership transfer before deactivating family")
    family = db.query(Family).filter(Family.id == family_id).first()
    if not family:
        raise HTTPException(404, "Family not found")
    if family.is_active is False:
        return {"success": True, "family_id": family_id, "is_active": False}
    family.is_active = False
    db.commit()
    return {"success": True, "family_id": family_id, "is_active": False}
