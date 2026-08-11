from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/wallets/{family_id}")
def wallet_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    rows = []

    total_balance = Decimal("0")

    for wallet in wallets:
        inflow = Decimal("0")
        outflow = Decimal("0")

        lines = (
            db.query(TransactionLine)
            .filter(TransactionLine.account_id == wallet.id)
            .all()
        )

        for line in lines:
            inflow += Decimal(line.debit or 0)
            outflow += Decimal(line.credit or 0)

        balance = inflow - outflow
        total_balance += balance

        rows.append(
            {
                "wallet_id": wallet.id,
                "wallet_name": wallet.name,
                "wallet_type": wallet.account_type,
                "currency": wallet.currency,
                "total_inflow": money(inflow),
                "total_outflow": money(outflow),
                "balance": money(balance),
                "is_active": wallet.is_active,
            }
        )

    return {
        "family_id": family_id,
        "summary": {
            "wallet_count": len(rows),
            "total_balance": money(total_balance),
        },
        "wallets": sorted(
            rows,
            key=lambda x: Decimal(x["balance"]),
            reverse=True,
        ),
    }


'''

if '@router.get("/wallets/{family_id}")' in text:
    print("WALLET REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("WALLET REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
