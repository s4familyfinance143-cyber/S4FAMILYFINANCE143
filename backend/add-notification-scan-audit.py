from pathlib import Path

p = Path("app/api/v1/notifications.py")
text = p.read_text(encoding="utf-8")

old = '''    return {
        "success": True,
        "created_notifications": created_count,
        "unread_notifications": unread_count,
    }
'''

new = '''    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=member.id,
        action_type="SCAN",
        entity_type="NOTIFICATION",
        entity_id=None,
        title="Notification Scan Completed",
        description=f"Created {created_count} notifications, unread {unread_count}",
    )

    db.commit()

    return {
        "success": True,
        "created_notifications": created_count,
        "unread_notifications": unread_count,
    }
'''

if old not in text:
    raise SystemExit("ERROR: scan return block not found")

text = text.replace(old, new, 1)
p.write_text(text, encoding="utf-8")
print("NOTIFICATION SCAN AUDIT ADDED")
