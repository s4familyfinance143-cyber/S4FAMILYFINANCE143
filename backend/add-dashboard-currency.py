from pathlib import Path

p = Path("app/api/v1/dashboard.py")
text = p.read_text(encoding="utf-8")

if "from app.models.family import Family" not in text:
    text = text.replace(
        "from app.models.user import User",
        "from app.models.user import User\nfrom app.models.family import Family\nfrom app.models.exchange_rate import ExchangeRate",
        1,
    )

if "def get_rate_to_base" not in text:
    helper = '''

def get_rate_to_base(db, from_currency, to_currency):
    if from_currency == to_currency:
        return Decimal("1")

    rate = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
        )
        .order_by(ExchangeRate.rate_date.desc())
        .first()
    )

    if not rate:
        return Decimal("0")

    return Decimal(str(rate.rate))

'''
    text = text.replace("def money(value):", helper + "\ndef money(value):", 1)

if '@router.get("/{family_id}/currency")' not in text:
    text += '''

@router.get("/{family_id}/currency")
def dashboard_currency_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.is_active.is_(True),
            Account.deleted_at.is_(None),
        )
        .all()
    )

    total_balance = Decimal("0")

    wallets = []

    for account in accounts:
        balance = Decimal(account.current_balance or 0)

        rate = get_rate_to_base(
            db,
            account.currency,
            base_currency,
        )

        converted = balance * rate

        total_balance += converted

        wallets.append({
            "wallet_name": account.name,
            "currency": account.currency,
            "balance": money(balance),
            "rate": money(rate),
            "converted_balance": money(converted),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "total_balance": money(total_balance),
        "wallets": wallets,
    }

'''

p.write_text(text, encoding="utf-8")
print("DASHBOARD CURRENCY ADDED")
