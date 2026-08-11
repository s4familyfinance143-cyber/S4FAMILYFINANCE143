from pathlib import Path

p = Path("app/api/v1/goals.py")
text = p.read_text(encoding="utf-8")

text = text.replace("from datetime import date", "from datetime import date, datetime", 1)

needle = "@router.get(\"/{goal_id}/history/{family_id}\")"

insert = r'''
@router.post("/{goal_id}/delete")
def delete_goal(
    goal_id: str,
    payload: GoalCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="goal.create",
    )

    goal = get_goal(
        db,
        payload.family_id,
        goal_id,
        allowed_statuses={"ACTIVE", "COMPLETED", "CLOSED"},
    )

    goal.status = "DELETED"
    goal.deleted_at = datetime.utcnow()

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="DELETE",
        entity_type="GOAL",
        entity_id=goal.id,
        title="Financial Goal Deleted",
        description=payload.reason or f"{goal.goal_name} goal deleted",
    )

    db.commit()

    return {
        "success": True,
        "goal_id": goal.id,
        "deleted": True,
    }


'''

if '@router.post("/{goal_id}/delete")' in text:
    print("GOAL DELETE ENDPOINT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL DELETE ENDPOINT INSERTED OK")
else:
    raise SystemExit("ERROR: history endpoint marker not found")
