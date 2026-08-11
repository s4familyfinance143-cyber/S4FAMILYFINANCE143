from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

start = text.find('@router.get("/budget/{family_id}")')
end = text.find('@router.get("/cashflow/{family_id}")', start)

if start == -1:
    raise SystemExit("ERROR: budget report endpoint not found")

if end == -1:
    raise SystemExit("ERROR: cashflow marker not found after budget report")

new_endpoint = r'''
@router.get("/budget/{family_id}")
def budget_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .order_by(Budget.created_at.desc())
        .all()
    )

    active_rows = []
    closed_rows = []

    active_total_budget = Decimal("0")
    active_total_spent = Decimal("0")

    counted_active_categories = set()

    def calculate_category_spent(category_id: str) -> Decimal:
        total = Decimal("0")

        transactions = (
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

        for tx in transactions:
            total += Decimal(tx.amount or 0)

        return total

    for budget in budgets:
        budget_amount = Decimal(budget.budget_amount or 0)
        spent_amount = calculate_category_spent(budget.category_id)
        remaining_amount = budget_amount - spent_amount

        used_percent = Decimal("0")
        if budget_amount > 0:
            used_percent = (spent_amount / budget_amount) * Decimal("100")

        row = {
            "budget_id": budget.id,
            "budget_name": budget.name,
            "category": serialize_category(db, budget.category_id),
            "budget_amount": money(budget_amount),
            "spent_amount": money(spent_amount),
            "remaining_amount": money(remaining_amount),
            "used_percent": str(round(used_percent, 2)),
            "over_budget": spent_amount > budget_amount,
            "currency": budget.currency,
            "period_type": budget.period_type,
            "status": budget.status,
            "note": budget.note,
            "created_at": budget.created_at,
        }

        if budget.status == "ACTIVE":
            active_rows.append(row)

            if budget.category_id not in counted_active_categories:
                active_total_budget += budget_amount
                active_total_spent += spent_amount
                counted_active_categories.add(budget.category_id)

        else:
            closed_rows.append(row)

    active_total_remaining = active_total_budget - active_total_spent

    active_used_percent = "0.00"
    if active_total_budget > 0:
        active_used_percent = str(
            round((active_total_spent / active_total_budget) * Decimal("100"), 2)
        )

    return {
        "family_id": family_id,
        "summary": {
            "active_budget_count": len(active_rows),
            "closed_budget_count": len(closed_rows),
            "active_total_budget": money(active_total_budget),
            "active_total_spent": money(active_total_spent),
            "active_total_remaining": money(active_total_remaining),
            "active_used_percent": active_used_percent,
            "active_over_budget": active_total_spent > active_total_budget if active_total_budget > 0 else False,
        },
        "active_budgets": active_rows,
        "closed_budgets": closed_rows,
    }


'''

text = text[:start] + new_endpoint + text[end:]
p.write_text(text, encoding="utf-8")
print("BUDGET REPORT HARDENED OK")
