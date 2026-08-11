from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.timeutil import utc_now
from app.models.account import Account
from app.models.category import Category
from app.models.family_member import FamilyMember
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.transaction import (
    ExpenseCreateRequest,
    IncomeCreateRequest,
    TransferCreateRequest,
)
from app.services.audit_service import write_audit_log
from app.services.finance_posting import (
    find_by_client_request_id,
    post_expense_flush,
    post_income_flush,
    post_transfer_flush,
)
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/transactions", tags=["Transactions"])

MONEY_SCALE = Decimal("0.0001")


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text if text else None


def normalize_currency(value: str | None) -> str:
    currency = (value or "BDT").strip().upper()

    if len(currency) < 3 or len(currency) > 10:
        raise HTTPException(400, "Invalid currency")

    return currency


def validate_amount(value) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise HTTPException(400, "Invalid amount")

    if amount <= Decimal("0"):
        raise HTTPException(400, "Amount must be greater than zero")

    if amount > Decimal("999999999999.9999"):
        raise HTTPException(400, "Amount is too large")

    return amount


def get_account_or_404(db: Session, family_id: str, account_id: str) -> Account:
    account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )

    if not account:
        raise HTTPException(404, "Wallet not found")

    if not account.is_active:
        raise HTTPException(400, "Wallet inactive")

    return account


def get_category_or_404(
    db: Session,
    family_id: str,
    category_id: str,
    expected_type: str,
) -> Category:
    category = db.get(Category, category_id)

    if not category or category.family_id != family_id or category.deleted_at is not None:
        raise HTTPException(404, "Category not found")

    if not category.is_active:
        raise HTTPException(400, "Category inactive")

    if category.category_type != expected_type:
        raise HTTPException(400, f"Category must be {expected_type}")

    return category


def can_use_wallet(member: FamilyMember, account: Account) -> bool:
    role = normalize_role(getattr(member, "role", None))

    if role == "OWNER":
        return True

    if role in {"MEMBER", "SPOUSE"}:
        return (
            account.owner_member_id == member.id
            or account.is_shared_family is True
            or account.is_owner_wallet is True
        )

    return account.owner_member_id == member.id or account.is_shared_family is True


def require_wallet_access(member: FamilyMember, account: Account):
    if not can_use_wallet(member, account):
        raise HTTPException(403, "You do not have permission to use this wallet")


def require_same_currency(wallet_currency: str, payload_currency: str):
    if wallet_currency.upper() != payload_currency.upper():
        raise HTTPException(
            400,
            f"Currency mismatch. Wallet currency is {wallet_currency.upper()}",
        )


def find_duplicate_transfer(
    db: Session,
    family_id: str,
    member_id: str,
    from_account_id: str,
    to_account_id: str,
    amount: Decimal,
    currency: str,
    description: str | None,
):
    since = utc_now() - timedelta(seconds=10)

    recent_transfers = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.created_by_member_id == member_id,
            Transaction.transaction_type == "TRANSFER",
            Transaction.amount == amount,
            Transaction.currency == currency,
            Transaction.description == description,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
            Transaction.created_at >= since,
        )
        .order_by(Transaction.created_at.desc())
        .limit(5)
        .all()
    )

    for tx in recent_transfers:
        lines = (
            db.query(TransactionLine)
            .filter(TransactionLine.transaction_id == tx.id)
            .all()
        )

        account_ids = {line.account_id for line in lines if line.account_id}

        if from_account_id in account_ids and to_account_id in account_ids:
            return tx

    return None


