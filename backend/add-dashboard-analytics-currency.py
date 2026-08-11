from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/dashboard/{family_id}")'

insert_code = '''

@router.get("/dashboard-currency/{family_id}")
def report_dashboard_currency(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    txs = get_posted_transactions(db, family_id, None, None)

    income_base = Decimal("0")
    expense_base = Decimal("0")
    transfer_base = Decimal("0")
    monthly = {}

    for tx in txs:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate
        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
                "transfer": Decimal("0"),
                "cashflow": Decimal("0"),
            }

        if tx.transaction_type == "INCOME":
            income_base += converted
            monthly[month_key]["income"] += converted

        elif tx.transaction_type == "EXPENSE":
            expense_base += converted
            monthly[month_key]["expense"] += converted

        elif tx.transaction_type == "TRANSFER":
            transfer_base += converted
            monthly[month_key]["transfer"] += converted

    for month in monthly.values():
        month["cashflow"] = month["income"] - month["expense"]

    cashflow_base = income_base - expense_base

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "total_income_base": money(income_base),
            "total_expense_base": money(expense_base),
            "cashflow_base": money(cashflow_base),
            "total_transfer_base": money(transfer_base),
            "transaction_count": len(txs),
        },
        "monthly": [
            {
                "month": month,
                "income_base": money(values["income"]),
                "expense_base": money(values["expense"]),
                "cashflow_base": money(values["cashflow"]),
                "transfer_base": money(values["transfer"]),
            }
            for month, values in sorted(monthly.items())
        ],
    }


'''

if '@router.get("/dashboard-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("DASHBOARD ANALYTICS CURRENCY REPORT ADDED")
