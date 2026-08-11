from pathlib import Path

p = Path("app/api/v1/dashboard.py")
text = p.read_text(encoding="utf-8")

old = '''def get_rate_to_base(db, from_currency, to_currency):
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

new = '''def get_rate_to_base(db, from_currency, to_currency, rate_date=None):
    if from_currency == to_currency:
        return Decimal("1")

    query = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
            ExchangeRate.is_active.is_(True),
            ExchangeRate.deleted_at.is_(None),
        )
    )

    if rate_date:
        query = query.filter(ExchangeRate.rate_date <= rate_date)

    rate = query.order_by(ExchangeRate.rate_date.desc()).first()

    if not rate:
        return Decimal("0")

    return Decimal(str(rate.rate))
'''

if old not in text:
    print("OLD RATE FUNCTION NOT FOUND - SKIPPED FUNCTION REPLACE")
else:
    text = text.replace(old, new, 1)

text = text.replace(
    "rate = get_rate_to_base(db, tx.currency, base_currency)\n        converted = amount * rate",
    "rate = get_rate_to_base(db, tx.currency, base_currency, tx.created_at.date())\n        converted = amount * rate"
)

p.write_text(text, encoding="utf-8")
print("DASHBOARD HISTORICAL RATE HARDENED")
