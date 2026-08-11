from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

marker = '@router.get("/profit-loss-currency/{family_id}")'

insert_code = '''

@router.get("/trial-balance-currency/{family_id}")
def trial_balance_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    debit_total = Decimal("0")
    credit_total = Decimal("0")
    rows = []

    def add_row(account_name, account_type, debit, credit):
        nonlocal debit_total, credit_total

        debit_total += debit
        credit_total += credit

        rows.append({
            "account_name": account_name,
            "account_type": account_type,
            "debit_base": money(debit),
            "credit_base": money(credit),
        })

    wallets = db.query(Account).filter(
        Account.family_id == family_id,
        Account.deleted_at.is_(None),
    ).all()

    for wallet in wallets:
        amount = Decimal(wallet.current_balance or 0)
        rate = report_currency_rate(db, wallet.currency, base_currency)
        converted = amount * rate

        if converted >= 0:
            add_row(wallet.name, "ASSET_WALLET", converted, Decimal("0"))
        else:
            add_row(wallet.name, "ASSET_WALLET", Decimal("0"), abs(converted))

    savings = db.query(SavingsGoal).filter(
        SavingsGoal.family_id == family_id,
        SavingsGoal.deleted_at.is_(None),
    ).all()

    for saving in savings:
        amount = Decimal(saving.current_amount or 0)
        rate = report_currency_rate(db, saving.currency, base_currency)
        converted = amount * rate
        add_row(saving.name, "ASSET_SAVINGS", converted, Decimal("0"))

    goals = db.query(FinancialGoal).filter(
        FinancialGoal.family_id == family_id,
        FinancialGoal.deleted_at.is_(None),
    ).all()

    for goal in goals:
        goal_currency = getattr(goal, "currency", base_currency)
        amount = Decimal(goal.current_amount or 0)
        rate = report_currency_rate(db, goal_currency, base_currency)
        converted = amount * rate
        add_row(goal.goal_name, "ASSET_GOAL", converted, Decimal("0"))

    loans = db.query(Loan).filter(
        Loan.family_id == family_id,
        Loan.deleted_at.is_(None),
    ).all()

    for loan in loans:
        amount = Decimal(loan.remaining_amount or 0)
        rate = report_currency_rate(db, loan.currency, base_currency)
        converted = amount * rate

        if loan.loan_type == "GIVEN":
            add_row(
                f"Loan Given - {loan.person_name}",
                "ASSET_RECEIVABLE",
                converted,
                Decimal("0"),
            )

        elif loan.loan_type == "TAKEN":
            add_row(
                f"Loan Taken - {loan.person_name}",
                "LIABILITY_PAYABLE",
                Decimal("0"),
                converted,
            )

    equity = debit_total - credit_total

    add_row(
        "Family Equity / Net Worth",
        "EQUITY",
        Decimal("0"),
        equity,
    )

    difference = debit_total - credit_total

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "debit_total": money(debit_total),
            "credit_total": money(credit_total),
            "difference": money(difference),
            "is_balanced": difference == Decimal("0"),
        },
        "rows": rows,
    }


'''

if '@router.get("/trial-balance-currency/{family_id}")' not in text:
    text = text.replace(marker, insert_code + "\n\n" + marker)

p.write_text(text, encoding="utf-8")
print("TRIAL BALANCE CURRENCY REPORT ADDED")
