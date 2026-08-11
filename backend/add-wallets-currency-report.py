from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

code = '''

@router.get("/wallets-currency/{family_id}")
def wallets_currency_report(
    family_id: str,
    wallet_id: str | None = Query(default=None),
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

    wallet_query = (
        db.query(Account)
        .filter(
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
    )

    if wallet_id:
        wallet_query = wallet_query.filter(Account.id == wallet_id)

    wallets = wallet_query.all()

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    rows = []

    total_original_balance = Decimal("0")
    total_base_balance = Decimal("0")

    for wallet in wallets:
        rate = report_currency_rate(
            db,
            wallet.currency,
            base_currency,
        )

        current_balance = Decimal(wallet.current_balance or 0)
        converted_balance = current_balance * rate

        total_original_balance += current_balance
        total_base_balance += converted_balance

        line_query = (
            db.query(TransactionLine, Transaction)
            .join(Transaction, TransactionLine.transaction_id == Transaction.id)
            .filter(
                Transaction.family_id == family_id,
                Transaction.status == "POSTED",
                Transaction.deleted_at.is_(None),
                TransactionLine.account_id == wallet.id,
            )
        )

        if start_dt:
            line_query = line_query.filter(Transaction.created_at >= start_dt)

        if end_dt:
            line_query = line_query.filter(Transaction.created_at <= end_dt)

        lines = (
            line_query
            .order_by(Transaction.created_at.asc())
            .all()
        )

        debit_total = Decimal("0")
        credit_total = Decimal("0")
        running_balance = Decimal("0")
        statement_lines = []

        for line, tx in lines:
            tx_rate = report_currency_rate(
                db,
                tx.currency,
                base_currency,
            )

            debit = Decimal(line.debit or 0)
            credit = Decimal(line.credit or 0)

            debit_base = debit * tx_rate
            credit_base = credit * tx_rate

            debit_total += debit_base
            credit_total += credit_base
            running_balance += debit_base - credit_base

            statement_lines.append({
                "transaction_id": tx.id,
                "transaction_type": tx.transaction_type,
                "line_type": line.line_type,
                "description": line.description or tx.description,
                "currency": tx.currency,
                "base_currency": base_currency,
                "rate": money(tx_rate),
                "debit": money(debit),
                "credit": money(credit),
                "debit_base": money(debit_base),
                "credit_base": money(credit_base),
                "running_balance_base": money(running_balance),
                "created_at": tx.created_at,
            })

        rows.append({
            "wallet_id": wallet.id,
            "wallet_name": wallet.name,
            "account_type": wallet.account_type,
            "currency": wallet.currency,
            "base_currency": base_currency,
            "rate": money(rate),
            "current_balance": money(current_balance),
            "current_balance_base": money(converted_balance),
            "debit_total_base": money(debit_total),
            "credit_total_base": money(credit_total),
            "movement_balance_base": money(debit_total - credit_total),
            "line_count": len(statement_lines),
            "statement": statement_lines,
        })

    return {
        "family_id": family_id,
        "base_currency": base_currency,
        "filters": {
            "wallet_id": wallet_id,
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "wallet_count": len(rows),
            "total_original_balance": money(total_original_balance),
            "total_base_balance": money(total_base_balance),
        },
        "wallets": rows,
    }

'''

if '@router.get("/wallets-currency/{family_id}")' not in text:
    text += "\\n\\n" + code

p.write_text(text, encoding="utf-8")

print("WALLETS CURRENCY REPORT ADDED")
