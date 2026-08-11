from pathlib import Path

p = Path("app/api/v1/audit_logs.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/entity/{family_id}/{entity_type}/{entity_id}")' not in text:

    text += '''

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

'''

    p.write_text(text, encoding="utf-8")
    print("ENTITY AUDIT ENDPOINT INSERTED")
else:
    print("ENTITY AUDIT ALREADY EXISTS")

