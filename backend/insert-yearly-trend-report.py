from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/yearly-trend/{family_id}")
def yearly_trend_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    transactions = get_posted_transactions(db, family_id, None, None)

    yearly = {}

    for tx in transactions:
        year_key = tx.created_at.strftime("%Y")

        if year_key not in yearly:
            yearly[year_key] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
            }

        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            yearly[year_key]["income"] += amount

        elif tx.transaction_type == "EXPENSE":
            yearly[year_key]["expense"] += amount

    rows = []

    for year, data in sorted(yearly.items()):
        income = data["income"]
        expense = data["expense"]

        rows.append(
            {
                "year": year,
                "income": money(income),
                "expense": money(expense),
                "cashflow": money(income - expense),
            }
        )

    return {
        "family_id": family_id,
        "years": rows,
    }


'''

if '@router.get("/yearly-trend/{family_id}")' in text:
    print("YEARLY TREND REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("YEARLY TREND REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
