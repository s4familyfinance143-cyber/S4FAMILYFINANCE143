from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/loans/{family_id}")
def loan_report(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    loans = (
        db.query(Loan)
        .filter(
            Loan.family_id == family_id,
        )
        .all()
    )

    total_loan_amount = Decimal("0")
    total_remaining_amount = Decimal("0")
    total_paid_amount = Decimal("0")

    rows = []

    for loan in loans:
        loan_amount = Decimal(loan.loan_amount or 0)
        remaining_amount = Decimal(loan.remaining_amount or 0)
        paid_amount = loan_amount - remaining_amount

        total_loan_amount += loan_amount
        total_remaining_amount += remaining_amount
        total_paid_amount += paid_amount

        progress = Decimal("0")

        if loan_amount > 0:
            progress = (paid_amount / loan_amount) * Decimal("100")

        rows.append(
            {
                "id": loan.id,
                "loan_name": getattr(loan, "loan_name", None),
                "loan_type": getattr(loan, "loan_type", None),
                "loan_amount": money(loan_amount),
                "paid_amount": money(paid_amount),
                "remaining_amount": money(remaining_amount),
                "progress_percent": str(round(progress, 2)),
                "currency": getattr(loan, "currency", "BDT"),
                "status": getattr(loan, "status", "ACTIVE"),
            }
        )

    return {
        "family_id": family_id,
        "summary": {
            "total_loans": len(rows),
            "total_loan_amount": money(total_loan_amount),
            "total_paid_amount": money(total_paid_amount),
            "total_remaining_amount": money(total_remaining_amount),
        },
        "loans": rows,
    }


'''

if '@router.get("/loans/{family_id}")' in text:
    print("LOAN REPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("LOAN REPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
