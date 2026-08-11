from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

if "from app.models.budget import Budget" not in text:
    text = text.replace(
        "from app.models.goal import FinancialGoal",
        "from app.models.goal import FinancialGoal\nfrom app.models.budget import Budget",
        1,
    )

text = text.replace("budget.amount", "budget.budget_amount")
text = text.replace('getattr(budget, "budget_name", None)', 'getattr(budget, "name", None)')

p.write_text(text, encoding="utf-8")
print("BUDGET REPORT FIELD FIX OK")
