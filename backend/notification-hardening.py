from pathlib import Path

p = Path("app/api/v1/notifications.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/summary/{family_id}")' not in text:

    text += '''

@router.get("/summary/{family_id}")
def notification_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    items = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.deleted_at.is_(None),
        )
        .all()
    )

    unread = sum(1 for x in items if not x.is_read)
    read = sum(1 for x in items if x.is_read)

    return {
        "family_id": family_id,
        "total_notifications": len(items),
        "unread_notifications": unread,
        "read_notifications": read,
    }


@router.patch("/read-all/{family_id}")
def mark_all_read(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="notification.read",
    )

    items = (
        db.query(Notification)
        .filter(
            Notification.family_id == family_id,
            Notification.is_read.is_(False),
            Notification.deleted_at.is_(None),
        )
        .all()
    )

    count = 0

    for item in items:
        item.is_read = True
        count += 1

    db.commit()

    return {
        "success": True,
        "marked_read": count,
    }

'''

    p.write_text(text, encoding="utf-8")
    print("NOTIFICATION HARDENING INSERTED")
else:
    print("ALREADY EXISTS")
