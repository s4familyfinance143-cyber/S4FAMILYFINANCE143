from pathlib import Path

p = Path("app/api/v1/audit_logs.py")
text = p.read_text(encoding="utf-8")

old = 'from fastapi import APIRouter, Depends, Query'
new = 'from fastapi import APIRouter, Depends, Query, Request'

text = text.replace(old, new, 1)

insert = r'''

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


'''

marker = 'router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])\n'

if "def serialize_audit_log" not in text:
    text = text.replace(marker, marker + insert, 1)

p.write_text(text, encoding="utf-8")
print("AUDIT HELPER FUNCTIONS INSERTED OK")
