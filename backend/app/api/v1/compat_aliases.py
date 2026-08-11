"""PC-compat aliases: `/investments`, `/subscriptions` etc. kept at legacy URL paths but backed by
the dedicated Investment/Subscription models (architecture_modules_api), NOT phase15/16.
"""

from fastapi import APIRouter, Depends
from decimal import Decimal
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.architecture_modules import Investment, Subscription
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import ExpenseCreateRequest, IncomeCreateRequest
from app.api.v1.transactions import create_expense, create_income, money
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission

router = APIRouter(tags=["Architecture Compatibility Aliases"])


class InvestmentAliasCreateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = "BDT"
    target_date: str | None = None
    note: str | None = None


class SubscriptionAliasCreateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = "BDT"
    renewal_or_expiry_date: str | None = None
    reference: str | None = None
    note: str | None = None


def _investment_alias_response(row: Investment) -> dict:
    """Phase15Item-shaped response so PC clients keep working unmodified."""
    return {
        "id": row.id,
        "family_id": row.family_id,
        "module_type": "INVESTMENT",
        "name": row.name,
        "category": "GENERAL",
        "sub_type": row.type,
        "provider": None,
        "member_id": row.member_id,
        "amount": money(row.principal),
        "secondary_amount": money(row.rate) if row.rate is not None else None,
        "currency": row.currency,
        "target_date": row.maturity,
        "secondary_date": row.start_date,
        "status": row.status,
        "note": row.note,
        "created_at": row.created_at,
    }


def _subscription_alias_response(row: Subscription) -> dict:
    """Phase16Item-shaped response so PC clients keep working unmodified."""
    return {
        "id": row.id,
        "family_id": row.family_id,
        "module_type": "SUBSCRIPTION",
        "name": row.name,
        "category": "GENERAL",
        "sub_type": None,
        "provider": None,
        "member_id": None,
        "amount": money(row.amount),
        "secondary_amount": None,
        "currency": row.currency,
        "renewal_or_expiry_date": row.next_due,
        "target_date": row.next_due,
        "secondary_date": None,
        "billing_cycle": row.cycle,
        "payment_account_id": row.payment_account_id,
        "reference": None,
        "status": row.status,
        "note": row.notes,
        "created_at": row.created_at,
    }


@router.post("/income")
def create_income_alias(payload: IncomeCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return create_income(payload=payload, db=db, current_user=current_user)


@router.get("/income/{family_id}")
def list_income_alias(family_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db=db, family_id=family_id, user_id=current_user.id, permission="transaction.read")
    rows = (
        db.query(Transaction)
        .filter(Transaction.family_id == family_id, Transaction.transaction_type == "INCOME", Transaction.status == "POSTED", Transaction.deleted_at.is_(None))
        .order_by(Transaction.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "family_id": row.family_id,
            "category_id": row.category_id,
            "amount": money(row.amount),
            "currency": row.currency,
            "description": row.description,
            "status": row.status,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/expenses")
def create_expense_alias(payload: ExpenseCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return create_expense(payload=payload, db=db, current_user=current_user)


@router.get("/expenses/{family_id}")
def list_expense_alias(family_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db=db, family_id=family_id, user_id=current_user.id, permission="transaction.read")
    rows = (
        db.query(Transaction)
        .filter(Transaction.family_id == family_id, Transaction.transaction_type == "EXPENSE", Transaction.status == "POSTED", Transaction.deleted_at.is_(None))
        .order_by(Transaction.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "family_id": row.family_id,
            "category_id": row.category_id,
            "amount": money(row.amount),
            "currency": row.currency,
            "description": row.description,
            "status": row.status,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/investments")
def create_investment_alias(payload: InvestmentAliasCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = Investment(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        type=(payload.category or "GENERAL").upper(),
        name=payload.name.strip(),
        principal=payload.amount,
        maturity=payload.target_date,
        currency=(payload.currency or "BDT").upper()[:10],
        note=payload.note,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="INVESTMENT",
        entity_id=row.id,
        title="Investment created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return _investment_alias_response(row)


@router.get("/investments/{family_id}")
def list_investments_alias(family_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db, family_id, current_user.id, "report.read")
    rows = (
        db.query(Investment)
        .filter(Investment.family_id == family_id, Investment.deleted_at.is_(None))
        .order_by(Investment.created_at.desc())
        .all()
    )
    return [_investment_alias_response(row) for row in rows]


@router.post("/subscriptions")
def create_subscription_alias(payload: SubscriptionAliasCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = Subscription(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        name=payload.name.strip(),
        amount=payload.amount,
        cycle="MONTHLY",
        next_due=payload.renewal_or_expiry_date,
        auto_remind=True,
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.note or payload.reference,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="SUBSCRIPTION",
        entity_id=row.id,
        title="Subscription created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return _subscription_alias_response(row)


@router.get("/subscriptions/{family_id}")
def list_subscriptions_alias(family_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db, family_id, current_user.id, "report.read")
    rows = (
        db.query(Subscription)
        .filter(Subscription.family_id == family_id, Subscription.deleted_at.is_(None))
        .order_by(Subscription.created_at.desc())
        .all()
    )
    return [_subscription_alias_response(row) for row in rows]
