from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.account import Account
from app.models.category import Category
from app.models.family_member import FamilyMember
from app.models.recurring import RecurringTransaction
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.recurring import (
    RecurringCreateRequest,
    RecurringStatusRequest,
    RecurringUpdateRequest,
)
from app.services.audit_service import write_audit_log
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/recurring", tags=["Recurring Transactions"])


def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def safe_attr(obj, name, default=None):
    return getattr(obj, name, default)


def clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def get_payload_account_id(payload):
    for field in ("account_id", "wallet_account_id", "from_account_id"):
        value = getattr(payload, field, None)
        if value:
            return value
    raise HTTPException(422, "Wallet account id is required")


def can_use_wallet(member: FamilyMember, wallet: Account) -> bool:
    role = normalize_role(getattr(member, "role", None))

    if role == "OWNER":
        return True

    if role == "SPOUSE":
        return (
            wallet.owner_member_id == member.id
            or wallet.is_shared_family is True
            or wallet.is_owner_wallet is True
        )

    return wallet.owner_member_id == member.id or wallet.is_shared_family is True


def get_wallet(db: Session, family_id: str, wallet_id: str, member: FamilyMember) -> Account:
    wallet = (
        db.query(Account)
        .filter(
            Account.id == wallet_id,
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )

    if not wallet:
        raise HTTPException(404, "Wallet not found")

    if not wallet.is_active:
        raise HTTPException(400, "Wallet inactive")

    if not can_use_wallet(member, wallet):
        raise HTTPException(403, "You do not have permission to use this wallet")

    return wallet


def get_category(
    db: Session,
    family_id: str,
    category_id: str | None,
    expected_type: str | None,
):
    if not category_id:
        return None

    category = db.get(Category, category_id)

    if not category or category.family_id != family_id or category.deleted_at is not None:
        raise HTTPException(404, "Category not found")

    if not category.is_active:
        raise HTTPException(400, "Category inactive")

    if expected_type and category.category_type != expected_type:
        raise HTTPException(400, f"Category must be {expected_type}")

    return category


def get_recurring(db: Session, recurring_id: str, family_id: str | None = None, lock: bool = False):
    query = db.query(RecurringTransaction).filter(
        RecurringTransaction.id == recurring_id,
        RecurringTransaction.deleted_at.is_(None),
    )

    if family_id:
        query = query.filter(RecurringTransaction.family_id == family_id)

    if lock:
        query = query.with_for_update()

    recurring = query.first()

    if not recurring:
        raise HTTPException(404, "Recurring transaction not found")

    return recurring


def next_due_date(current_due: date, frequency: str) -> date:
    frequency = frequency.upper()

    if frequency == "DAILY":
        return date.fromordinal(current_due.toordinal() + 1)

    if frequency == "WEEKLY":
        return date.fromordinal(current_due.toordinal() + 7)

    if frequency == "MONTHLY":
        month = current_due.month + 1
        year = current_due.year

        if month > 12:
            month = 1
            year += 1

        day = min(current_due.day, 28)
        return date(year, month, day)

    if frequency == "YEARLY":
        return date(current_due.year + 1, current_due.month, min(current_due.day, 28))

    raise HTTPException(400, "Invalid frequency")


def normalize_frequency(value: str) -> str:
    frequency = (value or "").upper().strip()
    if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
        raise HTTPException(400, "Invalid frequency")
    return frequency


def normalize_transaction_type(value: str) -> str:
    transaction_type = (value or "").upper().strip()
    if transaction_type not in {"INCOME", "EXPENSE"}:
        raise HTTPException(400, "transaction_type must be INCOME or EXPENSE")
    return transaction_type


def serialize_recurring(item: RecurringTransaction):
    return {
        "id": item.id,
        "family_id": item.family_id,
        "account_id": safe_attr(item, "account_id", None),
        "category_id": safe_attr(item, "category_id", None),
        "title": safe_attr(item, "title", None),
        "transaction_type": safe_attr(item, "transaction_type", None),
        "amount": money(safe_attr(item, "amount", 0)),
        "currency": safe_attr(item, "currency", "BDT"),
        "frequency": safe_attr(item, "frequency", None),
        "start_date": safe_attr(item, "start_date", None),
        "end_date": safe_attr(item, "end_date", None),
        "next_due_date": safe_attr(item, "next_due_date", None),
        "last_posted_at": safe_attr(item, "last_posted_at", None),
        "status": safe_attr(item, "status", None),
        "description": safe_attr(item, "description", None),
        "created_at": safe_attr(item, "created_at", None),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_recurring(
    payload: RecurringCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="recurring.create",
    )

    account_id = get_payload_account_id(payload)
    wallet = get_wallet(db, payload.family_id, account_id, member)

    transaction_type = normalize_transaction_type(payload.transaction_type)

    category = get_category(
        db=db,
        family_id=payload.family_id,
        category_id=payload.category_id,
        expected_type=transaction_type,
    )

    frequency = normalize_frequency(payload.frequency)

    if wallet.currency.upper() != payload.currency.upper():
        raise HTTPException(400, f"Currency mismatch. Wallet currency is {wallet.currency}")

    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Title required")

    if payload.end_date and payload.end_date < payload.start_date:
        raise HTTPException(400, "End date cannot be before start date")

    recurring_data = {
        "family_id": payload.family_id,
        "created_by_member_id": member.id,
        "account_id": wallet.id,
        "category_id": category.id if category else None,
        "title": title,
        "transaction_type": transaction_type,
        "amount": payload.amount,
        "currency": payload.currency.upper(),
        "frequency": frequency,
        "start_date": payload.start_date,
        "next_due_date": payload.start_date,
        "status": "ACTIVE",
        "description": clean_text(payload.description),
    }

    if hasattr(RecurringTransaction, "end_date"):
        recurring_data["end_date"] = payload.end_date

    recurring = RecurringTransaction(**recurring_data)

    db.add(recurring)
    db.flush()

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Created",
        description=(
            f"{recurring.title} recurring {transaction_type.lower()} "
            f"created for {recurring.amount} {recurring.currency} on {wallet.name}"
        ),
    )

    db.commit()
    db.refresh(recurring)

    return serialize_recurring(recurring)


@router.patch("/{recurring_id}")
def update_recurring(
    recurring_id: str,
    payload: RecurringUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="recurring.create",
    )

    recurring = get_recurring(db, recurring_id, payload.family_id, lock=True)

    if recurring.status not in {"ACTIVE", "PAUSED"}:
        raise HTTPException(400, "Only active or paused recurring transaction can be edited")

    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Title required")

    frequency = normalize_frequency(payload.frequency)

    start_date_value = safe_attr(recurring, "start_date", None)
    if payload.end_date and start_date_value and payload.end_date < start_date_value:
        raise HTTPException(400, "End date cannot be before start date")

    recurring.title = title
    recurring.amount = payload.amount
    recurring.frequency = frequency
    recurring.description = clean_text(payload.description)

    if hasattr(recurring, "end_date"):
        recurring.end_date = payload.end_date

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Updated",
        description=f"{recurring.title} recurring transaction updated",
    )

    db.commit()
    db.refresh(recurring)

    return serialize_recurring(recurring)


