from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

code = '''

@router.get("/goal-statement-currency/{family_id}")
def goal_statement_currency_report(
    family_id: str,
    goal_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)
    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    query = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    )

    if goal_id:
        query = query.filter(FinancialGoal.id == goal_id)

    goals = query.order_by(FinancialGoal.created_at.desc()).all()
    txs = get_posted_transactions(db, family_id, start_date, end_date)

    total_target_base = Decimal("0")
    total_current_base = Decimal("0")
    rows = []

    for goal in goals:
        currency = getattr(goal, "currency", base_currency)

        rate = report_currency_rate(db, currency, base_currency)

        target_base = Decimal(goal.target_amount or 0) * rate
        current_base = Decimal(goal.current_amount or 0) * rate

        total_target_base += target_base
        total_current_base += current_base

        contribution_base = Decimal("0")
        withdraw_base = Decimal("0")
        running_base = Decimal("0")
        movement_rows = []

        for tx in txs:
            tx_type = (tx.transaction_type or "").upper()

            if tx_type not in ["GOAL_CONTRIBUTION", "GOAL_WITHDRAW"]:
                continue

            # Current schema may not have direct goal_id on transaction,
            # so this safely matches by goal name in description.
            # Later this should be upgraded to entity_id/link table.
            if goal.name not in (tx.description or ""):
                continue

            tx_rate = report_currency_rate(db, tx.currency, base_currency)
            amount_base = Decimal(tx.amount or 0) * tx_rate

            if tx_type == "GOAL_CONTRIBUTION":
                contribution_base += amount_base
                running_base += amount_base
            elif tx_type == "GOAL_WITHDRAW":
                withdraw_base += amount_base
                running_base -= amount_base

            movement_rows.append({
                "transaction_id": tx.id,
                "transaction_type": tx.transaction_type,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "base_currency": base_currency,
                "rate": money(tx_rate),
                "converted_amount": money(amount_base),
                "running_balance_base": money(running_base),
                "description": tx.description,
                "created_at": tx.created_at,
            })

        rows.append({
            "goal_id": goal.id,
            "goal_name": goal.name,
            "currency": currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "target_amount": money(goal.target_amount),
            "current_amount": money(goal.current_amount),
            "target_amount_base": money(target_base),
            "current_amount_base": money(current_base),
            "contribution_base": money(contribution_base),
            "withdraw_base": money(withdraw_base),
            "net_movement_base": money(contribution_base - withdraw_base),
            "progress_percent": percent(goal.current_amount, goal.target_amount),
            "status": goal.status,
            "created_at": goal.created_at,
            "movements": movement_rows,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "goal_id": goal_id,
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "goal_count": len(rows),
            "total_target_base": money(total_target_base),
            "total_current_base": money(total_current_base),
            "overall_progress_percent": percent(total_current_base, total_target_base),
        },
        "goals": rows,
    }

'''

if '@router.get("/goal-statement-currency/{family_id}")' not in text:
    text += "\n\n" + code

p.write_text(text, encoding="utf-8")
print("GOAL STATEMENT CURRENCY REPORT ADDED")
