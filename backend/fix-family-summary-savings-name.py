from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

text = text.replace("SavingsFinancialGoal", "SavingsGoal")

if "from app.models.savings import SavingsGoal" not in text:
    text = text.replace(
        "from app.models.goal import FinancialGoal",
        "from app.models.goal import FinancialGoal\nfrom app.models.savings import SavingsGoal",
        1,
    )

p.write_text(text, encoding="utf-8")
print("SAVINGS MODEL NAME FIX OK")
