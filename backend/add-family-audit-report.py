from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

if "from app.models.audit_log import AuditLog" not in text:
    text = text.replace(
        "from app.models.currency import ExchangeRate",
        "from app.models.currency import ExchangeRate\nfrom app.models.audit_log import AuditLog",
        1,
    )

insert_code = '''

@router.get("/family-audit/{family_id}")
def family_audit_report(
    family_id: str,
    action_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    query = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
    )

    if action_type:
        query = query.filter(AuditLog.action_type == action_type.upper())

    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type.upper())

    if severity:
        query = query.filter(AuditLog.severity == severity.upper())

    total_logs = query.count()

    logs = (
        query.order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    by_action = {}
    by_entity = {}
    by_severity = {}

    all_logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.family_id == family_id,
            AuditLog.deleted_at.is_(None),
        )
        .all()
    )

    for item in all_logs:
        by_action[item.action_type] = by_action.get(item.action_type, 0) + 1
        by_entity[item.entity_type] = by_entity.get(item.entity_type, 0) + 1
        by_severity[item.severity] = by_severity.get(item.severity, 0) + 1

    rows = []

    for item in logs:
        member = db.get(FamilyMember, item.member_id) if item.member_id else None

        rows.append({
            "audit_id": item.id,
            "member_id": item.member_id,
            "member_name": member.user.full_name if member and member.user else None,
            "role": member.role if member else None,
            "relationship": member.relationship_display_label if member else None,
            "action_type": item.action_type,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "title": item.title,
            "description": item.description,
            "severity": item.severity,
            "ip_address": item.ip_address,
            "user_agent": item.user_agent,
            "created_at": item.created_at,
        })

    return {
        "family_id": family_id,
        "filters": {
            "action_type": action_type,
            "entity_type": entity_type,
            "severity": severity,
            "limit": limit,
            "offset": offset,
        },
        "summary": {
            "total_logs": total_logs,
            "by_action": by_action,
            "by_entity": by_entity,
            "by_severity": by_severity,
        },
        "logs": rows,
    }


'''

if '@router.get("/family-audit/{family_id}")' not in text:
    text = text + "\n\n" + insert_code

p.write_text(text, encoding="utf-8")
print("FAMILY AUDIT REPORT ADDED")
