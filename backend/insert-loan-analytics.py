from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/loan-analytics/{family_id}")
def loan_analytics_report(
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

    given_total = Decimal("0")
    taken_total = Decimal("0")

    given_remaining = Decimal("0")
    taken_remaining = Decimal("0")

    active_count = 0
    closed_count = 0

    rows = []

    for loan in loans:

        principal = Decimal(loan.principal_amount or 0)
        paid = Decimal(loan.paid_amount or 0)
        remaining = Decimal(loan.remaining_amount or 0)

        if loan.loan_type == "GIVEN":
            given_total += principal
            given_remaining += remaining
        else:
            taken_total += principal
            taken_remaining += remaining

        if loan.status == "ACTIVE":
            active_count += 1
        else:
            closed_count += 1

        recovery_rate = Decimal("0")

        if principal > 0:
            recovery_rate = (paid / principal) * Decimal("100")

        rows.append(
            {
                "loan_id": loan.id,
                "person_name": loan.person_name,
                "loan_type": loan.loan_type,
                "principal_amount": money(principal),
                "paid_amount": money(paid),
                "remaining_amount": money(remaining),
                "recovery_rate": str(round(recovery_rate, 2)),
                "status": loan.status,
            }
        )

    overall_recovery = Decimal("0")

    total_principal = given_total + taken_total
    total_paid = total_principal - (given_remaining + taken_remaining)

    if total_principal > 0:
        overall_recovery = (total_paid / total_principal) * Decimal("100")

    return {
        "family_id": family_id,
        "summary": {
            "total_loans": len(loans),
            "active_loans": active_count,
            "closed_loans": closed_count,
            "given_total": money(given_total),
            "taken_total": money(taken_total),
            "given_remaining": money(given_remaining),
            "taken_remaining": money(taken_remaining),
            "overall_recovery_rate": str(round(overall_recovery, 2)),
        },
        "loans": sorted(
            rows,
            key=lambda x: float(x["recovery_rate"]),
            reverse=True,
        ),
    }


'''

if '@router.get("/loan-analytics/{family_id}")' in text:
    print("LOAN ANALYTICS ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("LOAN ANALYTICS INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
