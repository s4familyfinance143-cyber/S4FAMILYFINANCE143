from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/expense-currency/{family_id}")' not in text:
    insert = '''

@router.get("/expense-currency/{family_id}")
def expense_currency_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "EXPENSE"
    ]

    total_original = Decimal("0")
    total_base = Decimal("0")
    rows = []
    monthly = {}

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        total_original += amount
        total_base += converted

        month_key = tx.created_at.strftime("%Y-%m")
        monthly[month_key] = monthly.get(month_key, Decimal("0")) + converted

        rows.append({
            "transaction_id": tx.id,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "category": serialize_category(db, tx.category_id),
            "wallet": transaction_wallet_info(db, tx)["wallet"],
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "transaction_count": len(transactions),
            "total_original_mixed": money(total_original),
            "total_expense_base": money(total_base),
        },
        "monthly_expense_base": [
            {
                "month": month,
                "total_expense_base": money(total),
            }
            for month, total in sorted(monthly.items())
        ],
        "transactions": rows,
    }


'''
    text = text.replace('@router.get("/expense/{family_id}")', insert + '@router.get("/expense/{family_id}")', 1)

p.write_text(text, encoding="utf-8")
print("EXPENSE CURRENCY REPORT ADDED")
