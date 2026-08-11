from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.permission_service import require_permission

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


def serialize_audit_log(item: AuditLog):
    return {
        "id": item.id,
        "family_id": item.family_id,
        "member_id": item.member_id,
        "action_type": item.action_type,
        "entity_type": item.entity_type,
        "entity_id": item.entity_id,
        "title": item.title,
        "description": item.description,
        "severity": item.severity,
        "ip_address": item.ip_address,
        "user_agent": item.user_agent,
        "created_at": item.created_at,
    }


def write_audit_log(
    db: Session,
    family_id: str,
    member_id: str | None,
    action_type: str,
    entity_type: str,
    entity_id: str | None,
    title: str,
    description: str | None = None,
    severity: str = "INFO",
    ip_address: str | None = None,
    user_agent: str | None = None,
):
    item = AuditLog(
        family_id=family_id,
        member_id=member_id,
        action_type=action_type.upper(),
        entity_type=entity_type.upper(),
        entity_id=entity_id,
        title=title,
        description=description,
        severity=severity.upper(),
        ip_address=ip_address,
        user_agent=user_agent,
    )

    db.add(item)
    db.commit()
    db.refresh(item)

    return item




@router.get("/{family_id}")
def list_audit_logs(
    family_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    action_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="audit.read",
    )

    query = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
    )

    if action_type:
        query = query.filter(
            AuditLog.action_type == action_type.upper()
        )

    if entity_type:
        query = query.filter(
            AuditLog.entity_type == entity_type.upper()
        )

    if severity:
        query = query.filter(
            AuditLog.severity == severity.upper()
        )

    logs = (
        query.order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return [
        {
            "id": item.id,
            "action_type": item.action_type,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "title": item.title,
            "description": item.description,
            "severity": item.severity,
            "created_at": item.created_at,
        }
        for item in logs
    ]

@router.get("/entity/{family_id}/{entity_type}/{entity_id}")
def audit_by_entity(
    family_id: str,
    entity_type: str,
    entity_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="audit.read",
    )

    logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.entity_type == entity_type.upper(),
            AuditLog.entity_id == entity_id,
            AuditLog.deleted_at.is_(None),
        )
        .order_by(AuditLog.created_at.desc())
        .all()
    )

    return [serialize_audit_log(x) for x in logs]



@router.get("/summary/{family_id}")
def audit_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="audit.read",
    )

    logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
        .all()
    )

    by_action = {}
    by_entity = {}
    by_severity = {}

    for log in logs:
        by_action[log.action_type] = by_action.get(log.action_type, 0) + 1
        by_entity[log.entity_type] = by_entity.get(log.entity_type, 0) + 1
        by_severity[log.severity] = by_severity.get(log.severity, 0) + 1

    return {
        "family_id": family_id,
        "total_logs": len(logs),
        "by_action": by_action,
        "by_entity": by_entity,
        "by_severity": by_severity,
    }

