from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/dashboard-currency/{family_id}")'

insert_code = '''

@router.get("/financial-statement-currency/{family_id}")
def financial_statement_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    wallets = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
    ).all()

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    transactions = get_posted_transactions(db, family_id, None, None)

    wallet_total = Decimal("0")
    savings_total = Decimal("0")
    goal_total = Decimal("0")
    loan_given_total = Decimal("0")
    loan_taken_total = Decimal("0")
    income_total = Decimal("0")
    expense_total = Decimal("0")
    transfer_total = Decimal("0")

    asset_rows = []
    receivable_rows = []
    liability_rows = []

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate
        wallet_total += converted

        asset_rows.append({
            "type": "WALLET",
            "id": wallet.id,
            "name": wallet.name,
            "currency": wallet.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for saving in savings:
        amount = Decimal(saving.current_amount or 0)
        rate = report_currency_rate(db, saving.currency, base_currency)
        converted = amount * rate
        savings_total += converted

        asset_rows.append({
            "type": "SAVINGS",
            "id": saving.id,
            "name": saving.name,
            "currency": saving.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        goal_total += converted

        asset_rows.append({
            "type": "GOAL",
            "id": goal.id,
            "name": goal.goal_name,
            "currency": goal_currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        row = {
            "type": loan.loan_type,
            "id": loan.id,
            "person_name": loan.person_name,
            "currency": loan.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        }

        if loan.loan_type == "GIVEN":
            loan_given_total += converted
            receivable_rows.append(row)

        elif loan.loan_type == "TAKEN":
            loan_taken_total += converted
            liability_rows.append(row)

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate

        if tx.transaction_type == "INCOME":
            income_total += converted
        elif tx.transaction_type == "EXPENSE":
            expense_total += converted
        elif tx.transaction_type == "TRANSFER":
            transfer_total += converted

    total_assets = wallet_total + savings_total + goal_total
    total_receivables = loan_given_total
    total_liabilities = loan_taken_total
    cashflow = income_total - expense_total
    net_worth = total_assets + total_receivables - total_liabilities

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "statement": {
            "assets": {
                "wallets": money(wallet_total),
                "savings": money(savings_total),
                "goals": money(goal_total),
                "total_assets": money(total_assets),
            },
            "receivables": {
                "loan_given": money(total_receivables),
            },
            "liabilities": {
                "loan_taken": money(total_liabilities),
            },
            "profit_loss": {
                "income": money(income_total),
                "expense": money(expense_total),
                "cashflow": money(cashflow),
                "transfer": money(transfer_total),
            },
            "net_worth": money(net_worth),
        },
        "assets_detail": asset_rows,
        "receivables_detail": receivable_rows,
        "liabilities_detail": liability_rows,
    }


'''

if '@router.get("/financial-statement-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("FINANCIAL STATEMENT CURRENCY REPORT ADDED")
