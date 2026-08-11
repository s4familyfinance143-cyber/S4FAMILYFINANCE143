from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

old = '''    return {
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

new = '''    wallet_balance = Decimal("0")

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

        wallet_balance += inflow - outflow

    net_worth = wallet_balance + savings_total + goal_saved - loan_remaining

    return {
        "family_id": family_id,
        "dashboard": {
            "total_income": money(income),
            "total_expense": money(expense),
            "cashflow": money(income - expense),
            "wallet_balance": money(wallet_balance),
            "total_savings": money(savings_total),
            "goal_saved": money(goal_saved),
            "loan_remaining": money(loan_remaining),
            "net_worth": money(net_worth),
        }
    }
'''

if old not in text:
    raise SystemExit("ERROR: dashboard return block not found")

text = text.replace(old, new, 1)
p.write_text(text, encoding="utf-8")
print("REPORT DASHBOARD NET WORTH FIX OK")
