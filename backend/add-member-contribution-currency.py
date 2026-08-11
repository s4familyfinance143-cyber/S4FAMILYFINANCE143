from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

insert_code = '''

@router.get("/member-contribution-currency/{family_id}")
def member_contribution_currency_report(
    family_id: str,
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
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.deleted_at.is_(None),
        )
        .all()
    )

    transactions = get_posted_transactions(
        db,
        family_id,
        start_date,
        end_date,
    )

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
            "loan_given_base": Decimal("0"),
            "loan_taken_base": Decimal("0"),
            "transaction_count": 0,
        }

    for tx in transactions:
        member_id = tx.created_by_member_id

        if member_id not in member_map:
            continue

        amount = Decimal(tx.amount or 0)
        rate = report_currency_rate(
            db,
            tx.currency,
            base_currency,
        )
        converted = amount * rate

        tx_type = (tx.transaction_type or "").upper()

        row = member_map[member_id]
        row["transaction_count"] += 1

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

        elif tx_type == "LOAN_GIVEN":
            row["loan_given_base"] += converted

        elif tx_type == "LOAN_TAKEN":
            row["loan_taken_base"] += converted

    total_income = Decimal("0")
    total_expense = Decimal("0")
    total_net = Decimal("0")
    rows = []

    for row in member_map.values():
        net_contribution = (
            row["income_base"]
            - row["expense_base"]
            - row["savings_deposit_base"]
            + row["savings_withdraw_base"]
            - row["loan_given_base"]
            + row["loan_taken_base"]
        )

        total_income += row["income_base"]
        total_expense += row["expense_base"]
        total_net += net_contribution

        rows.append({
            "member_id": row["member_id"],
            "user_id": row["user_id"],
            "member_name": row["member_name"],
            "role": row["role"],
            "relationship": row["relationship"],
            "income_base": money(row["income_base"]),
            "expense_base": money(row["expense_base"]),
            "transfer_base": money(row["transfer_base"]),
            "savings_deposit_base": money(row["savings_deposit_base"]),
            "savings_withdraw_base": money(row["savings_withdraw_base"]),
            "loan_given_base": money(row["loan_given_base"]),
            "loan_taken_base": money(row["loan_taken_base"]),
            "net_contribution_base": money(net_contribution),
            "transaction_count": row["transaction_count"],
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "member_count": len(rows),
            "total_income_base": money(total_income),
            "total_expense_base": money(total_expense),
            "total_net_contribution_base": money(total_net),
        },
        "members": sorted(
            rows,
            key=lambda x: Decimal(x["net_contribution_base"]),
            reverse=True,
        ),
    }


'''

if '@router.get("/member-contribution-currency/{family_id}")' not in text:
    text = text + "\n\n" + insert_code

p.write_text(text, encoding="utf-8")
print("MEMBER CONTRIBUTION CURRENCY REPORT ADDED")