@router.post("/{recurring_id}/pause")
def pause_recurring(
    recurring_id: str,
    payload: RecurringStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="recurring.create",
    )

    recurring = get_recurring(db, recurring_id, payload.family_id, lock=True)

    if recurring.status != "ACTIVE":
        raise HTTPException(400, "Only active recurring transaction can be paused")

    recurring.status = "PAUSED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="PAUSE",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Paused",
        description=f"{recurring.title} paused",
    )

    db.commit()
    db.refresh(recurring)

    return serialize_recurring(recurring)


@router.post("/{recurring_id}/resume")
def resume_recurring(
    recurring_id: str,
    payload: RecurringStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="recurring.create",
    )

    recurring = get_recurring(db, recurring_id, payload.family_id, lock=True)

    if recurring.status != "PAUSED":
        raise HTTPException(400, "Only paused recurring transaction can be resumed")

    recurring.status = "ACTIVE"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="RESUME",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Resumed",
        description=f"{recurring.title} resumed",
    )

    db.commit()
    db.refresh(recurring)

    return serialize_recurring(recurring)


@router.post("/{recurring_id}/close")
def close_recurring(
    recurring_id: str,
    payload: RecurringStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="recurring.create",
    )

    recurring = get_recurring(db, recurring_id, payload.family_id, lock=True)

    if recurring.status == "CLOSED":
        raise HTTPException(400, "Recurring transaction already closed")

    recurring.status = "CLOSED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Closed",
        description=f"{recurring.title} closed",
    )

    db.commit()
    db.refresh(recurring)

    return serialize_recurring(recurring)