@router.post("/income", status_code=status.HTTP_201_CREATED)
def create_income(
    payload: IncomeCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    amount = validate_amount(payload.amount)
    currency = normalize_currency(payload.currency)
    description = clean_text(payload.description)

    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="income.create",
    )

    if payload.client_request_id:
        existing = find_by_client_request_id(db, payload.family_id, payload.client_request_id)
        if existing:
            account = get_account_or_404(db, payload.family_id, payload.account_id)
            return {
                "id": existing.id,
                "family_id": existing.family_id,
                "account_id": account.id,
                "category_id": existing.category_id,
                "transaction_type": existing.transaction_type,
                "amount": money(existing.amount),
                "currency": existing.currency,
                "description": existing.description,
                "wallet_balance": money(account.current_balance),
                "status": existing.status,
                "idempotent_replay": True,
            }

    account = get_account_or_404(db, payload.family_id, payload.account_id)
    require_wallet_access(member, account)
    require_same_currency(account.currency, currency)

    category = get_category_or_404(
        db=db,
        family_id=payload.family_id,
        category_id=payload.category_id,
        expected_type="INCOME",
    )

    try:
        tx = post_income_flush(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            account_id=account.id,
            category_id=category.id,
            amount=amount,
            currency=currency,
            description=description,
            client_request_id=payload.client_request_id,
        )
        db.refresh(account)

        write_audit_log(
            db=db,
            family_id=payload.family_id,
            member_id=member.id,
            action_type="CREATE",
            entity_type="INCOME",
            entity_id=tx.id,
            title="Income Created",
            description=f"Income {money(amount)} {currency} added to {account.name}",
        )

        db.commit()
        db.refresh(tx)

        return {
            "id": tx.id,
            "family_id": tx.family_id,
            "account_id": account.id,
            "category_id": category.id,
            "transaction_type": tx.transaction_type,
            "amount": money(tx.amount),
            "currency": tx.currency,
            "description": tx.description,
            "wallet_balance": money(account.current_balance),
            "status": tx.status,
        }

    except Exception:
        db.rollback()
        raise


@router.post("/expense", status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    amount = validate_amount(payload.amount)
    currency = normalize_currency(payload.currency)
    description = clean_text(payload.description)

    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="expense.create",
    )

    if payload.client_request_id:
        existing = find_by_client_request_id(db, payload.family_id, payload.client_request_id)
        if existing:
            account = get_account_or_404(db, payload.family_id, payload.account_id)
            return {
                "id": existing.id,
                "family_id": existing.family_id,
                "account_id": account.id,
                "category_id": existing.category_id,
                "transaction_type": existing.transaction_type,
                "amount": money(existing.amount),
                "currency": existing.currency,
                "description": existing.description,
                "wallet_balance": money(account.current_balance),
                "status": existing.status,
                "idempotent_replay": True,
            }

    account = get_account_or_404(db, payload.family_id, payload.account_id)
    require_wallet_access(member, account)
    require_same_currency(account.currency, currency)

    current_balance = Decimal(account.current_balance or 0)

    if current_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient wallet balance. Available={money(current_balance)}, Requested={money(amount)}",
        )

    category = get_category_or_404(
        db=db,
        family_id=payload.family_id,
        category_id=payload.category_id,
        expected_type="EXPENSE",
    )

    try:
        tx = post_expense_flush(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            account_id=account.id,
            category_id=category.id,
            amount=amount,
            currency=currency,
            description=description,
            client_request_id=payload.client_request_id,
        )
        db.refresh(account)

        write_audit_log(
            db=db,
            family_id=payload.family_id,
            member_id=member.id,
            action_type="CREATE",
            entity_type="EXPENSE",
            entity_id=tx.id,
            title="Expense Created",
            description=f"Expense {money(amount)} {currency} paid from {account.name}",
        )

        db.commit()
        db.refresh(tx)

        return {
            "id": tx.id,
            "family_id": tx.family_id,
            "account_id": account.id,
            "category_id": category.id,
            "transaction_type": tx.transaction_type,
            "amount": money(tx.amount),
            "currency": tx.currency,
            "description": tx.description,
            "wallet_balance": money(account.current_balance),
            "status": tx.status,
        }

    except Exception:
        db.rollback()
        raise


