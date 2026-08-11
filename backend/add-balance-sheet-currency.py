from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/financial-statement-currency/{family_id}")'

insert_code = '''

@router.get("/balance-sheet-currency/{family_id}")
def balance_sheet_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    assets_total = Decimal("0")
    liabilities_total = Decimal("0")
    equity_total = Decimal("0")

    current_assets = []
    savings_assets = []
    goal_assets = []
    receivables = []
    liabilities = []

    wallets = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
    ).all()

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate
        assets_total += converted

        current_assets.append({
            "account_id": wallet.id,
            "name": wallet.name,
            "currency": wallet.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    for saving in savings:
        amount = Decimal(saving.current_amount or 0)
        rate = report_currency_rate(db, saving.currency, base_currency)
        converted = amount * rate
        assets_total += converted

        savings_assets.append({
            "savings_id": saving.id,
            "name": saving.name,
            "currency": saving.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        assets_total += converted

        goal_assets.append({
            "goal_id": goal.id,
            "name": goal.goal_name,
            "currency": goal_currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            assets_total += converted
            receivables.append({
                "loan_id": loan.id,
                "person_name": loan.person_name,
                "currency": loan.currency,
                "amount": money(amount),
                "rate": money(rate),
                "converted_amount": money(converted),
            })

        elif loan.loan_type == "TAKEN":
            liabilities_total += converted
            liabilities.append({
                "loan_id": loan.id,
                "person_name": loan.person_name,
                "currency": loan.currency,
                "amount": money(amount),
                "rate": money(rate),
                "converted_amount": money(converted),
            })

    equity_total = assets_total - liabilities_total

    balanced = assets_total == liabilities_total + equity_total

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "balance_sheet": {
            "assets_total": money(assets_total),
            "liabilities_total": money(liabilities_total),
            "equity_total": money(equity_total),
            "liabilities_plus_equity": money(liabilities_total + equity_total),
            "balanced": balanced,
        },
        "assets": {
            "current_assets": current_assets,
            "savings_assets": savings_assets,
            "goal_assets": goal_assets,
            "receivables": receivables,
        },
        "liabilities": liabilities,
        "equity": {
            "family_net_worth": money(equity_total),
        },
    }


'''

if '@router.get("/balance-sheet-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("BALANCE SHEET CURRENCY REPORT ADDED")
