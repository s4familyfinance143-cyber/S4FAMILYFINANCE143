from pathlib import Path

p = Path("app/api/v1/notifications.py")
text = p.read_text(encoding="utf-8")

if '@router.delete("/{notification_id}")' not in text:

    text += '''

@router.delete("/{notification_id}")
def delete_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.get(Notification, notification_id)

    if not item or item.deleted_at is not None:
        raise HTTPException(404, "Notification not found")

    member = require_permission(
        db=db,
        family_id=item.family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    from datetime import datetime, timezone

    item.deleted_at = datetime.now(timezone.utc)

    write_audit_log(
        db=db,
        family_id=item.family_id,
        member_id=member.id,
        action_type="DELETE",
        entity_type="NOTIFICATION",
        entity_id=item.id,
        title="Notification Deleted",
        description=item.title,
    )

    db.commit()

    return {
        "success": True,
        "notification_id": notification_id,
    }

'''

    p.write_text(text, encoding="utf-8")
    print("DELETE NOTIFICATION ENDPOINT ADDED")
else:
    print("ALREADY EXISTS")
