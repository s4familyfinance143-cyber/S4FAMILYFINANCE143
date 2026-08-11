from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.budget import Budget
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.budget import (
    BudgetCloseRequest,
    BudgetCreateRequest,
    BudgetUpdateRequest,
)
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission

router = APIRouter(prefix="/budgets", tags=["Budgets"])

VALID_PERIOD_TYPES = {"WEEKLY", "MONTHLY", "YEARLY"}


def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.0000")))


def clean_text(value: str | None, field_name: str, max_length: int = 150) -> str:
    text = str(value or "").strip()
    if not text:
        raise HTTPException(400, f"{field_name} is required")
    if len(text) > max_length:
        raise HTTPException(400, f"{field_name} is too long")
    return text


def clean_optional_text(value: str | None, max_length: int = 500) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) > max_length:
        raise HTTPException(400, "Note is too long")
    return text


def clean_currency(value: str | None) -> str:
    currency = str(value or "BDT").strip().upper()
    if len(currency) < 3 or len(currency) > 10:
        raise HTTPException(400, "Invalid currency")
    return currency


def clean_period_type(value: str | None) -> str:
    period_type = str(value or "MONTHLY").strip().upper()
    if period_type not in VALID_PERIOD_TYPES:
        raise HTTPException(400, "Invalid budget period type")
    return period_type


def validate_amount(value) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.0000"))
    except (InvalidOperation, ValueError):
        raise HTTPException(400, "Invalid budget amount")

    if amount <= Decimal("0"):
        raise HTTPException(400, "Budget amount must be greater than zero")

    return amount


def percent(spent, budget):
    spent = Decimal(spent or 0)
    budget = Decimal(budget or 0)

    if budget <= 0:
        return "0.00"

    return str(((spent / budget) * Decimal("100")).quantize(Decimal("0.01")))


def get_category(db: Session, family_id: str, category_id: str) -> Category:
    category = db.get(Category, category_id)

    if (
        not category
        or category.family_id not in {family_id, None}
        or category.deleted_at is not None
    ):
        raise HTTPException(404, "Category not found")

    if not category.is_active:
        raise HTTPException(400, "Category inactive")

    if category.category_type != "EXPENSE":
        raise HTTPException(400, "Budget category must be EXPENSE category")

    return category


