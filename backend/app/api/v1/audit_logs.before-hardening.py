from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.permission_service import require_permission

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


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