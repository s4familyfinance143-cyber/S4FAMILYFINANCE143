"""Architecture feature APIs: tags, transaction_tags, loan_payments."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.architecture_feature import LoanPayment, Tag, TransactionTag
from app.models.loan import Loan
from app.models.transaction import Transaction
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission

router = APIRouter(tags=["Architecture Features"])
MONEY = Decimal("0.0001")


def money(v) -> str:
    return str(Decimal(v or 0).quantize(MONEY, rounding=ROUND_HALF_UP))


class TagIn(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=80)
    color: str | None = None


class TxTagIn(BaseModel):
    family_id: str
    transaction_id: str
    tag_id: str


class LoanPaymentIn(BaseModel):
    family_id: str
    loan_id: str
    amount: Decimal
    payment_date: str
    notes: str | None = None
    payment_method: str | None = None
    transaction_id: str | None = None


@router.get("/tags/{family_id}")
def list_tags(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Tag)
        .filter(Tag.family_id == family_id, Tag.deleted_at.is_(None))
        .order_by(Tag.name.asc())
        .all()
    )
    return [{"id": r.id, "name": r.name, "color": r.color} for r in rows]


@router.post("/tags", status_code=status.HTTP_201_CREATED)
def create_tag(payload: TagIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "transaction.create")
    existing = (
        db.query(Tag)
        .filter(Tag.family_id == payload.family_id, Tag.name == payload.name.strip(), Tag.deleted_at.is_(None))
        .first()
    )
    if existing:
        raise HTTPException(400, "Tag already exists")
    row = Tag(family_id=payload.family_id, name=payload.name.strip(), color=payload.color)
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="TAG",
        entity_id=row.id,
        title="Tag created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "color": row.color}


@router.post("/transaction-tags", status_code=status.HTTP_201_CREATED)
def attach_tag(payload: TxTagIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "transaction.create")
    tx = (
        db.query(Transaction)
        .filter(
            Transaction.id == payload.transaction_id,
            Transaction.family_id == payload.family_id,
            Transaction.deleted_at.is_(None),
        )
        .first()
    )
    if not tx:
        raise HTTPException(404, "Transaction not found")
    tag = (
        db.query(Tag)
        .filter(Tag.id == payload.tag_id, Tag.family_id == payload.family_id, Tag.deleted_at.is_(None))
        .first()
    )
    if not tag:
        raise HTTPException(404, "Tag not found")
    existing = (
        db.query(TransactionTag)
        .filter(
            TransactionTag.transaction_id == tx.id,
            TransactionTag.tag_id == tag.id,
            TransactionTag.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        return {"id": existing.id, "transaction_id": tx.id, "tag_id": tag.id, "already": True}
    row = TransactionTag(transaction_id=tx.id, tag_id=tag.id)
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="TRANSACTION_TAG",
        entity_id=row.id,
        title="Tag attached",
        description=tag.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "transaction_id": tx.id, "tag_id": tag.id}


@router.get("/transaction-tags/{transaction_id}")
def list_tx_tags(
    transaction_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    # family_id above only proves membership in *a* family — transaction_id is
    # caller-supplied, so the query must also confirm that transaction actually
    # belongs to that family, or a member of one family could read tags off an
    # arbitrary transaction UUID belonging to a different family.
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
    rows = (
        db.query(TransactionTag, Tag)
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .filter(
            TransactionTag.transaction_id == transaction_id,
            TransactionTag.deleted_at.is_(None),
            Tag.deleted_at.is_(None),
        )
        .all()
    )
    return [{"id": tt.id, "tag_id": tag.id, "name": tag.name, "color": tag.color} for tt, tag in rows]


@router.delete("/transaction-tags/{link_id}")
def detach_tag(
    link_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "transaction.create")
    row = db.get(TransactionTag, link_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(404, "Not found")
    # Same cross-family check as list_tx_tags: link_id alone doesn't prove the
    # underlying transaction belongs to the caller's family — TransactionTag has
    # no family_id column of its own, so this must join through Transaction.
    owner_tx = (
        db.query(Transaction)
        .filter(
            Transaction.id == row.transaction_id,
            Transaction.family_id == family_id,
            Transaction.deleted_at.is_(None),
        )
        .first()
    )
    if not owner_tx:
        raise HTTPException(404, "Not found")
    from datetime import datetime, timezone

    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": link_id, "status": "DETACHED"}


@router.patch("/tags/{tag_id}")
def update_tag(
    tag_id: str,
    payload: TagIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, user.id, "transaction.create")
    row = db.query(Tag).filter(Tag.id == tag_id, Tag.family_id == payload.family_id, Tag.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Tag not found")
    row.name = payload.name.strip()
    row.color = payload.color
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "color": row.color}


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "transaction.create")
    row = db.query(Tag).filter(Tag.id == tag_id, Tag.family_id == family_id, Tag.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Tag not found")
    from datetime import datetime, timezone

    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": tag_id, "status": "DELETED"}


@router.get("/loan-payments/{family_id}")
def list_loan_payments(
    family_id: str,
    loan_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    q = db.query(LoanPayment).filter(LoanPayment.family_id == family_id, LoanPayment.deleted_at.is_(None))
    if loan_id:
        q = q.filter(LoanPayment.loan_id == loan_id)
    rows = q.order_by(LoanPayment.created_at.desc()).all()
    return [
        {
            "id": r.id,
            "loan_id": r.loan_id,
            "amount": money(r.amount),
            "payment_date": r.payment_date,
            "notes": r.notes,
            "payment_method": r.payment_method,
            "transaction_id": r.transaction_id,
        }
        for r in rows
    ]


@router.post("/loan-payments", status_code=status.HTTP_201_CREATED)
def create_loan_payment(payload: LoanPaymentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "loan.payment")
    loan = (
        db.query(Loan)
        .filter(Loan.id == payload.loan_id, Loan.family_id == payload.family_id, Loan.deleted_at.is_(None))
        .first()
    )
    if not loan:
        raise HTTPException(404, "Loan not found")
    # This is a supplementary payment record (note/method/date attached to a
    # transaction posted elsewhere) — NOT a money-moving action. The real
    # payment + ledger posting + loan.paid_amount/remaining_amount update
    # happens in POST /loans/payment via accounting_service.post_loan_installment.
    # Mutating the loan balance here too (as this used to) double-counted every
    # payment against loan.paid_amount with no matching wallet debit, corrupting
    # the loan balance and the books — sync_apply.py's offline equivalent for
    # this same entity type was already record-only; this now matches it.
    row = LoanPayment(
        loan_id=loan.id,
        family_id=payload.family_id,
        amount=payload.amount,
        payment_date=payload.payment_date,
        notes=payload.notes,
        payment_method=payload.payment_method,
        transaction_id=payload.transaction_id,
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="LOAN_PAYMENT",
        entity_id=row.id,
        title="Loan payment recorded",
        description=money(payload.amount),
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "amount": money(row.amount), "loan_id": row.loan_id}
