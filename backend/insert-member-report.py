from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/members/{family_id}")
def member_wise_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    members = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
        .all()
    )

    rows = []

    for member in members:

        income = Decimal("0")
        expense = Decimal("0")
        savings = Decimal("0")
        goals = Decimal("0")
        loans = Decimal("0")

        txs = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.created_by_member_id == member.id,
                Transaction.status == "POSTED",
            )
            .all()
        )

        for tx in txs:
            amount = Decimal(tx.amount or 0)

            if tx.transaction_type == "INCOME":
                income += amount

            elif tx.transaction_type == "EXPENSE":
                expense += amount

        member_savings = (
            db.query(SavingsGoal)
            .filter(
                SavingsGoal.family_id == family_id,
                SavingsGoal.owner_member_id == member.id,
            )
            .all()
        )

        for item in member_savings:
            savings += Decimal(item.current_amount or 0)

        member_goals = (
            db.query(FinancialGoal)
            .filter(
                FinancialGoal.family_id == family_id,
                FinancialGoal.created_by_member_id == member.id,
            )
            .all()
        )

        for item in member_goals:
            goals += Decimal(item.current_amount or 0)

        member_loans = (
            db.query(Loan)
            .filter(
                Loan.family_id == family_id,
                Loan.owner_member_id == member.id,
            )
            .all()
        )

        for item in member_loans:
            loans += Decimal(item.remaining_amount or 0)

        rows.append(
            {
                "member_id": member.id,
                "member_name": getattr(member, "display_name", None),
                "role": getattr(member, "role_name", None),
                "income": money(income),
                "expense": money(expense),
                "savings": money(savings),
                "goals": money(goals),
                "loan_remaining": money(loans),
                "net_contribution": money(
                    income - expense + savings + goals - loans
                ),
            }
        )

    return {
        "family_id": family_id,
        "member_count": len(rows),
        "members": rows,
    }


'''

if '@router.get("/members/{family_id}")' in text:
    print("MEMBER REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("MEMBER REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
