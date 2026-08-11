from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/dashboard/{family_id}")'

insert_code = '''

@router.get("/net-worth-currency/{family_id}")
def net_worth_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    wallet_balance_base = Decimal("0")
    savings_amount_base = Decimal("0")
    goal_saved_base = Decimal("0")
    loan_given_base = Decimal("0")
    loan_taken_base = Decimal("0")

    wallet_rows = []
    savings_rows = []
    goal_rows = []
    loan_rows = []

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate
        wallet_balance_base += converted

        wallet_rows.append({
            "wallet_id": wallet.id,
            "wallet_name": wallet.name,
            "currency": wallet.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
            SavingsGoal.deleted_at.is_(None),
        )
        .all()
    )

    for item in savings:
        amount = Decimal(item.current_amount or 0)
        rate = report_currency_rate(db, item.currency, base_currency)
        converted = amount * rate
        savings_amount_base += converted

        savings_rows.append({
            "savings_id": item.id,
            "name": item.name,
            "currency": item.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
            FinancialGoal.deleted_at.is_(None),
        )
        .all()
    )

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        goal_saved_base += converted

        goal_rows.append({
            "goal_id": goal.id,
            "goal_name": goal.goal_name,
            "currency": goal_currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            loan_given_base += converted
        elif loan.loan_type == "TAKEN":
            loan_taken_base += converted

        loan_rows.append({
            "loan_id": loan.id,
            "person_name": loan.person_name,
            "loan_type": loan.loan_type,
            "currency": loan.currency,
            "remaining_amount": money(amount),
            "rate": money(rate),
            "converted_remaining_amount": money(converted),
        })

    total_assets_base = wallet_balance_base + savings_amount_base + goal_saved_base
    net_loan_position_base = loan_given_base - loan_taken_base
    net_worth_base = total_assets_base + net_loan_position_base

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_balance_base": money(wallet_balance_base),
            "savings_amount_base": money(savings_amount_base),
            "goal_saved_amount_base": money(goal_saved_base),
            "total_assets_base": money(total_assets_base),
            "loan_given_base": money(loan_given_base),
            "loan_taken_base": money(loan_taken_base),
            "net_loan_position_base": money(net_loan_position_base),
            "net_worth_base": money(net_worth_base),
        },
        "wallets": wallet_rows,
        "savings": savings_rows,
        "goals": goal_rows,
        "loans": loan_rows,
    }


'''

if '@router.get("/net-worth-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("NET WORTH CURRENCY REPORT ADDED")
