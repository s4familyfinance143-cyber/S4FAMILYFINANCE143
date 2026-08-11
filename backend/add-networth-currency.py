from pathlib import Path

p = Path("app/api/v1/dashboard.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/{family_id}/networth-currency")' not in text:
    text += '''

@router.get("/{family_id}/networth-currency")
def networth_currency_summary(
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

    savings_goals = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    wallet_total = Decimal("0")
    savings_total = Decimal("0")
    loan_given_total = Decimal("0")
    loan_taken_total = Decimal("0")

    wallet_items = []
    savings_items = []
    loan_items = []

    for account in accounts:
        amount = Decimal(account.current_balance or 0)
        rate = get_rate_to_base(db, account.currency, base_currency)
        converted = amount * rate
        wallet_total += converted

        wallet_items.append({
            "name": account.name,
            "currency": account.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for saving in savings_goals:
        amount = Decimal(saving.current_amount or 0)
        rate = get_rate_to_base(db, saving.currency, base_currency)
        converted = amount * rate
        savings_total += converted

        savings_items.append({
            "name": saving.name,
            "currency": saving.currency,
            "amount": money(amount),
            "rate": money(rate),
            "converted_amount": money(converted),
        })

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = get_rate_to_base(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            loan_given_total += converted
        elif loan.loan_type == "TAKEN":
            loan_taken_total += converted

        loan_items.append({
            "person_name": loan.person_name,
            "loan_type": loan.loan_type,
            "currency": loan.currency,
            "remaining_amount": money(amount),
            "rate": money(rate),
            "converted_remaining_amount": money(converted),
        })

    net_worth = wallet_total + savings_total + loan_given_total - loan_taken_total

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "wallet_balance": money(wallet_total),
            "savings_balance": money(savings_total),
            "loan_given_remaining": money(loan_given_total),
            "loan_taken_remaining": money(loan_taken_total),
            "net_worth": money(net_worth),
        },
        "wallets": wallet_items,
        "savings": savings_items,
        "loans": loan_items,
    }

'''

p.write_text(text, encoding="utf-8")
print("NET WORTH CURRENCY ENDPOINT ADDED")
