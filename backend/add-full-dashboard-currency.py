from pathlib import Path

p = Path("app/api/v1/dashboard.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/{family_id}/full-currency")' not in text:
    text += '''

@router.get("/{family_id}/full-currency")
def full_currency_dashboard(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="dashboard.read",
    )

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    accounts = db.query(Account).filter(
        Account.family_id == family_id,
        Account.is_active.is_(True),
        Account.deleted_at.is_(None),
    ).all()

    transactions = db.query(Transaction).filter(
        Transaction.family_id == family_id,
        Transaction.status == "POSTED",
        Transaction.deleted_at.is_(None),
    ).all()

    savings_goals = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    budgets = db.query(Budget).filter(
        Budget.family_id == family_id,
        Budget.deleted_at.is_(None),
    ).all()

    wallet_balance_base = Decimal("0")
    income_base = Decimal("0")
    expense_base = Decimal("0")
    transfer_base = Decimal("0")
    savings_target_base = Decimal("0")
    savings_current_base = Decimal("0")
    goal_target_base = Decimal("0")
    goal_current_base = Decimal("0")
    loan_given_base = Decimal("0")
    loan_taken_base = Decimal("0")

    wallet_rows = []
    recent_rows = []

    for account in accounts:
        amount = Decimal(account.current_balance or 0)
        rate = get_rate_to_base(db, account.currency, base_currency)
        converted = amount * rate

        wallet_balance_base += converted

        wallet_rows.append({
            "id": account.id,
            "name": account.name,
            "account_type": account.account_type,
            "currency": account.currency,
            "balance": money(amount),
            "rate": money(rate),
            "converted_balance": money(converted),
            "base_currency": base_currency,
        })

    for tx in transactions:
        amount = Decimal(tx.amount or 0)
        rate = get_rate_to_base(db, tx.currency, base_currency)
        converted = amount * rate

        if tx.transaction_type == "INCOME":
            income_base += converted
        elif tx.transaction_type == "EXPENSE":
            expense_base += converted
        elif tx.transaction_type == "TRANSFER":
            transfer_base += converted

    for saving in savings_goals:
        rate = get_rate_to_base(db, saving.currency, base_currency)
        savings_target_base += Decimal(saving.target_amount or 0) * rate
        savings_current_base += Decimal(saving.current_amount or 0) * rate

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        rate = get_rate_to_base(db, goal_currency, base_currency)
        goal_target_base += Decimal(goal.target_amount or 0) * rate
        goal_current_base += Decimal(goal.current_amount or 0) * rate

    for loan in loans:
        rate = get_rate_to_base(db, loan.currency, base_currency)
        converted_remaining = Decimal(loan.remaining_amount or 0) * rate

        if loan.loan_type == "GIVEN":
            loan_given_base += converted_remaining
        elif loan.loan_type == "TAKEN":
            loan_taken_base += converted_remaining

    active_budget_count = sum(1 for b in budgets if b.status == "ACTIVE")
    over_budget_count = sum(
        1 for b in budgets
        if Decimal(b.spent_amount or 0) > Decimal(b.budget_amount or 0)
    )

    net_income_expense = income_base - expense_base
    net_loan_position = loan_given_base - loan_taken_base
    net_worth = wallet_balance_base + savings_current_base + loan_given_base - loan_taken_base

    recent_transactions = sorted(
        transactions,
        key=lambda tx: tx.created_at,
        reverse=True,
    )[:10]

    for tx in recent_transactions:
        amount = Decimal(tx.amount or 0)
        rate = get_rate_to_base(db, tx.currency, base_currency)
        converted = amount * rate

        recent_rows.append({
            "id": tx.id,
            "transaction_type": tx.transaction_type,
            "amount": money(amount),
            "currency": tx.currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "base_currency": base_currency,
            "description": tx.description,
            "created_at": tx.created_at,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_count": len(accounts),
            "total_wallet_balance": money(wallet_balance_base),
            "total_income": money(income_base),
            "total_expense": money(expense_base),
            "net_income_expense": money(net_income_expense),
            "total_transfer": money(transfer_base),
            "transaction_count": len(transactions),
            "net_worth": money(net_worth),
        },
        "savings": {
            "goal_count": len(savings_goals),
            "total_target_amount": money(savings_target_base),
            "total_current_amount": money(savings_current_base),
            "overall_progress_percent": percent(savings_current_base, savings_target_base),
        },
        "loans": {
            "loan_count": len(loans),
            "loan_given_remaining": money(loan_given_base),
            "loan_taken_remaining": money(loan_taken_base),
            "net_loan_position": money(net_loan_position),
        },
        "goals": {
            "goal_count": len(goals),
            "total_target_amount": money(goal_target_base),
            "total_current_amount": money(goal_current_base),
            "overall_progress_percent": percent(goal_current_base, goal_target_base),
        },
        "budgets": {
            "budget_count": len(budgets),
            "active_budget_count": active_budget_count,
            "over_budget_count": over_budget_count,
        },
        "wallets": wallet_rows,
        "recent_transactions": recent_rows,
    }

'''

p.write_text(text, encoding="utf-8")
print("FULL DASHBOARD CURRENCY ADDED")
