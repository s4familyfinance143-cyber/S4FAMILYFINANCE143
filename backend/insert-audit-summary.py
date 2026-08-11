from pathlib import Path

p = Path("app/api/v1/audit_logs.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/summary/{family_id}")' not in text:

    text += '''

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

'''

    p.write_text(text, encoding="utf-8")
    print("AUDIT SUMMARY ENDPOINT INSERTED")
else:
    print("AUDIT SUMMARY ALREADY EXISTS")

