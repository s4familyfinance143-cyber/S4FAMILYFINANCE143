from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/net-worth/{family_id}")'

insert_code = '''

@router.get("/budget-currency/{family_id}")
def budget_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .all()
    )

    rows = []

    total_budget_base = Decimal("0")
    total_spent_base = Decimal("0")
    total_remaining_base = Decimal("0")

    def category_spent(category_id):
        total = Decimal("0")

        txs = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.category_id == category_id,
                Transaction.transaction_type == "EXPENSE",
                Transaction.status == "POSTED",
                Transaction.deleted_at.is_(None),
            )
            .all()
        )

        for tx in txs:
            total += Decimal(tx.amount or 0)

        return total

    for budget in budgets:
        budget_amount = Decimal(budget.budget_amount or 0)
        spent_amount = category_spent(budget.category_id)
        remaining_amount = budget_amount - spent_amount

        rate = report_currency_rate(
            db,
            budget.currency,
            base_currency,
        )

        budget_base = budget_amount * rate
        spent_base = spent_amount * rate
        remaining_base = remaining_amount * rate

        total_budget_base += budget_base
        total_spent_base += spent_base
        total_remaining_base += remaining_base

        rows.append({
            "budget_id": budget.id,
            "budget_name": budget.name,
            "currency": budget.currency,
            "base_currency": base_currency,
            "rate": money(rate),

            "budget_amount": money(budget_amount),
            "budget_amount_base": money(budget_base),

            "spent_amount": money(spent_amount),
            "spent_amount_base": money(spent_base),

            "remaining_amount": money(remaining_amount),
            "remaining_amount_base": money(remaining_base),

            "status": budget.status,
            "period_type": budget.period_type,
        })

    used_percent = "0.00"

    if total_budget_base > 0:
        used_percent = str(
            round(
                (total_spent_base / total_budget_base) * Decimal("100"),
                2,
            )
        )

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "budget_count": len(rows),
            "total_budget_base": money(total_budget_base),
            "total_spent_base": money(total_spent_base),
            "total_remaining_base": money(total_remaining_base),
            "used_percent": used_percent,
        },
        "budgets": rows,
    }


'''

text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")

print("BUDGET CURRENCY REPORT ADDED")
