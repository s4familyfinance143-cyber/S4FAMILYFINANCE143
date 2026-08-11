from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

insert_code = '''

@router.get("/general-ledger-currency/{family_id}")
def general_ledger_currency_report(
    family_id: str,
    account_id: str | None = Query(default=None),
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

    query = (
        db.query(TransactionLine, Transaction)
        .join(Transaction, TransactionLine.transaction_id == Transaction.id)
        .filter(
            Transaction.family_id == family_id,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
    )

    if account_id:
        query = query.filter(TransactionLine.account_id == account_id)

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(Transaction.created_at >= start_dt)

    if end_dt:
        query = query.filter(Transaction.created_at <= end_dt)

    rows_raw = query.order_by(Transaction.created_at.asc()).all()

    debit_total = Decimal("0")
    credit_total = Decimal("0")
    running_balance = Decimal("0")
    rows = []

    for line, tx in rows_raw:
        account = db.get(Account, line.account_id) if line.account_id else None

        debit = Decimal(line.debit or 0)
        credit = Decimal(line.credit or 0)
        rate = report_currency_rate(db, tx.currency, base_currency)

        debit_base = debit * rate
        credit_base = credit * rate

        debit_total += debit_base
        credit_total += credit_base
        running_balance += debit_base - credit_base

        rows.append({
            "line_id": line.id,
            "transaction_id": tx.id,
            "transaction_type": tx.transaction_type,
            "line_type": line.line_type,
            "account_id": line.account_id,
            "account_name": account.name if account else None,
            "account_type": account.account_type if account else None,
            "description": line.description or tx.description,
            "currency": tx.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "debit": money(debit),
            "credit": money(credit),
            "debit_base": money(debit_base),
            "credit_base": money(credit_base),
            "running_balance_base": money(running_balance),
            "created_at": tx.created_at,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "account_id": account_id,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
            "offset": offset,
        },
        "summary": {
            "line_count": len(rows),
            "debit_total_base": money(debit_total),
            "credit_total_base": money(credit_total),
            "difference_base": money(debit_total - credit_total),
            "ending_balance_base": money(running_balance),
            "is_balanced": debit_total == credit_total,
        },
        "ledger": rows[offset: offset + limit],
    }


'''

if '@router.get("/general-ledger-currency/{family_id}")' not in text:
    text = text + "\n\n" + insert_code

p.write_text(text, encoding="utf-8")
print("GENERAL LEDGER CURRENCY REPORT READY")
