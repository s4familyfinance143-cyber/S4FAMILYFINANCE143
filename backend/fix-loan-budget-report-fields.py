from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

# Required imports
if "from app.models.budget import Budget" not in text:
    text = text.replace(
        "from app.models.goal import FinancialGoal",
        "from app.models.goal import FinancialGoal\nfrom app.models.budget import Budget",
        1,
    )

if "from app.models.loan import Loan" not in text:
    text = text.replace(
        "from app.models.budget import Budget",
        "from app.models.budget import Budget\nfrom app.models.loan import Loan",
        1,
    )

# Loan field fixes
text = text.replace("loan.loan_amount", "loan.principal_amount")
text = text.replace("loan_amount = Decimal(loan.loan_amount or 0)", "loan_amount = Decimal(loan.principal_amount or 0)")
text = text.replace('"loan_name": getattr(loan, "loan_name", None)', '"person_name": loan.person_name')
text = text.replace('"loan_type": getattr(loan, "loan_type", None)', '"loan_type": loan.loan_type')
text = text.replace('"currency": getattr(loan, "currency", "BDT")', '"currency": loan.currency')
text = text.replace('"status": getattr(loan, "status", "ACTIVE")', '"status": loan.status')

# Budget field fixes
text = text.replace("budget.amount", "budget.budget_amount")
text = text.replace("budget_amount = Decimal(budget.amount or 0)", "budget_amount = Decimal(budget.budget_amount or 0)")
text = text.replace('getattr(budget, "budget_name", None)', 'budget.name')
text = text.replace('"status": getattr(budget, "status", "ACTIVE")', '"status": budget.status')

p.write_text(text, encoding="utf-8")
print("LOAN AND BUDGET REPORT FIELD FIX OK")
