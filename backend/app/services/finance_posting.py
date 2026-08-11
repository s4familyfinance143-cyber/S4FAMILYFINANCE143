"""Post income/expense/transfer without committing (for sync outbox apply).

All money posts go through the Double-Entry accounting_service engine.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.category import Category
from app.models.transaction import Transaction
from app.services import accounting_service

MONEY_SCALE = Decimal("0.0001")


def _money(value) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(400, "Invalid amount") from exc
    if amount <= Decimal("0"):
        raise HTTPException(400, "Amount must be greater than zero")
    return amount


def _ensure_client_request_id_column(db: Session) -> None:
    """Best-effort add column if migration not yet applied."""
    try:
        dialect = db.bind.dialect.name if db.bind is not None else ""
        if dialect == "sqlite":
            cols = {
                row[1]
                for row in db.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(transactions)")
                ).fetchall()
            }
            if "client_request_id" not in cols:
                db.execute(
                    __import__("sqlalchemy").text(
                        "ALTER TABLE transactions ADD COLUMN client_request_id VARCHAR(120)"
                    )
                )
        else:
            db.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(120)"
                )
            )
    except Exception:
        pass


def find_by_client_request_id(
    db: Session,
    family_id: str,
    client_request_id: str,
) -> Optional[Transaction]:
    if not client_request_id:
        return None
    _ensure_client_request_id_column(db)
    try:
        return (
            db.query(Transaction)
            .filter(
                Transaction.family_id == family_id,
                Transaction.client_request_id == client_request_id,
            )
            .first()
        )
    except Exception:
        return None


def get_account(db: Session, family_id: str, account_id: str) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.family_id == family_id, Account.deleted_at.is_(None))
        .with_for_update()
        .first()
    )
    if not account:
        raise HTTPException(404, "Wallet not found")
    if not account.is_active:
        raise HTTPException(400, "Wallet inactive")
    return account


def get_category(db: Session, family_id: str, category_id: str, expected_type: str) -> Category:
    category = db.get(Category, category_id)
    if not category or category.family_id != family_id or category.deleted_at is not None:
        raise HTTPException(404, "Category not found")
    if category.category_type != expected_type:
        raise HTTPException(400, f"Category must be {expected_type}")
    return category


def _income_account_name(category: Category) -> str:
    name = (getattr(category, "name_en", None) or getattr(category, "name_bn", None) or "").strip()
    lowered = name.lower()
    if "salary" in lowered or "বেতন" in name:
        return "Salary Income"
    if name:
        return f"{name} Income" if not name.lower().endswith("income") else name
    return "Salary Income"


def _expense_account_name(category: Category) -> str:
    name = (getattr(category, "name_en", None) or getattr(category, "name_bn", None) or "").strip()
    lowered = name.lower()
    if "grocery" in lowered or "bazaar" in lowered or "বাজার" in name or "food" in lowered:
        return "Grocery Expense"
    if name:
        return f"{name} Expense" if not name.lower().endswith("expense") else name
    return "General Expense"


def post_income_flush(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    account_id: str,
    category_id: str,
    amount: Any,
    currency: str = "BDT",
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    if client_request_id:
        existing = find_by_client_request_id(db, family_id, client_request_id)
        if existing:
            return existing

    category = get_category(db, family_id, category_id, "INCOME")
    return accounting_service.post_income(
        db,
        family_id=family_id,
        member_id=member_id,
        account_id=account_id,
        category_id=category.id,
        amount=amount,
        currency=currency,
        description=description,
        income_account_name=_income_account_name(category),
        client_request_id=client_request_id,
        commit=False,
    )


def post_expense_flush(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    account_id: str,
    category_id: str,
    amount: Any,
    currency: str = "BDT",
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    if client_request_id:
        existing = find_by_client_request_id(db, family_id, client_request_id)
        if existing:
            return existing

    category = get_category(db, family_id, category_id, "EXPENSE")
    return accounting_service.post_expense(
        db,
        family_id=family_id,
        member_id=member_id,
        account_id=account_id,
        category_id=category.id,
        amount=amount,
        currency=currency,
        description=description,
        expense_account_name=_expense_account_name(category),
        client_request_id=client_request_id,
        commit=False,
    )


def post_transfer_flush(
    db: Session,
    *,
    family_id: str,
    member_id: str,
    from_account_id: str,
    to_account_id: str,
    amount: Any,
    currency: str = "BDT",
    description: str | None = None,
    client_request_id: str | None = None,
) -> Transaction:
    if client_request_id:
        existing = find_by_client_request_id(db, family_id, client_request_id)
        if existing:
            return existing

    return accounting_service.post_transfer(
        db,
        family_id=family_id,
        member_id=member_id,
        from_account_id=from_account_id,
        to_account_id=to_account_id,
        amount=amount,
        currency=currency,
        description=description,
        client_request_id=client_request_id,
        commit=False,
    )
