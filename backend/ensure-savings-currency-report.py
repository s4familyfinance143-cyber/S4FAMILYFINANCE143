from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

insert = '''

@router.get("/savings-currency/{family_id}")
def savings_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    savings_goals = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    total_target_base = Decimal("0")
    total_current_base = Decimal("0")
    rows = []

    for saving in savings_goals:
        rate = report_currency_rate(
            db,
            saving.currency,
            base_currency,
        )

        target_amount = Decimal(saving.target_amount or 0)
        current_amount = Decimal(saving.current_amount or 0)

        target_base = target_amount * rate
        current_base = current_amount * rate

        total_target_base += target_base
        total_current_base += current_base

        rows.append({
            "savings_id": saving.id,
            "name": saving.name,
            "goal_type": saving.goal_type,
            "currency": saving.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "target_amount": money(target_amount),
            "current_amount": money(current_amount),
            "target_base": money(target_base),
            "current_base": money(current_base),
            "progress_percent": percent(current_amount, target_amount),
            "status": saving.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "savings_count": len(savings_goals),
            "total_target_base": money(total_target_base),
            "total_current_base": money(total_current_base),
            "overall_progress_percent": percent(
                total_current_base,
                total_target_base,
            ),
        },
        "savings": rows,
    }


'''

if '@router.get("/savings-currency/{family_id}")' not in text:
    marker = '@router.get("/goals-currency/{family_id}")'
    if marker in text:
        text = text.replace(marker, insert + marker, 1)
    else:
        text += insert

p.write_text(text, encoding="utf-8")
print("SAVINGS CURRENCY ENDPOINT ENSURED")
