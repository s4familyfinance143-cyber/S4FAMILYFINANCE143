from pathlib import Path

p = Path("app/api/v1/goals.py")
text = p.read_text(encoding="utf-8")

needle = '@router.post("/{goal_id}/delete")'

insert = r'''
@router.post("/{goal_id}/reopen")
def reopen_goal(
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
        allowed_statuses={"CLOSED"},
    )

    goal.status = "ACTIVE"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="REOPEN",
        entity_type="GOAL",
        entity_id=goal.id,
        title="Financial Goal Reopened",
        description=payload.reason or f"{goal.goal_name} goal reopened",
    )

    db.commit()
    db.refresh(goal)

    return serialize_goal(goal)


'''

if '@router.post("/{goal_id}/reopen")' in text:
    print("GOAL REOPEN ENDPOINT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL REOPEN ENDPOINT INSERTED OK")
else:
    raise SystemExit("ERROR: delete endpoint marker not found")
