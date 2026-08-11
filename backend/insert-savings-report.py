from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/savings/{family_id}")
def savings_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
        )
        .all()
    )

    total_target = Decimal("0")
    total_saved = Decimal("0")

    rows = []

    for item in savings:
        target = Decimal(item.target_amount or 0)
        saved = Decimal(item.current_amount or 0)

        total_target += target
        total_saved += saved

        progress = Decimal("0")

        if target > 0:
            progress = (saved / target) * Decimal("100")

        rows.append(
            {
                "id": item.id,
                "name": item.name,
                "goal_type": item.goal_type,
                "target_amount": money(target),
                "current_amount": money(saved),
                "remaining_amount": money(target - saved),
                "progress_percent": str(round(progress, 2)),
                "currency": item.currency,
                "status": item.status,
            }
        )

    return {
        "family_id": family_id,
        "summary": {
            "total_savings_goals": len(rows),
            "total_target_amount": money(total_target),
            "total_saved_amount": money(total_saved),
            "total_remaining_amount": money(total_target - total_saved),
        },
        "savings": rows,
    }


'''

if '@router.get("/savings/{family_id}")' in text:
    print("SAVINGS REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("SAVINGS REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