@router.get("/{recurring_id}/history/{family_id}")
def recurring_history(
    recurring_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="recurring.read",
    )

    recurring = get_recurring(db, recurring_id, family_id, lock=False)

    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.transaction_type == recurring.transaction_type,
            Transaction.amount == recurring.amount,
            Transaction.currency == recurring.currency,
            Transaction.description == recurring.description,
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.created_at.desc())
        .all()
    )

    return {
        "recurring": serialize_recurring(recurring),
        "history": [
            {
                "id": tx.id,
                "transaction_type": tx.transaction_type,
                "amount": money(tx.amount),
                "currency": tx.currency,
                "description": tx.description,
                "created_at": tx.created_at,
                "status": tx.status,
            }
            for tx in transactions
        ],
    }


@router.get("/{family_id}")
def list_recurring(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="recurring.read",
    )

    items = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.family_id == family_id,
            RecurringTransaction.deleted_at.is_(None),
        )
        .order_by(RecurringTransaction.created_at.desc())
        .all()
    )

    return [serialize_recurring(item) for item in items]


@router.post("/{recurring_id}/post")
def post_recurring(
    recurring_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recurring = get_recurring(db, recurring_id, lock=True)

    if recurring.status != "ACTIVE":
        raise HTTPException(400, "Recurring transaction is not active")

    member = require_permission(
        db=db,
        family_id=recurring.family_id,
        user_id=current_user.id,
        permission="recurring.post",
    )

    wallet = get_wallet(db, recurring.family_id, recurring.account_id, member)

    amount = Decimal(recurring.amount or 0)
    wallet_balance = Decimal(wallet.current_balance or 0)

    if recurring.transaction_type == "EXPENSE" and wallet_balance < amount:
        raise HTTPException(
            400,
            f"Insufficient wallet balance. Available={money(wallet_balance)}, Requested={money(amount)}",
        )

    tx = Transaction(
        family_id=recurring.family_id,
        created_by_member_id=member.id,
        category_id=recurring.category_id,
        loan_id=None,
        goal_id=None,
        transaction_type=recurring.transaction_type,
        amount=amount,
        currency=recurring.currency,
        description=recurring.description,
        status="POSTED",
    )

    db.add(tx)
    db.flush()

    if recurring.transaction_type == "INCOME":
        wallet.current_balance = wallet_balance + amount

        db.add(
            TransactionLine(
                transaction_id=tx.id,
                account_id=wallet.id,
                line_type="ASSET",
                debit=amount,
                credit=Decimal("0"),
                description="Debit wallet recurring income",
            )
        )

        db.add(
            TransactionLine(
                transaction_id=tx.id,
                account_id=None,
                line_type="INCOME",
                debit=Decimal("0"),
                credit=amount,
                description="Credit recurring income",
            )
        )

    else:
        wallet.current_balance = wallet_balance - amount

        db.add(
            TransactionLine(
                transaction_id=tx.id,
                account_id=None,
                line_type="EXPENSE",
                debit=amount,
                credit=Decimal("0"),
                description="Debit recurring expense",
            )
        )

        db.add(
            TransactionLine(
                transaction_id=tx.id,
                account_id=wallet.id,
                line_type="ASSET",
                debit=Decimal("0"),
                credit=amount,
                description="Credit wallet recurring expense",
            )
        )

    old_due = recurring.next_due_date
    recurring.next_due_date = next_due_date(recurring.next_due_date, recurring.frequency)

    if hasattr(recurring, "last_posted_at"):
        recurring.last_posted_at = datetime.utcnow()

    if hasattr(recurring, "end_date"):
        end_date = getattr(recurring, "end_date", None)
        if end_date and recurring.next_due_date > end_date:
            recurring.status = "COMPLETED"

    write_audit_log(
        db=db,
        family_id=recurring.family_id,
        member_id=member.id,
        action_type="POST",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Posted",
        description=(
            f"{recurring.title} posted as {recurring.transaction_type.lower()} "
            f"transaction {tx.id}. Due moved from {old_due} to {recurring.next_due_date}"
        ),
    )

    db.commit()
    db.refresh(recurring)

    return {
        "success": True,
        "recurring_id": recurring.id,
        "transaction_id": tx.id,
        "transaction_type": tx.transaction_type,
        "amount": money(tx.amount),
        "currency": tx.currency,
        "wallet_balance": money(wallet.current_balance),
        "next_due_date": recurring.next_due_date,
        "status": recurring.status,
    }
