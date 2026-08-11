"""Family governance audit action helpers."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.services.audit_service import write_audit_log


def write_family_audit(
    db: Session,
    *,
    family_id: str,
    member_id: str | None,
    action_type: str,
    entity_type: str,
    entity_id: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> None:
    try:
        write_audit_log(
            db,
            family_id=family_id,
            member_id=member_id,
            action_type=action_type,
            entity_type=entity_type,
            entity_id=entity_id,
            title=title or action_type,
            description=description,
            severity="INFO",
        )
    except Exception:
        pass
