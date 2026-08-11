from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

# Fix wrong Goal model name
text = text.replace("db.query(Goal)", "db.query(FinancialGoal)")
text = text.replace("Goal.family_id", "FinancialGoal.family_id")
text = text.replace("Goal.deleted_at", "FinancialGoal.deleted_at")

# Add missing imports if needed
if "from app.models.savings import SavingsGoal" not in text:
    text = text.replace(
        "from app.models.goal import FinancialGoal",
        "from app.models.goal import FinancialGoal\nfrom app.models.savings import SavingsGoal",
        1,
    )

if "from app.models.loan import Loan" not in text:
    text = text.replace(
        "from app.models.savings import SavingsGoal",
        "from app.models.savings import SavingsGoal\nfrom app.models.loan import Loan",
        1,
    )

p.write_text(text, encoding="utf-8")
print("FAMILY SUMMARY MODEL FIX OK")
