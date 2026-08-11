from pathlib import Path

p = Path("app/api/v1/reports.py")
text = p.read_text(encoding="utf-8")

needle = '@router.get("/cashflow/{family_id}")'

insert = r'''
def _transaction_register_export_rows(report: dict) -> list[dict]:
    rows = []

    for tx in report.get("transactions", []):
        wallet = tx.get("wallet") or {}
        transfer = tx.get("transfer") or {}

        from_wallet = ""
        to_wallet = ""

        if transfer:
            from_wallet = (transfer.get("from_wallet") or {}).get("name", "")
            to_wallet = (transfer.get("to_wallet") or {}).get("name", "")

        rows.append(
            {
                "Date": tx.get("created_at"),
                "Transaction ID": tx.get("transaction_id"),
                "Transaction Number": tx.get("transaction_number") or "",
                "Type": tx.get("transaction_type"),
                "Amount": tx.get("amount"),
                "Currency": tx.get("currency"),
                "Status": tx.get("status"),
                "Wallet": wallet.get("name", ""),
                "From Wallet": from_wallet,
                "To Wallet": to_wallet,
                "Goal ID": tx.get("goal_id") or "",
                "Loan ID": tx.get("loan_id") or "",
                "Budget ID": tx.get("budget_id") or "",
                "Description": tx.get("description") or "",
            }
        )

    return rows


@router.get("/transaction-register/{family_id}/export/excel")
def export_transaction_register_excel(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = transaction_register_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=transaction_type,
        status=status,
        db=db,
        current_user=current_user,
    )

    return _excel_response(
        filename="s4_transaction_register",
        sheet_name="Transaction Register",
        rows=_transaction_register_export_rows(report),
    )


@router.get("/transaction-register/{family_id}/export/pdf")
def export_transaction_register_pdf(
    family_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = transaction_register_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=transaction_type,
        status=status,
        db=db,
        current_user=current_user,
    )

    return _pdf_response(
        filename="s4_transaction_register",
        title="S4 Transaction Register Report",
        rows=_transaction_register_export_rows(report),
    )


'''

if '@router.get("/transaction-register/{family_id}/export/excel")' in text:
    print("TRANSACTION REGISTER EXPORT ALREADY EXISTS")
elif needle in text:
    text = text.replace(needle, insert + needle, 1)
    p.write_text(text, encoding="utf-8")
    print("TRANSACTION REGISTER EXPORT INSERTED OK")
else:
    raise SystemExit("ERROR: cashflow marker not found")