def get_budget(db: Session, family_id: str, budget_id: str) -> Budget:
    budget = (
        db.query(Budget)
        .filter(
            Budget.id == budget_id,
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .first()
    )

    if not budget:
        raise HTTPException(404, "Budget not found")

    return budget


def calculate_spent(db: Session, family_id: str, category_id: str) -> Decimal:
    txs = (
        db.query(Transaction)
        .filter(
            Transaction.family_id == family_id,
            Transaction.category_id == category_id,
            Transaction.transaction_type == "EXPENSE",
            Transaction.status == "POSTED",
            Transaction.deleted_at.is_(None),
        )
        .all()
    )

    total = Decimal("0")

    for tx in txs:
        total += Decimal(tx.amount or 0)

    return total


def budget_status_summary(budgets: list[dict]) -> dict:
    total_budget = sum(Decimal(item["budget_amount"]) for item in budgets)
    total_spent = sum(Decimal(item["spent_amount"]) for item in budgets)
    active = [item for item in budgets if item["status"] == "ACTIVE"]
    over_budget = [item for item in active if item["is_over_budget"]]
    warning = [
        item
        for item in active
        if not item["is_over_budget"] and Decimal(item["used_percent"]) >= Decimal("80")
    ]

    return {
        "total_budget": money(total_budget),
        "total_spent": money(total_spent),
        "remaining_amount": money(total_budget - total_spent),
        "used_percent": percent(total_spent, total_budget),
        "active_count": len(active),
        "over_budget_count": len(over_budget),
        "warning_count": len(warning),
        "over_budget": over_budget,
        "warning": warning,
    }


def budget_response(db: Session, budget: Budget):
    category = db.get(Category, budget.category_id)

    spent_amount = calculate_spent(
        db=db,
        family_id=budget.family_id,
        category_id=budget.category_id,
    )

    budget.spent_amount = spent_amount

    remaining_amount = Decimal(budget.budget_amount or 0) - spent_amount
    is_over_budget = spent_amount > Decimal(budget.budget_amount or 0)

    return {
        "id": budget.id,
        "family_id": budget.family_id,
        "category_id": budget.category_id,
        "category_name": category.name_en if category else "Unknown",
        "name": budget.name,
        "budget_amount": money(budget.budget_amount),
        "spent_amount": money(spent_amount),
        "remaining_amount": money(remaining_amount),
        "used_percent": percent(spent_amount, budget.budget_amount),
        "is_over_budget": is_over_budget,
        "currency": budget.currency,
        "period_type": budget.period_type,
        "status": budget.status,
        "note": budget.note,
        "created_at": budget.created_at,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_budget(
    payload: BudgetCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="budget.create",
    )

    category = get_category(db, payload.family_id, payload.category_id)
    name = clean_text(payload.name, "Budget name")
    budget_amount = validate_amount(payload.budget_amount)
    currency = clean_currency(payload.currency)
    period_type = clean_period_type(payload.period_type)

    existing = (
        db.query(Budget)
        .filter(
            Budget.family_id == payload.family_id,
            Budget.category_id == payload.category_id,
            Budget.period_type == period_type,
            Budget.status == "ACTIVE",
            Budget.deleted_at.is_(None),
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Active budget already exists for this category and period",
        )

    spent_amount = calculate_spent(
        db=db,
        family_id=payload.family_id,
        category_id=payload.category_id,
    )

    budget = Budget(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        category_id=category.id,
        name=name,
        budget_amount=budget_amount,
        spent_amount=spent_amount,
        currency=currency,
        period_type=period_type,
        status="ACTIVE",
        note=clean_optional_text(payload.note),
    )

    db.add(budget)
    db.flush()

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="BUDGET",
        entity_id=budget.id,
        title="Budget Created",
        description=f"{budget.name} budget created for {budget.budget_amount} {budget.currency}",
    )

    db.commit()
    db.refresh(budget)

    return budget_response(db, budget)


@router.patch("/{budget_id}")
def update_budget(
    budget_id: str,
    payload: BudgetUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="budget.create",
    )

    budget = get_budget(db, payload.family_id, budget_id)

    if budget.status != "ACTIVE":
        raise HTTPException(400, "Only active budget can be edited")

    budget.name = clean_text(payload.name, "Budget name")
    budget.budget_amount = validate_amount(payload.budget_amount)
    budget.note = clean_optional_text(payload.note)

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="BUDGET",
        entity_id=budget.id,
        title="Budget Updated",
        description=f"{budget.name} budget updated",
    )

    db.commit()
    db.refresh(budget)

    return budget_response(db, budget)


@router.post("/{budget_id}/close")
def close_budget(
    budget_id: str,
    payload: BudgetCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="budget.create",
    )

    budget = get_budget(db, payload.family_id, budget_id)

    if budget.status == "CLOSED":
        raise HTTPException(400, "Budget already closed")

    budget.status = "CLOSED"

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type="BUDGET",
        entity_id=budget.id,
        title="Budget Closed",
        description=payload.reason or "Budget closed",
    )

    db.commit()
    db.refresh(budget)

    return budget_response(db, budget)


@router.get("/status/{family_id}")
def get_budget_status(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="budget.read",
    )

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .order_by(Budget.created_at.desc())
        .all()
    )

    items = [budget_response(db, budget) for budget in budgets]
    db.commit()

    return {
        "family_id": family_id,
        "summary": budget_status_summary(items),
        "budgets": items,
    }


@router.get("/{family_id}")
def list_budgets(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="budget.read",
    )

    budgets = (
        db.query(Budget)
        .filter(
            Budget.family_id == family_id,
            Budget.deleted_at.is_(None),
        )
        .order_by(Budget.created_at.desc())
        .all()
    )

    result = [budget_response(db, budget) for budget in budgets]

    db.commit()

    return result
