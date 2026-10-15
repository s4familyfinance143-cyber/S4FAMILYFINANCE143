from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


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
    )

    db.add(item)
    # Every curated audit entry is a family data change: tell open clients
    # (broadcast happens only after this session commits).
    from app.services.family_realtime import queue_family_event

    queue_family_event(
        db,
        family_id,
        entity_type=entity_type,
        action=action_type,
        entity_id=entity_id,
        actor_member_id=member_id,
    )