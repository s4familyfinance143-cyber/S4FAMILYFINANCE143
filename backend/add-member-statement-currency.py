from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

insert_code = '''

@router.get("/member-statement-currency/{family_id}")
def member_statement_currency_report(
    family_id: str,
    member_id: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    member_query = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
    )

    if member_id:
        member_query = member_query.filter(FamilyMember.id == member_id)

    members = member_query.all()

    member_map = {}

    for member in members:
        member_map[member.id] = {
            "member_id": member.id,
            "user_id": member.user_id,
            "member_name": member.user.full_name if member.user else None,
            "role": member.role,
            "relationship": member.relationship_display_label,
            "income_base": Decimal("0"),
            "expense_base": Decimal("0"),
            "transfer_base": Decimal("0"),
            "savings_deposit_base": Decimal("0"),
            "savings_withdraw_base": Decimal("0"),
            "goal_contribution_base": Decimal("0"),
            "goal_withdraw_base": Decimal("0"),
            "loan_given_base": Decimal("0"),
            "loan_given_payment_base": Decimal("0"),
            "loan_taken_base": Decimal("0"),
            "loan_taken_payment_base": Decimal("0"),
            "transactions": [],
        }

    txs = get_posted_transactions(db, family_id, start_date, end_date)

    for tx in txs:
        if tx.created_by_member_id not in member_map:
            continue

        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)
        converted = amount * rate
        tx_type = (tx.transaction_type or "").upper()

        row = member_map[tx.created_by_member_id]

        if tx_type == "INCOME":
            row["income_base"] += converted
        elif tx_type == "EXPENSE":
            row["expense_base"] += converted
        elif tx_type == "TRANSFER":
            row["transfer_base"] += converted
        elif tx_type == "SAVINGS_DEPOSIT":
            row["savings_deposit_base"] += converted
        elif tx_type == "SAVINGS_WITHDRAW":
            row["savings_withdraw_base"] += converted
        elif tx_type == "GOAL_CONTRIBUTION":
            row["goal_contribution_base"] += converted
        elif tx_type == "GOAL_WITHDRAW":
            row["goal_withdraw_base"] += converted
        elif tx_type == "LOAN_GIVEN":
            row["loan_given_base"] += converted
        elif tx_type == "LOAN_GIVEN_PAYMENT":
            row["loan_given_payment_base"] += converted
        elif tx_type == "LOAN_TAKEN":
            row["loan_taken_base"] += converted
        elif tx_type == "LOAN_TAKEN_PAYMENT":
            row["loan_taken_payment_base"] += converted

        row["transactions"].append({
            "transaction_id": tx.id,
            "transaction_type": tx.transaction_type,
            "amount": money(amount),
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "converted_amount": money(converted),
            "description": tx.description,
            "created_at": tx.created_at,
            "status": tx.status,
        })

    result = []

    for row in member_map.values():
        net_contribution = (
            row["income_base"]
            - row["expense_base"]
            - row["savings_deposit_base"]
            + row["savings_withdraw_base"]
            - row["goal_contribution_base"]
            + row["goal_withdraw_base"]
            - row["loan_given_base"]
            + row["loan_given_payment_base"]
            + row["loan_taken_base"]
            - row["loan_taken_payment_base"]
        )

        result.append({
            "member_id": row["member_id"],
            "user_id": row["user_id"],
            "member_name": row["member_name"],
            "role": row["role"],
            "relationship": row["relationship"],
            "summary": {
                "income_base": money(row["income_base"]),
                "expense_base": money(row["expense_base"]),
                "transfer_base": money(row["transfer_base"]),
                "savings_deposit_base": money(row["savings_deposit_base"]),
                "savings_withdraw_base": money(row["savings_withdraw_base"]),
                "goal_contribution_base": money(row["goal_contribution_base"]),
                "goal_withdraw_base": money(row["goal_withdraw_base"]),
                "loan_given_base": money(row["loan_given_base"]),
                "loan_given_payment_base": money(row["loan_given_payment_base"]),
                "loan_taken_base": money(row["loan_taken_base"]),
                "loan_taken_payment_base": money(row["loan_taken_payment_base"]),
                "net_contribution_base": money(net_contribution),
                "transaction_count": len(row["transactions"]),
            },
            "transactions": row["transactions"][offset: offset + limit],
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "member_id": member_id,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
            "offset": offset,
        },
        "member_count": len(result),
        "members": result,
    }


'''

if '@router.get("/member-statement-currency/{family_id}")' not in text:
    text = text + "\n\n" + insert_code

p.write_text(text, encoding="utf-8")
print("MEMBER STATEMENT CURRENCY REPORT ADDED")
