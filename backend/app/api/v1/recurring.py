from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.timeutil import utc_now
from app.models.account import Account
from app.models.category import Category
from app.models.family_member import FamilyMember
from app.models.recurring import RecurringTransaction
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.recurring import (
    RecurringCreateRequest,
    RecurringHistoryRequest,
    RecurringStatusRequest,
    RecurringUpdateRequest,
)
from app.services.audit_service import write_audit_log
from app.services.permission_service import normalize_role, require_permission

router = APIRouter(prefix="/recurring", tags=["Recurring Transactions"])


def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def can_use_wallet(member: FamilyMember, wallet: Account) -> bool:
    role = normalize_role(getattr(member, "role", None))

    if role == "OWNER":
        return True

    if role in {"MEMBER", "SPOUSE"}:
        return (
            wallet.owner_member_id == member.id
            or wallet.is_shared_family is True
            or wallet.is_owner_wallet is True
        )

    return wallet.owner_member_id == member.id or wallet.is_shared_family is True


def get_wallet(db: Session, family_id: str, wallet_id: str, member: FamilyMember):
    wallet = db.get(Account, wallet_id)

    if not wallet or wallet.family_id != family_id or wallet.deleted_at is not None:
        raise HTTPException(404, "Wallet not found")

    if not wallet.is_active:
        raise HTTPException(400, "Wallet inactive")

    if not can_use_wallet(member, wallet):
        raise HTTPException(403, "You do not have permission to use this wallet")

    return wallet


def get_category(db: Session, family_id: str, category_id: str | None, expected_type: str | None):
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


def get_recurring(db: Session, recurring_id: str):
    recurring = db.get(RecurringTransaction, recurring_id)

    if not recurring or recurring.deleted_at is not None:
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

        return date(year, month, min(current_due.day, 28))

    if frequency == "YEARLY":
        return date(current_due.year + 1, current_due.month, min(current_due.day, 28))

    raise HTTPException(400, "Invalid frequency")


def serialize_recurring(item: RecurringTransaction):
    return {
        "id": item.id,
        "family_id": item.family_id,
        "account_id": getattr(item, "account_id", None),
        "category_id": getattr(item, "category_id", None),
        "title": getattr(item, "title", None),
        "transaction_type": getattr(item, "transaction_type", None),
        "amount": money(getattr(item, "amount", 0)),
        "currency": getattr(item, "currency", "BDT"),
        "frequency": getattr(item, "frequency", None),
        "start_date": getattr(item, "start_date", None),
        "end_date": getattr(item, "end_date", None),
        "next_due_date": getattr(item, "next_due_date", None),
        "last_posted_at": getattr(item, "last_posted_at", None),
        "status": getattr(item, "status", None),
        "description": getattr(item, "description", None),
        "created_at": getattr(item, "created_at", None),
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

    wallet = get_wallet(db, payload.family_id, payload.account_id, member)

    transaction_type = payload.transaction_type.upper().strip()
    if transaction_type not in {"INCOME", "EXPENSE"}:
        raise HTTPException(400, "transaction_type must be INCOME or EXPENSE")

    category = get_category(db, payload.family_id, payload.category_id, transaction_type)

    frequency = payload.frequency.upper().strip()
    if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
        raise HTTPException(400, "Invalid frequency")

    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Title required")

    recurring = RecurringTransaction(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        account_id=wallet.id,
        category_id=category.id if category else None,
        title=title,
        transaction_type=transaction_type,
        amount=payload.amount,
        currency=payload.currency.upper(),
        frequency=frequency,
        start_date=payload.start_date,
        end_date=payload.end_date,
        next_due_date=payload.start_date,
        status="ACTIVE",
        description=clean_text(payload.description),
    )

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
        description=f"{recurring.title} recurring {transaction_type.lower()} created",
    )

    db.commit()
    db.refresh(recurring)

    return serialize_recurring(recurring)


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

    recurring = get_recurring(db, recurring_id)

    if recurring.family_id != payload.family_id:
        raise HTTPException(404, "Recurring transaction not found")

    if recurring.status not in {"ACTIVE", "PAUSED"}:
        raise HTTPException(400, "Only active or paused recurring can be edited")

    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Title required")

    frequency = payload.frequency.upper().strip()
    if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
        raise HTTPException(400, "Invalid frequency")

    recurring.title = title
    recurring.amount = payload.amount
    recurring.frequency = frequency
    recurring.end_date = payload.end_date
    recurring.description = clean_text(payload.description)

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Updated",
        description=f"{recurring.title} updated",
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

    recurring = get_recurring(db, recurring_id)

    if recurring.family_id != payload.family_id:
        raise HTTPException(404, "Recurring transaction not found")

    if recurring.status != "ACTIVE":
        raise HTTPException(400, "Only active recurring can be paused")

    recurring.status = "PAUSED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="PAUSE",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Paused",
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

    recurring = get_recurring(db, recurring_id)

    if recurring.family_id != payload.family_id:
        raise HTTPException(404, "Recurring transaction not found")

    if recurring.status != "PAUSED":
        raise HTTPException(400, "Only paused recurring can be resumed")

    recurring.status = "ACTIVE"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="RESUME",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Resumed",
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

    recurring = get_recurring(db, recurring_id)

    if recurring.family_id != payload.family_id:
        raise HTTPException(404, "Recurring transaction not found")

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
        title="Recurring Closed",
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

    recurring = get_recurring(db, recurring_id)

    if recurring.family_id != family_id:
        raise HTTPException(404, "Recurring transaction not found")

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

