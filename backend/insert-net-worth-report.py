from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/net-worth/{family_id}")
def net_worth_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    wallet_balance = Decimal("0")
    savings_amount = Decimal("0")
    goal_saved_amount = Decimal("0")
    loan_remaining = Decimal("0")

    wallets = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .all()
    )

    for wallet in wallets:
        inflow = Decimal("0")
        outflow = Decimal("0")

        lines = (
            db.query(TransactionLine)
            .filter(TransactionLine.account_id == wallet.id)
            .all()
        )

        for line in lines:
            inflow += Decimal(line.debit or 0)
            outflow += Decimal(line.credit or 0)

        wallet_balance += (inflow - outflow)

    savings = (
        db.query(SavingsGoal)
        .filter(
            SavingsGoal.family_id == family_id,
        )
        .all()
    )

    for item in savings:
        savings_amount += Decimal(item.current_amount or 0)

    goals = (
        db.query(FinancialGoal)
        .filter(
            FinancialGoal.family_id == family_id,
        )
        .all()
    )

    for goal in goals:
        goal_saved_amount += Decimal(goal.current_amount or 0)

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
        )
        .all()
    )

    for loan in loans:
        loan_remaining += Decimal(loan.remaining_amount or 0)

    total_assets = wallet_balance + savings_amount + goal_saved_amount
    net_worth = total_assets - loan_remaining

    return {
        "family_id": family_id,
        "summary": {
            "wallet_balance": money(wallet_balance),
            "savings_amount": money(savings_amount),
            "goal_saved_amount": money(goal_saved_amount),
            "total_assets": money(total_assets),
            "loan_remaining": money(loan_remaining),
            "net_worth": money(net_worth),
        }
    }


'''

if '@router.get("/net-worth/{family_id}")' in text:
    print("NET WORTH REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("NET WORTH REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
