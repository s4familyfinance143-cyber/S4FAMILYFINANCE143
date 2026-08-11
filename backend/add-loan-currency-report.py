from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

if '@router.get("/loans-currency/{family_id}")' not in text:
    insert = '''

@router.get("/loans-currency/{family_id}")
def loan_currency_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    family = db.get(Family, family_id)

    if not family:
        return {"detail": "Family not found"}

    base_currency = family.default_currency

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
            Loan.deleted_at.is_(None),
        )
        .all()
    )

    total_principal_base = Decimal("0")
    total_paid_base = Decimal("0")
    total_remaining_base = Decimal("0")
    given_remaining_base = Decimal("0")
    taken_remaining_base = Decimal("0")

    rows = []

    for loan in loans:
        rate = report_currency_rate(db, loan.currency, base_currency)

        principal = Decimal(loan.principal_amount or 0)
        paid = Decimal(loan.paid_amount or 0)
        remaining = Decimal(loan.remaining_amount or 0)

        principal_base = principal * rate
        paid_base = paid * rate
        remaining_base = remaining * rate

        total_principal_base += principal_base
        total_paid_base += paid_base
        total_remaining_base += remaining_base

        if loan.loan_type == "GIVEN":
            given_remaining_base += remaining_base
        elif loan.loan_type == "TAKEN":
            taken_remaining_base += remaining_base

        rows.append({
            "loan_id": loan.id,
            "person_name": loan.person_name,
            "loan_type": loan.loan_type,
            "currency": loan.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "principal_amount": money(principal),
            "paid_amount": money(paid),
            "remaining_amount": money(remaining),
            "principal_base": money(principal_base),
            "paid_base": money(paid_base),
            "remaining_base": money(remaining_base),
            "status": loan.status,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "summary": {
            "loan_count": len(loans),
            "total_principal_base": money(total_principal_base),
            "total_paid_base": money(total_paid_base),
            "total_remaining_base": money(total_remaining_base),
            "given_remaining_base": money(given_remaining_base),
            "taken_remaining_base": money(taken_remaining_base),
            "net_loan_position_base": money(given_remaining_base - taken_remaining_base),
        },
        "loans": rows,
    }


'''
    text = text.replace('@router.get("/loans/{family_id}")', insert + '@router.get("/loans/{family_id}")', 1)

p.write_text(text, encoding="utf-8")
print("LOAN CURRENCY REPORT ADDED")