@router.post("/transfer", status_code=status.HTTP_201_CREATED)
def create_transfer(
    payload: TransferCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    amount = validate_amount(payload.amount)
    currency = normalize_currency(payload.currency)
    description = clean_text(payload.description)

    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="transfer.create",
    )

    if payload.client_request_id:
        existing = find_by_client_request_id(db, payload.family_id, payload.client_request_id)
        if existing:
            return {
                "id": existing.id,
                "family_id": existing.family_id,
                "from_account_id": payload.from_account_id,
                "to_account_id": payload.to_account_id,
                "transaction_type": existing.transaction_type,
                "amount": money(existing.amount),
                "currency": existing.currency,
                "description": existing.description,
                "status": existing.status,
                "idempotent_replay": True,
            }

    if payload.from_account_id == payload.to_account_id:
        raise HTTPException(400, "Cannot transfer to the same wallet")

    from_account = get_account_or_404(
        db=db,
        family_id=payload.family_id,
        account_id=payload.from_account_id,
    )

    to_account = get_account_or_404(
        db=db,
        family_id=payload.family_id,
        account_id=payload.to_account_id,
    )

    require_wallet_access(member, from_account)
    require_wallet_access(member, to_account)

    require_same_currency(from_account.currency, currency)
    require_same_currency(to_account.currency, currency)

    from_balance = Decimal(from_account.current_balance or 0)

    if from_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient wallet balance. Available={money(from_balance)}, Requested={money(amount)}",
        )

    duplicate = find_duplicate_transfer(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        from_account_id=from_account.id,
        to_account_id=to_account.id,
        amount=amount,
        currency=currency,
        description=description,
    )

    if duplicate:
        raise HTTPException(
            409,
            "Duplicate transfer blocked. Please refresh before posting again.",
        )

    try:
        tx = post_transfer_flush(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            from_account_id=from_account.id,
            to_account_id=to_account.id,
            amount=amount,
            currency=currency,
            description=description,
            client_request_id=payload.client_request_id,
        )
        db.refresh(from_account)
        db.refresh(to_account)

        write_audit_log(
            db=db,
            family_id=payload.family_id,
            member_id=member.id,
            action_type="TRANSFER",
            entity_type="TRANSACTION",
            entity_id=tx.id,
            title="Wallet Transfer Posted",
            description=(
                f"Transferred {money(amount)} {currency} "
                f"from {from_account.name} to {to_account.name}"
            ),
        )

        db.commit()
        db.refresh(tx)

        return {
            "id": tx.id,
            "family_id": tx.family_id,
            "from_account_id": from_account.id,
            "to_account_id": to_account.id,
            "from_wallet": from_account.name,
            "to_wallet": to_account.name,
            "transaction_type": tx.transaction_type,
            "amount": money(tx.amount),
            "currency": tx.currency,
            "description": tx.description,
            "from_wallet_balance": money(from_account.current_balance),
            "to_wallet_balance": money(to_account.current_balance),
            "status": tx.status,
        }

    except Exception:
        db.rollback()
        raise


@router.get("/{family_id}")
def list_transactions(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="transaction.read",
    )

    from app.repositories import transaction_repo

    transactions = [
        tx
        for tx in transaction_repo(db).list_for_family(family_id, limit=200)
        if str(tx.status or "").upper() == "POSTED"
    ]

    return [
        {
            "id": tx.id,
            "family_id": tx.family_id,
            "category_id": tx.category_id,
            "loan_id": tx.loan_id,
            "goal_id": tx.goal_id,
            "transaction_type": tx.transaction_type,
            "amount": money(tx.amount),
            "currency": tx.currency,
            "description": tx.description,
            "status": tx.status,
            "created_at": tx.created_at,
        }
        for tx in transactions
    ]


@router.post("/{transaction_id}/void")
def void_transaction(
    transaction_id: str,
    family_id: str,
    reason: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.transaction_void_service import void_posted_transaction

    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="transaction.delete",
    )
    tx = (
        db.query(Transaction)
        .filter(
            Transaction.id == transaction_id,
            Transaction.family_id == family_id,
            Transaction.deleted_at.is_(None),
        )
        .first()
    )
    if not tx:
        raise HTTPException(404, "Transaction not found")
    try:
        result = void_posted_transaction(db, tx=tx, member_id=member.id, reason=reason)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.commit()
    return {"success": True, **result}
