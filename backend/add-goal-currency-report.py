from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/goals-currency/{family_id}")' not in text:
    insert = '''

@router.get("/goals-currency/{family_id}")
def goal_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    total_target_base = Decimal("0")
    total_current_base = Decimal("0")

    rows = []

    for goal in goals:

        goal_currency = getattr(goal, "currency", base_currency)

        rate = report_currency_rate(
            db,
            goal_currency,
            base_currency,
        )

        target_amount = Decimal(goal.target_amount or 0)
        current_amount = Decimal(goal.current_amount or 0)

        target_base = target_amount * rate
        current_base = current_amount * rate

        total_target_base += target_base
        total_current_base += current_base

        rows.append({
            "goal_id": goal.id,
            "goal_name": goal.name,
            "currency": goal_currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "target_amount": money(target_amount),
            "current_amount": money(current_amount),
            "target_base": money(target_base),
            "current_base": money(current_base),
            "progress_percent": percent(
                current_amount,
                target_amount,
            ),
            "status": goal.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "goal_count": len(goals),
            "total_target_base": money(total_target_base),
            "total_current_base": money(total_current_base),
            "overall_progress_percent": percent(
                total_current_base,
                total_target_base,
            ),
        },
        "goals": rows,
    }


'''
    text = text.replace(
        '@router.get("/loan-analytics/{family_id}")',
        insert + '@router.get("/loan-analytics/{family_id}")',
        1,
    )

p.write_text(text, encoding="utf-8")
print("GOAL CURRENCY REPORT ADDED")
