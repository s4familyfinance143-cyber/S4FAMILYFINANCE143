from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/budget/{family_id}")'

insert_code = '''

@router.get("/transfer-currency/{family_id}")
def transfer_currency_report(
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

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "TRANSFER"
    ]

    total_original = Decimal("0")
    total_base = Decimal("0")

    monthly = {}
    rows = []

    for tx in transactions:
        amount = Decimal(tx.amount or 0)

        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )

        converted = amount * rate

        total_original += amount
        total_base += converted

        month_key = tx.created_at.strftime("%Y-%m")

        if month_key not in monthly:
            monthly[month_key] = Decimal("0")

        monthly[month_key] += converted

        rows.append({
            "transaction_id": tx.id,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "transaction_count": len(transactions),
            "total_transfer_original": money(total_original),
            "total_transfer_base": money(total_base),
        },
        "monthly_transfer_base": [
            {
                "month": month,
                "total_transfer_base": money(total),
            }
            for month, total in sorted(monthly.items())
        ],
        "transfers": rows,
    }

'''

if '@router.get("/transfer-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("TRANSFER CURRENCY REPORT ADDED")

