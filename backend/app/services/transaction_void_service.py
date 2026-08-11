"""Void / rollback posted transactions via Double-Entry reversing journals."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.services import accounting_service
from app.services.audit_service import write_audit_log
from app.services.chart_of_accounts import NORMAL_DEBIT_CLASSES, ledger_class


def reverse_account_balances_from_lines(db: Session, lines: list[TransactionLine]) -> int:
    """Reverse wallet impact for each line. Returns count of accounts touched."""
    reversed_count = 0
    for line in lines:
        if not line.account_id:
            continue
        account = (
            db.query(Account)
            .filter(Account.id == line.account_id, Account.deleted_at.is_(None))
            .first()
        )
        if not account:
            continue
        debit = Decimal(line.debit or 0)
        credit = Decimal(line.credit or 0)
        cls = ledger_class(account.account_type)
        bal = Decimal(account.current_balance or 0)
        if cls in NORMAL_DEBIT_CLASSES:
            account.current_balance = bal - debit + credit
        else:
            account.current_balance = bal - credit + debit
        reversed_count += 1
    return reversed_count


def void_posted_transaction(
    db: Session,
    *,
    tx: Transaction,
    member_id: str,
    reason: str | None = None,
) -> dict:
    if str(tx.status or "").upper() == "VOID":
        raise ValueError("Transaction already void")

    lines = (
        db.query(TransactionLine)
        .filter(
            TransactionLine.transaction_id == tx.id,
            TransactionLine.deleted_at.is_(None),
        )
        .all()
    )

    can_journal_rollback = (
        len(lines) >= 2 and all(line.account_id for line in lines)
    )

    if can_journal_rollback:
        result = accounting_service.rollback_transaction(
            db,
            transaction_id=tx.id,
            member_id=member_id,
            reason=reason,
        )
        write_audit_log(
            db,
            family_id=tx.family_id,
            member_id=member_id,
            action_type="TRANSACTION_VOID",
            entity_type="TRANSACTION",
            entity_id=tx.id,
            title="Financial transaction rolled back",
            description=reason or tx.description,
            severity="WARN",
        )
        return {
            "id": tx.id,
            "status": "VOID",
            "rollback_id": result.get("rollback_id"),
            "lines_reversed": True,
        }

    reversed_count = reverse_account_balances_from_lines(db, lines)
    tx.status = "VOID"
    tx.deleted_at = datetime.now(timezone.utc)
    write_audit_log(
        db,
        family_id=tx.family_id,
        member_id=member_id,
        action_type="TRANSACTION_VOID",
        entity_type="TRANSACTION",
        entity_id=tx.id,
        title="Financial transaction voided",
        description=reason or tx.description,
        severity="WARN",
    )
    return {
        "id": tx.id,
        "status": "VOID",
        "lines_reversed": reversed_count,
    }
