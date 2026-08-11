from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/goal-analytics/{family_id}")
def goal_analytics_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    active_count = 0
    completed_count = 0
    closed_count = 0

    total_target = Decimal("0")
    total_saved = Decimal("0")

    rows = []

    for goal in goals:
        target = Decimal(goal.target_amount or 0)
        saved = Decimal(goal.current_amount or 0)

        total_target += target
        total_saved += saved

        progress = Decimal("0")
        if target > 0:
            progress = (saved / target) * Decimal("100")

        if goal.status == "ACTIVE":
            active_count += 1
        elif goal.status == "COMPLETED":
            completed_count += 1
        else:
            closed_count += 1

        rows.append(
            {
                "goal_id": goal.id,
                "goal_name": goal.goal_name,
                "goal_type": goal.goal_type,
                "target_amount": money(target),
                "saved_amount": money(saved),
                "remaining_amount": money(target - saved),
                "progress_percent": str(round(progress, 2)),
                "status": goal.status,
                "target_date": goal.target_date,
            }
        )

    overall_progress = Decimal("0")
    if total_target > 0:
        overall_progress = (total_saved / total_target) * Decimal("100")

    return {
        "family_id": family_id,
        "summary": {
            "total_goals": len(goals),
            "active_goals": active_count,
            "completed_goals": completed_count,
            "closed_goals": closed_count,
            "total_target_amount": money(total_target),
            "total_saved_amount": money(total_saved),
            "overall_progress_percent": str(round(overall_progress, 2)),
        },
        "goals": sorted(
            rows,
            key=lambda x: float(x["progress_percent"]),
            reverse=True,
        ),
    }


'''

if '@router.get("/goal-analytics/{family_id}")' in text:
    print("GOAL ANALYTICS ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("GOAL ANALYTICS INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
