"""Double-Entry Accounting Engine HTTP surface."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services import accounting_service
from app.services.permission_service import require_permission

router = APIRouter(prefix="/accounting", tags=["Double-Entry Accounting"])


class AccountingLineIn(BaseModel):
    account_id: str
    debit: float | int | str = 0
    credit: float | int | str = 0
    line_type: str | None = None
    description: str | None = Field(default=None, max_length=500)


class CreateJournalRequest(BaseModel):
    family_id: str
    transaction_type: str = "JOURNAL"
    amount: float | int | str
    currency: str = "BDT"
    description: str | None = None
    category_id: str | None = None
    lines: list[AccountingLineIn] = Field(..., min_length=2)


class RollbackRequest(BaseModel):
    family_id: str
    reason: str | None = None


@router.post("/transactions")
def create_transaction(
    payload: CreateJournalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="transaction.create",
    )
    lines = [line.model_dump() for line in payload.lines]
    accounting_service.validate_balance(lines)
    tx = accounting_service.create_transaction(
        db,
        family_id=payload.family_id,
        member_id=member.id,
        transaction_type=payload.transaction_type.upper(),
        amount=payload.amount,
        currency=payload.currency,
        description=payload.description,
        category_id=payload.category_id,
        lines=lines,
    )
    db.commit()
    db.refresh(tx)
    return {
        "id": tx.id,
        "status": tx.status,
        "transaction_type": tx.transaction_type,
        "amount": str(tx.amount),
        "currency": tx.currency,
    }


@router.get("/trial-balance/{family_id}")
def trial_balance(
    family_id: str,
    currency: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db, family_id=family_id, user_id=current_user.id, permission="report.read"
    )
    return accounting_service.generate_trial_balance(db, family_id, currency=currency)


@router.get("/income-statement/{family_id}")
def income_statement(
    family_id: str,
    currency: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db, family_id=family_id, user_id=current_user.id, permission="report.read"
    )
    return accounting_service.generate_income_statement(db, family_id, currency=currency)


@router.get("/cash-flow/{family_id}")
def cash_flow(
    family_id: str,
    currency: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db, family_id=family_id, user_id=current_user.id, permission="report.read"
    )
    return accounting_service.generate_cash_flow(db, family_id, currency=currency)


@router.get("/account-balance/{family_id}/{account_id}")
def account_balance(
    family_id: str,
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db, family_id=family_id, user_id=current_user.id, permission="wallet.read"
    )
    bal = accounting_service.calculate_account_balance(db, account_id, family_id=family_id)
    return {"account_id": account_id, "family_id": family_id, "balance": str(bal)}


@router.post("/transactions/{transaction_id}/rollback")
def rollback_transaction(
    transaction_id: str,
    payload: RollbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="transaction.delete",
    )
    try:
        result = accounting_service.rollback_transaction(
            db,
            transaction_id=transaction_id,
            member_id=member.id,
            reason=payload.reason,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return result


@router.post("/repair-legacy/{family_id}")
def repair_legacy_lines(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Backfill null account_id lines + ensure exact CoA system accounts."""
    member = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="transaction.update",
    )
    from app.services.chart_of_accounts import ensure_family_chart

    chart = ensure_family_chart(db, family_id=family_id, owner_member_id=member.id)
    result = accounting_service.repair_legacy_null_account_lines(
        db, family_id=family_id, owner_member_id=member.id
    )
    db.commit()
    return {
        "family_id": family_id,
        "chart_accounts": {k: v.id for k, v in chart.items()},
        "legacy_repair": result,
        "complete": True,
    }
