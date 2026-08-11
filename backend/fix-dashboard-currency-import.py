from pathlib import Path

p = Path("app/api/v1/dashboard.py")
text = p.read_text(encoding="utf-8")

text = text.replace(
    "from app.models.exchange_rate import ExchangeRate",
    "from app.models.currency import ExchangeRate"
)

p.write_text(text, encoding="utf-8")
print("DASHBOARD EXCHANGE RATE IMPORT FIXED")
