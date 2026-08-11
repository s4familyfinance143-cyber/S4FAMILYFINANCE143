from pathlib import Path

p = Path("app/api/v1/dashboard.py")
text = p.read_text(encoding="utf-8")

start = text.index("def get_rate_to_base(")
end = text.index("\ndef money(value):", start)

new_func = '''def get_rate_to_base(db, from_currency, to_currency, rate_date=None):
    from_currency = str(from_currency or "").upper().strip()
    to_currency = str(to_currency or "").upper().strip()

    if from_currency == to_currency:
        return Decimal("1")

    if rate_date:
        historical = (
            db.query(ExchangeRate)
            .filter(
                ExchangeRate.from_currency == from_currency,
                ExchangeRate.to_currency == to_currency,
                ExchangeRate.is_active.is_(True),
                ExchangeRate.deleted_at.is_(None),
                ExchangeRate.rate_date <= rate_date,
            )
            .order_by(ExchangeRate.rate_date.desc())
            .first()
        )

        if historical:
            return Decimal(str(historical.rate))

    latest = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.from_currency == from_currency,
            ExchangeRate.to_currency == to_currency,
            ExchangeRate.is_active.is_(True),
            ExchangeRate.deleted_at.is_(None),
        )
        .order_by(ExchangeRate.rate_date.desc())
        .first()
    )

    if latest:
        return Decimal(str(latest.rate))

    return Decimal("0")
'''

text = text[:start] + new_func + text[end:]
p.write_text(text, encoding="utf-8")

print("DASHBOARD RATE SAFE FIX APPLIED")
