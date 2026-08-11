from pathlib import Path

p = Path("app/api/v1/currency.py")
text = p.read_text(encoding="utf-8")

if "from app.models.family import Family" not in text:
    text = text.replace(
        "from app.models.currency import Currency, ExchangeRate",
        "from app.models.currency import Currency, ExchangeRate\nfrom app.models.family import Family\nfrom app.models.account import Account",
        1,
    )

if '@router.get("/family-summary/{family_id}")' not in text:
    text += '''

@router.get("/family-summary/{family_id}")
def family_currency_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    family = db.get(Family, family_id)

    if not family:
        raise HTTPException(404, "Family not found")

    base_currency = family.default_currency

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
            Account.is_active.is_(True),
        )
        .all()
    )

    total_base = Decimal("0")
    items = []

    for wallet in wallets:
        balance = Decimal(wallet.current_balance or 0)

        if wallet.currency == base_currency:
            converted = balance
            rate_used = Decimal("1")
        else:
            try:
                rate_used = get_latest_rate(
                    db=db,
                    from_currency=wallet.currency,
                    to_currency=base_currency,
                )
                converted = balance * rate_used
            except Exception:
                rate_used = Decimal("0")
                converted = Decimal("0")

        total_base += converted

        items.append({
            "wallet_id": wallet.id,
            "wallet_name": wallet.name,
            "wallet_currency": wallet.currency,
            "balance": money(balance),
            "rate_used": money(rate_used),
            "converted_balance": money(converted),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "wallet_count": len(items),
        "total_converted_balance": money(total_base),
        "wallets": items,
    }

'''

p.write_text(text, encoding="utf-8")
print("FAMILY CURRENCY SUMMARY ADDED")
