from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/expense/{family_id}")
def expense_report(
    family_id: str,
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = [
        tx for tx in get_posted_transactions(db, family_id, start_date, end_date)
        if tx.transaction_type == "EXPENSE"
    ]

    total_expense = Decimal("0")
    monthly = {}
    category_map = {}
    wallet_map = {}

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        total_expense += amount

        month_key = tx.created_at.strftime("%Y-%m")
        monthly[month_key] = monthly.get(month_key, Decimal("0")) + amount

        if tx.category_id:
            category_map[tx.category_id] = category_map.get(tx.category_id, Decimal("0")) + amount

        wallet_info = transaction_wallet_info(db, tx)
        wallet = wallet_info["wallet"]

        if wallet:
            wallet_id = wallet["id"]
            wallet_map.setdefault(
                wallet_id,
                {
                    "wallet_id": wallet_id,
                    "wallet_name": wallet["name"],
                    "wallet_type": wallet["account_type"],
                    "total_expense": Decimal("0"),
                },
            )
            wallet_map[wallet_id]["total_expense"] += amount

    return {
        "family_id": family_id,
        "filters": {"start_date": start_date, "end_date": end_date},
        "summary": {
            "total_expense": money(total_expense),
            "transaction_count": len(transactions),
        },
        "monthly_expense": [
            {"month": month, "total_expense": money(total)}
            for month, total in sorted(monthly.items())
        ],
        "category_expense": sorted(
            [
                {"category": serialize_category(db, category_id), "total_expense": money(total)}
                for category_id, total in category_map.items()
            ],
            key=lambda x: Decimal(x["total_expense"]),
            reverse=True,
        ),
        "wallet_expense": sorted(
            [
                {
                    "wallet_id": row["wallet_id"],
                    "wallet_name": row["wallet_name"],
                    "wallet_type": row["wallet_type"],
                    "total_expense": money(row["total_expense"]),
                }
                for row in wallet_map.values()
            ],
            key=lambda x: Decimal(x["total_expense"]),
            reverse=True,
        ),
        "transactions": [
            {
                "transaction_id": tx.id,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "category": serialize_category(db, tx.category_id),
                "wallet": transaction_wallet_info(db, tx)["wallet"],
                "description": tx.description,
                "created_at": tx.created_at,
                "status": tx.status,
            }
            for tx in transactions
        ],
    }


'''

if '@router.get("/expense/{family_id}")' in text:
    print("EXPENSE REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("EXPENSE REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
