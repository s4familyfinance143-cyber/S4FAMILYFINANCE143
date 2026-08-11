from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
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
        )
        .all()
    )

    total_budget = Decimal("0")
    total_spent = Decimal("0")

    rows = []

    for budget in budgets:
        budget_amount = Decimal(budget.amount or 0)

        spent_amount = Decimal("0")

        transactions = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.category_id == budget.category_id,
                Transaction.transaction_type == "EXPENSE",
                Transaction.status == "POSTED",
            )
            .all()
        )

        for tx in transactions:
            spent_amount += Decimal(tx.amount or 0)

        remaining_amount = budget_amount - spent_amount

        used_percent = Decimal("0")
        if budget_amount > 0:
            used_percent = (spent_amount / budget_amount) * Decimal("100")

        rows.append(
            {
                "budget_id": budget.id,
                "budget_name": getattr(budget, "budget_name", None),
                "category": serialize_category(db, budget.category_id),
                "budget_amount": money(budget_amount),
                "spent_amount": money(spent_amount),
                "remaining_amount": money(remaining_amount),
                "used_percent": str(round(used_percent, 2)),
                "over_budget": spent_amount > budget_amount,
                "status": getattr(budget, "status", "ACTIVE"),
            }
        )

        total_budget += budget_amount
        total_spent += spent_amount

    return {
        "family_id": family_id,
        "summary": {
            "total_budget": money(total_budget),
            "total_spent": money(total_spent),
            "total_remaining": money(total_budget - total_spent),
            "used_percent": (
                str(round((total_spent / total_budget) * 100, 2))
                if total_budget > 0
                else "0"
            ),
        },
        "budgets": rows,
    }


'''

if '@router.get("/budget/{family_id}")' in text:
    print("BUDGET REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("BUDGET REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
