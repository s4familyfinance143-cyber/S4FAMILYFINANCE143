from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

code = '''

@router.get("/savings-statement-currency/{family_id}")
def savings_statement_currency_report(
    family_id: str,
    savings_id: str | None = Query(default=None),
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

    query = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    )

    if savings_id:
        query = query.filter(SavingsGoal.id == savings_id)

    savings_goals = query.order_by(SavingsGoal.created_at.desc()).all()

    txs = get_posted_transactions(db, family_id, start_date, end_date)

    total_target_base = Decimal("0")
    total_current_base = Decimal("0")
    rows = []

    for saving in savings_goals:
        rate = report_currency_rate(db, saving.currency, base_currency)

        target_base = Decimal(saving.target_amount or 0) * rate
        current_base = Decimal(saving.current_amount or 0) * rate

        total_target_base += target_base
        total_current_base += current_base

        deposit_base = Decimal("0")
        withdraw_base = Decimal("0")
        movement_rows = []
        running_base = Decimal("0")

        for tx in txs:
            if tx.transaction_type not in ["SAVINGS_DEPOSIT", "SAVINGS_WITHDRAW"]:
                continue

            if saving.name not in (tx.description or ""):
                continue

            tx_rate = report_currency_rate(db, tx.currency, base_currency)
            amount_base = Decimal(tx.amount or 0) * tx_rate

            if tx.transaction_type == "SAVINGS_DEPOSIT":
                deposit_base += amount_base
                running_base += amount_base
            elif tx.transaction_type == "SAVINGS_WITHDRAW":
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
            "savings_id": saving.id,
            "name": saving.name,
            "goal_type": saving.goal_type,
            "currency": saving.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "target_amount": money(saving.target_amount),
            "current_amount": money(saving.current_amount),
            "target_amount_base": money(target_base),
            "current_amount_base": money(current_base),
            "deposit_base": money(deposit_base),
            "withdraw_base": money(withdraw_base),
            "net_movement_base": money(deposit_base - withdraw_base),
            "progress_percent": percent(saving.current_amount, saving.target_amount),
            "status": saving.status,
            "created_at": saving.created_at,
            "movements": movement_rows,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "savings_id": savings_id,
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "savings_count": len(rows),
            "total_target_base": money(total_target_base),
            "total_current_base": money(total_current_base),
            "overall_progress_percent": percent(total_current_base, total_target_base),
        },
        "savings": rows,
    }

'''

if '@router.get("/savings-statement-currency/{family_id}")' not in text:
    text += "\n\n" + code

p.write_text(text, encoding="utf-8")
print("SAVINGS STATEMENT CURRENCY REPORT ADDED")
