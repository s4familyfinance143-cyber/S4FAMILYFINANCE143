from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/family-summary/{family_id}")
def family_summary_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    income_total = Decimal("0")
    expense_total = Decimal("0")
    savings_total = Decimal("0")
    goal_target_total = Decimal("0")
    goal_current_total = Decimal("0")
    loan_total = Decimal("0")

    transactions = get_posted_transactions(db, family_id, None, None)

    for tx in transactions:
        amount = Decimal(tx.amount or 0)

        if tx.transaction_type == "INCOME":
            income_total += amount
        elif tx.transaction_type == "EXPENSE":
            expense_total += amount

    goals = (
        db.query(Goal)
        .filter(
            Goal.family_id == family_id,
            Goal.deleted_at.is_(None),
        )
        .all()
    )

    for goal in goals:
        goal_target_total += Decimal(goal.target_amount or 0)
        goal_current_total += Decimal(goal.current_amount or 0)

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    for loan in loans:
        loan_total += Decimal(loan.remaining_amount or 0)

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    for item in savings:
        savings_total += Decimal(item.current_amount or 0)

    net_worth = (
        income_total
        + savings_total
        + goal_current_total
        - expense_total
        - loan_total
    )

    return {
        "family_id": family_id,
        "summary": {
            "total_income": money(income_total),
            "total_expense": money(expense_total),
            "total_savings": money(savings_total),
            "total_goal_target": money(goal_target_total),
            "total_goal_saved": money(goal_current_total),
            "total_loan_remaining": money(loan_total),
            "net_worth": money(net_worth),
        },
        "counts": {
            "goals": len(goals),
            "loans": len(loans),
            "savings": len(savings),
        },
    }


'''

if '@router.get("/family-summary/{family_id}")' in text:
    print("FAMILY SUMMARY REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("FAMILY SUMMARY REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
