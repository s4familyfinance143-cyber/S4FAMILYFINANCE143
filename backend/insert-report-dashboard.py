from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/dashboard/{family_id}")
def report_dashboard(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    income = Decimal("0")
    expense = Decimal("0")

    txs = get_posted_transactions(db, family_id, None, None)

    for tx in txs:
        amt = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            income += amt
        elif tx.transaction_type == "EXPENSE":
            expense += amt

    savings_total = Decimal("0")
    for s in db.query(SavingsGoal).filter(SavingsGoal.family_id == family_id).all():
        savings_total += Decimal(s.current_amount or 0)

    goal_saved = Decimal("0")
    for g in db.query(FinancialGoal).filter(FinancialGoal.family_id == family_id).all():
        goal_saved += Decimal(g.current_amount or 0)

    loan_remaining = Decimal("0")
    for l in db.query(Loan).filter(Loan.family_id == family_id).all():
        loan_remaining += Decimal(l.remaining_amount or 0)

    return {
        "family_id": family_id,
        "dashboard": {
            "total_income": money(income),
            "total_expense": money(expense),
            "cashflow": money(income - expense),
            "total_savings": money(savings_total),
            "goal_saved": money(goal_saved),
            "loan_remaining": money(loan_remaining),
            "net_worth": money(
                savings_total + goal_saved + income - expense - loan_remaining
            ),
        }
    }

'''

if '@router.get("/dashboard/{family_id}")' in text:
    print("REPORT DASHBOARD ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("REPORT DASHBOARD INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