@router.post("/auto-post/{family_id}")
def auto_post_due_recurring(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="recurring.post",
    )

    today = date.today()

    due_items = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.family_id == family_id,
            RecurringTransaction.status == "ACTIVE",
            RecurringTransaction.next_due_date <= today,
            RecurringTransaction.deleted_at.is_(None),
        )
        .order_by(RecurringTransaction.next_due_date.asc())
        .all()
    )

    posted = []
    skipped = []

    for recurring in due_items:
        try:
            wallet = get_wallet(db, recurring.family_id, recurring.account_id, member)

            if recurring.transaction_type == "EXPENSE" and wallet.current_balance < recurring.amount:
                skipped.append(
                    {
                        "recurring_id": recurring.id,
                        "title": recurring.title,
                        "reason": "Insufficient wallet balance",
                    }
                )
                continue

            old_due = recurring.next_due_date

            from app.services import accounting_service

            if recurring.transaction_type == "INCOME":
                tx = accounting_service.post_income(
                    db,
                    family_id=recurring.family_id,
                    member_id=member.id,
                    account=wallet,
                    category_id=recurring.category_id,
                    amount=recurring.amount,
                    currency=recurring.currency,
                    description=recurring.description,
                    income_account_name="Salary Income",
                    commit=False,
                )
            else:
                tx = accounting_service.post_expense(
                    db,
                    family_id=recurring.family_id,
                    member_id=member.id,
                    account=wallet,
                    category_id=recurring.category_id,
                    amount=recurring.amount,
                    currency=recurring.currency,
                    description=recurring.description,
                    expense_account_name="General Expense",
                    commit=False,
                )

            recurring.next_due_date = next_due_date(
                recurring.next_due_date,
                recurring.frequency,
            )
            recurring.last_posted_at = utc_now()

            if recurring.end_date and recurring.next_due_date > recurring.end_date:
                recurring.status = "COMPLETED"

            write_audit_log(
                db=db,
                family_id=recurring.family_id,
                member_id=member.id,
                action_type="AUTO_POST",
                entity_type="RECURRING",
                entity_id=recurring.id,
                title="Recurring Auto Posted",
                description=(
                    f"{recurring.title} auto posted. "
                    f"Due moved from {old_due} to {recurring.next_due_date}"
                ),
            )

            posted.append(
                {
                    "recurring_id": recurring.id,
                    "title": recurring.title,
                    "transaction_id": tx.id,
                    "transaction_type": tx.transaction_type,
                    "amount": money(tx.amount),
                    "currency": tx.currency,
                    "old_due_date": old_due,
                    "next_due_date": recurring.next_due_date,
                    "status": recurring.status,
                    "wallet_balance": money(wallet.current_balance),
                }
            )

        except Exception as exc:
            skipped.append(
                {
                    "recurring_id": recurring.id,
                    "title": getattr(recurring, "title", "Unknown"),
                    "reason": str(exc),
                }
            )

    db.commit()

    return {
        "success": True,
        "family_id": family_id,
        "checked_due_date": today,
        "posted_count": len(posted),
        "skipped_count": len(skipped),
        "posted": posted,
        "skipped": skipped,
    }


@router.post("/{recurring_id}/post")
def post_recurring(
    recurring_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recurring = get_recurring(db, recurring_id)

    if recurring.status != "ACTIVE":
        raise HTTPException(400, "Recurring transaction is not active")

    member = require_permission(
        db=db,
        family_id=recurring.family_id,
        user_id=current_user.id,
        permission="recurring.post",
    )

    wallet = get_wallet(db, recurring.family_id, recurring.account_id, member)

    if recurring.transaction_type == "EXPENSE" and wallet.current_balance < recurring.amount:
        raise HTTPException(400, "Insufficient wallet balance")

    from app.services import accounting_service

    if recurring.transaction_type == "INCOME":
        tx = accounting_service.post_income(
            db,
            family_id=recurring.family_id,
            member_id=member.id,
            account=wallet,
            category_id=recurring.category_id,
            amount=recurring.amount,
            currency=recurring.currency,
            description=recurring.description,
            income_account_name="Salary Income",
            commit=False,
        )
    else:
        tx = accounting_service.post_expense(
            db,
            family_id=recurring.family_id,
            member_id=member.id,
            account=wallet,
            category_id=recurring.category_id,
            amount=recurring.amount,
            currency=recurring.currency,
            description=recurring.description,
            expense_account_name="General Expense",
            commit=False,
        )

    old_due = recurring.next_due_date
    recurring.next_due_date = next_due_date(recurring.next_due_date, recurring.frequency)
    recurring.last_posted_at = utc_now()

    if recurring.end_date and recurring.next_due_date > recurring.end_date:
        recurring.status = "COMPLETED"

    write_audit_log(
        db=db,
        family_id=recurring.family_id,
        member_id=member.id,
        action_type="POST",
        entity_type="RECURRING",
        entity_id=recurring.id,
        title="Recurring Transaction Posted",
        description=f"{recurring.title} posted. Due moved from {old_due} to {recurring.next_due_date}",
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