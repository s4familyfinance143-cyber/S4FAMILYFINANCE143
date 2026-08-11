from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

code = '''

@router.get("/member-statement-currency/{family_id}")
def member_statement_currency(
    family_id: str,
    member_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    members = (
        db.query(FamilyMember)
        .filter(FamilyMember.family_id == family_id)
        .all()
    )

    if member_id:
        members = [m for m in members if m.id == member_id]

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    rows = []

    total_income = Decimal("0")
    total_expense = Decimal("0")
    total_savings = Decimal("0")
    total_loan_given = Decimal("0")
    total_loan_taken = Decimal("0")
    total_net = Decimal("0")

    for member in members:

        tx_query = (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.created_by_member_id == member.id,
                Transaction.deleted_at.is_(None),
            )
        )

        if start_dt:
            tx_query = tx_query.filter(Transaction.created_at >= start_dt)

        if end_dt:
            tx_query = tx_query.filter(Transaction.created_at <= end_dt)

        txs = tx_query.all()

        income = Decimal("0")
        expense = Decimal("0")
        transfer = Decimal("0")
        savings = Decimal("0")
        loan_given = Decimal("0")
        loan_taken = Decimal("0")

        for tx in txs:

            rate = report_currency_rate(
                db,
                tx.currency,
                base_currency,
            )

            amount = Decimal(tx.amount or 0) * rate

            if tx.transaction_type == "INCOME":
                income += amount

            elif tx.transaction_type == "EXPENSE":
                expense += amount

            elif tx.transaction_type == "TRANSFER":
                transfer += amount

            elif tx.transaction_type in [
                "SAVINGS_DEPOSIT",
                "SAVINGS_WITHDRAW",
            ]:
                savings += amount

            elif tx.transaction_type == "LOAN_GIVEN":
                loan_given += amount

            elif tx.transaction_type == "LOAN_TAKEN":
                loan_taken += amount

        net = (
            income
            - expense
            + savings
            + loan_given
            - loan_taken
        )

        total_income += income
        total_expense += expense
        total_savings += savings
        total_loan_given += loan_given
        total_loan_taken += loan_taken
        total_net += net

        rows.append({
            "member_id": member.id,
            "member_name": member.user.full_name if member.user else None,
            "role": member.role,
            "relationship": member.relationship_display_label,
            "income_base": money(income),
            "expense_base": money(expense),
            "transfer_base": money(transfer),
            "savings_base": money(savings),
            "loan_given_base": money(loan_given),
            "loan_taken_base": money(loan_taken),
            "net_contribution_base": money(net),
            "transaction_count": len(txs),
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "member_id": member_id,
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "member_count": len(rows),
            "total_income_base": money(total_income),
            "total_expense_base": money(total_expense),
            "total_savings_base": money(total_savings),
            "total_loan_given_base": money(total_loan_given),
            "total_loan_taken_base": money(total_loan_taken),
            "total_net_contribution_base": money(total_net),
        },
        "members": rows,
    }

'''

if '@router.get("/member-statement-currency/{family_id}")' not in text:
    text += "\\n\\n" + code

p.write_text(text, encoding="utf-8")

print("MEMBER STATEMENT REPORT ADDED")
