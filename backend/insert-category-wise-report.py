from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/categories/{family_id}")
def category_wise_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, start_date, end_date)

    income_map = {}
    expense_map = {}

    total_income = Decimal("0")
    total_expense = Decimal("0")

    for tx in transactions:
        if not tx.category_id:
            continue

        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            total_income += amount
            income_map[tx.category_id] = income_map.get(tx.category_id, Decimal("0")) + amount

        elif tx.transaction_type == "EXPENSE":
            total_expense += amount
            expense_map[tx.category_id] = expense_map.get(tx.category_id, Decimal("0")) + amount

    def build_rows(category_map, total_amount):
        rows = []

        for category_id, amount in category_map.items():
            category = serialize_category(db, category_id)

            percent_value = Decimal("0")
            if total_amount > 0:
                percent_value = (amount / total_amount) * Decimal("100")

            rows.append(
                {
                    "category": category,
                    "amount": money(amount),
                    "percent": str(round(percent_value, 2)),
                }
            )

        return sorted(
            rows,
            key=lambda x: Decimal(x["amount"]),
            reverse=True,
        )

    income_rows = build_rows(income_map, total_income)
    expense_rows = build_rows(expense_map, total_expense)

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_income": money(total_income),
            "total_expense": money(total_expense),
            "net_income_expense": money(total_income - total_expense),
            "top_income_category": income_rows[0] if income_rows else None,
            "top_expense_category": expense_rows[0] if expense_rows else None,
        },
        "income_categories": income_rows,
        "expense_categories": expense_rows,
    }


'''

if '@router.get("/categories/{family_id}")' in text:
    print("CATEGORY WISE REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("CATEGORY WISE REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
