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

@router.get("/audit-analytics/{family_id}")
def audit_analytics_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
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

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(AuditLog.created_at >= start_dt)

    if end_dt:
        query = query.filter(AuditLog.created_at <= end_dt)

    logs = query.order_by(AuditLog.created_at.desc()).all()

    by_action = {}
    by_entity = {}
    by_severity = {}
    by_member = {}
    by_day = {}

    for item in logs:
        by_action[item.action_type] = by_action.get(item.action_type, 0) + 1
        by_entity[item.entity_type] = by_entity.get(item.entity_type, 0) + 1
        by_severity[item.severity] = by_severity.get(item.severity, 0) + 1

        day_key = item.created_at.strftime("%Y-%m-%d")
        by_day[day_key] = by_day.get(day_key, 0) + 1

        member_key = item.member_id or "SYSTEM"

        if member_key not in by_member:
            member = db.get(FamilyMember, item.member_id) if item.member_id else None

            by_member[member_key] = {
                "member_id": item.member_id,
                "member_name": member.user.full_name if member and member.user else "SYSTEM",
                "role": member.role if member else "SYSTEM",
                "relationship": member.relationship_display_label if member else None,
                "log_count": 0,
            }

        by_member[member_key]["log_count"] += 1

    latest_logs = []

    for item in logs[:20]:
        member = db.get(FamilyMember, item.member_id) if item.member_id else None

        latest_logs.append({
            "audit_id": item.id,
            "member_id": item.member_id,
            "member_name": member.user.full_name if member and member.user else None,
            "action_type": item.action_type,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "title": item.title,
            "severity": item.severity,
            "created_at": item.created_at,
        })

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_logs": len(logs),
            "by_action": by_action,
            "by_entity": by_entity,
            "by_severity": by_severity,
        },
        "member_activity": sorted(
            by_member.values(),
            key=lambda x: x["log_count"],
            reverse=True,
        ),
        "daily_activity": [
            {
                "date": day,
                "log_count": count,
            }
            for day, count in sorted(by_day.items())
        ],
        "latest_logs": latest_logs,
    }


'''

if '@router.get("/audit-analytics/{family_id}")' not in text:
    text = text + "\n\n" + insert_code

p.write_text(text, encoding="utf-8")
print("AUDIT ANALYTICS REPORT ADDED")
