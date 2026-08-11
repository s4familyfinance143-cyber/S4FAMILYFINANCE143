from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/balance-sheet-currency/{family_id}")'

insert_code = '''

@router.get("/profit-loss-currency/{family_id}")
def profit_loss_currency_report(
    family_id: str,
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

    txs = get_posted_transactions(db, family_id, start_date, end_date)

    income_total = Decimal("0")
    expense_total = Decimal("0")

    income_by_category = {}
    expense_by_category = {}

    for tx in txs:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        category_key = tx.category_id or "UNCATEGORIZED"

        if tx.transaction_type == "INCOME":
            income_total += converted
            income_by_category[category_key] = income_by_category.get(category_key, Decimal("0")) + converted

        elif tx.transaction_type == "EXPENSE":
            expense_total += converted
            expense_by_category[category_key] = expense_by_category.get(category_key, Decimal("0")) + converted

    net_profit = income_total - expense_total

    income_rows = []
    for category_id, total in income_by_category.items():
        income_rows.append({
            "category": serialize_category(db, None if category_id == "UNCATEGORIZED" else category_id),
            "amount_base": money(total),
        })

    expense_rows = []
    for category_id, total in expense_by_category.items():
        expense_rows.append({
            "category": serialize_category(db, None if category_id == "UNCATEGORIZED" else category_id),
            "amount_base": money(total),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_income_base": money(income_total),
            "total_expense_base": money(expense_total),
            "net_profit_base": money(net_profit),
            "profit_margin_percent": percent(net_profit, income_total),
        },
        "income_by_category": sorted(
            income_rows,
            key=lambda x: Decimal(x["amount_base"]),
            reverse=True,
        ),
        "expense_by_category": sorted(
            expense_rows,
            key=lambda x: Decimal(x["amount_base"]),
            reverse=True,
        ),
    }


'''

if '@router.get("/profit-loss-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("PROFIT LOSS CURRENCY REPORT ADDED")
