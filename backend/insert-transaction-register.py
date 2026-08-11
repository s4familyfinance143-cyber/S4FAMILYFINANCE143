from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
@router.get("/transaction-register/{family_id}")
def transaction_register_report(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_report_access(db, family_id, current_user.id)

    query = db.query(Transaction).filter(
        Transaction.family_id == family_id,
        Transaction.deleted_at.is_(None),
    )

    start_dt = parse_date_start(start_date)
    end_dt = parse_date_end(end_date)

    if start_dt:
        query = query.filter(Transaction.created_at >= start_dt)

    if end_dt:
        query = query.filter(Transaction.created_at <= end_dt)

    if transaction_type:
        query = query.filter(
            Transaction.transaction_type == transaction_type
        )

    if status:
        query = query.filter(
            Transaction.status == status
        )

    transactions = (
        query.order_by(Transaction.created_at.desc())
        .all()
    )

    total_amount = Decimal("0")

    rows = []

    for tx in transactions:

        amount = Decimal(tx.amount or 0)
        total_amount += amount

        wallet_info = transaction_wallet_info(db, tx)

        rows.append(
            {
                "transaction_id": tx.id,
                "transaction_number": getattr(
                    tx,
                    "transaction_number",
                    None
                ),
                "transaction_type": tx.transaction_type,
                "amount": money(amount),
                "currency": tx.currency,
                "status": tx.status,
                "description": tx.description,
                "wallet": wallet_info["wallet"],
                "transfer": wallet_info["transfer"],
                "goal_id": getattr(tx, "goal_id", None),
                "loan_id": getattr(tx, "loan_id", None),
                "budget_id": getattr(tx, "budget_id", None),
                "created_at": tx.created_at,
            }
        )

    return {
        "family_id": family_id,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
            "transaction_type": transaction_type,
            "status": status,
        },
        "summary": {
            "transaction_count": len(rows),
            "total_amount": money(total_amount),
        },
        "transactions": rows,
    }


'''

if '@router.get("/transaction-register/{family_id}")' in text:
    print("TRANSACTION REGISTER ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("TRANSACTION REGISTER INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
