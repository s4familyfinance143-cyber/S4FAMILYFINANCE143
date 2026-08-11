"""Architecture API Design — letter-by-letter exact paths (/api/v1/...).

Delegates to existing services while exposing the contract paths from the
architecture checklist. Legacy paths remain available.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.rate_limit import JOIN_REQUEST_LIMIT, limiter
from app.models.account import Account
from app.models.family_member import FamilyMember
from app.models.relationship_type import RelationshipType
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.invite import InviteCodeCreateRequest, JoinByCodeRequest
from app.schemas.join_request import JoinRequestDecisionRequest
from app.schemas.loan import LoanPaymentRequest
from app.services.chart_of_accounts import is_spend_wallet
from app.services.permission_service import (
    get_active_member_or_403,
    normalize_role,
    require_owner_or_admin,
    require_permission,
)

router = APIRouter(tags=["Architecture API Contract"])


# ---------------------------------------------------------------------------
# Family Governance — exact paths
# ---------------------------------------------------------------------------


@router.post("/families/{family_id}/invite-codes")
def architecture_create_invite_code(
    family_id: str,
    payload: InviteCodeCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owner_or_admin(db, family_id, current_user.id)
    from app.api.v1.invites import generate_invite_code

    return generate_invite_code(
        family_id=family_id, payload=payload, db=db, current_user=current_user
    )


@router.post("/families/invite")
def architecture_families_invite(
    payload: InviteCodeCreateRequest,
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Spec: POST /families/invite (Admin) — generates invite for family_id."""
    require_owner_or_admin(db, family_id, current_user.id)
    from app.api.v1.invites import generate_invite_code

    return generate_invite_code(
        family_id=family_id, payload=payload, db=db, current_user=current_user
    )


class JoinRequestCreateBody(BaseModel):
    invite_code: str
    requested_role: str | None = "MEMBER"
    relationship_type_id: str | None = None
    relationship_serial: int | None = None
    relationship_label: str | None = None


@router.post("/join-requests")
@limiter.limit(JOIN_REQUEST_LIMIT)
def architecture_create_join_request(
    request: Request,
    payload: JoinByCodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.invites import join_family_by_code

    return join_family_by_code(
        request=request, payload=payload, db=db, current_user=current_user
    )


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)
    note: str | None = None


class ApproveBody(BaseModel):
    role: str | None = None
    note: str | None = None


@router.patch("/join-requests/{request_id}/approve")
def architecture_approve_join(
    request_id: str,
    payload: ApproveBody | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.join_requests import approve_or_reject_request

    body = JoinRequestDecisionRequest(
        action="APPROVE",
        note=(payload.note if payload else None),
    )
    # Allow Owner/Admin via patched decision handler
    return approve_or_reject_request(
        request_id=request_id, payload=body, db=db, current_user=current_user
    )


@router.patch("/join-requests/{request_id}/reject")
def architecture_reject_join(
    request_id: str,
    payload: RejectBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    reason = (payload.reason or payload.note or "").strip()
    if not reason:
        raise HTTPException(422, "Reject reason is required")
    from app.api.v1.join_requests import approve_or_reject_request

    body = JoinRequestDecisionRequest(action="REJECT", note=reason)
    return approve_or_reject_request(
        request_id=request_id, payload=body, db=db, current_user=current_user
    )


@router.patch("/invite-codes/{invite_id}/revoke")
def architecture_revoke_invite(
    invite_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.invites import revoke_invite_code

    return revoke_invite_code(invite_id=invite_id, db=db, current_user=current_user)


@router.patch("/family-members/{member_id}/permissions")
def architecture_member_permissions(
    member_id: str,
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.permissions import update_member_permission
    from app.schemas.permission import PermissionUpdateRequest

    req = PermissionUpdateRequest(**payload)
    return update_member_permission(
        member_id=member_id, payload=req, db=db, current_user=current_user
    )


@router.get("/relationship-types")
def architecture_relationship_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Authenticated user who is (or can be) a family member — any logged-in user
    _ = current_user
    rows = (
        db.query(RelationshipType)
        .filter(RelationshipType.deleted_at.is_(None))
        .order_by(RelationshipType.group_name.asc(), RelationshipType.name_en.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "name_en": r.name_en,
            "name_bn": r.name_bn,
            "group_name": r.group_name,
            "needs_serial": r.needs_serial,
            "is_system": r.is_system,
            "is_active": r.is_active,
        }
        for r in rows
        if getattr(r, "is_active", True)
    ]


@router.put("/families/members/{member_id}/role")
def architecture_put_member_role(
    member_id: str,
    role: str = Query(...),
    family_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = db.get(FamilyMember, member_id)
    if not target or target.deleted_at is not None:
        raise HTTPException(404, "Member not found")
    fid = family_id or target.family_id
    require_owner_or_admin(db, fid, current_user.id)
    new_role = role.strip().upper()
    if new_role not in {"ADMIN", "MEMBER", "CHILD", "VIEWER"}:
        raise HTTPException(422, "Invalid role")
    if normalize_role(target.role) == "OWNER":
        raise HTTPException(422, "Cannot demote owner via role update — use ownership transfer")
    target.role = new_role
    db.commit()
    db.refresh(target)
    return {"id": target.id, "role": target.role, "family_id": fid}


# ---------------------------------------------------------------------------
# Complete catalog — exact paths
# ---------------------------------------------------------------------------



class ExportJobBody(BaseModel):
    family_id: str
    report_type: str | None = "monthly"
    format: str | None = None


@router.get("/accounts")
def architecture_list_accounts(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.accounts import list_family_accounts

    return list_family_accounts(family_id=family_id, db=db, current_user=current_user)


@router.get("/accounts/balance")
def architecture_accounts_balance(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "wallet.read")
    from app.services import accounting_service

    accounts = (
        db.query(Account)
        .filter(Account.family_id == family_id, Account.deleted_at.is_(None), Account.is_active.is_(True))
        .all()
    )
    rows = []
    for a in accounts:
        if not is_spend_wallet(a) and not getattr(a, "is_system", False):
            # include wallets + system CoA
            pass
        bal = accounting_service.calculate_account_balance(db, a.id, family_id=family_id)
        rows.append(
            {
                "account_id": a.id,
                "name": a.name,
                "account_type": a.account_type,
                "currency": a.currency,
                "balance": str(bal),
                "current_balance": str(a.current_balance or 0),
                "is_system": bool(getattr(a, "is_system", False)),
            }
        )
    return {"family_id": family_id, "accounts": rows}


@router.get("/transactions")
def architecture_list_transactions(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.transactions import list_transactions

    return list_transactions(family_id=family_id, db=db, current_user=current_user)


@router.post("/transactions")
def architecture_create_transaction(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """POST /transactions — routes by transaction_type to income/expense/transfer/journal."""
    ttype = str(payload.get("transaction_type") or payload.get("type") or "").upper()
    if ttype == "INCOME":
        from app.api.v1.transactions import create_income
        from app.schemas.transaction import IncomeCreateRequest

        return create_income(payload=IncomeCreateRequest(**payload), db=db, current_user=current_user)
    if ttype == "EXPENSE":
        from app.api.v1.transactions import create_expense
        from app.schemas.transaction import ExpenseCreateRequest

        return create_expense(payload=ExpenseCreateRequest(**payload), db=db, current_user=current_user)
    if ttype == "TRANSFER":
        from app.api.v1.transactions import create_transfer
        from app.schemas.transaction import TransferCreateRequest

        return create_transfer(payload=TransferCreateRequest(**payload), db=db, current_user=current_user)
    # Generic journal via accounting engine
    from app.api.v1.accounting import CreateJournalRequest, create_transaction as acct_create

    return acct_create(
        payload=CreateJournalRequest(**payload), db=db, current_user=current_user
    )


@router.get("/loans")
def architecture_list_loans(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.loans import list_loans

    return list_loans(family_id=family_id, db=db, current_user=current_user)


@router.post("/loans/{loan_id}/pay")
def architecture_loan_pay(
    loan_id: str,
    payload: LoanPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.loans import loan_payment

    # Ensure path loan_id wins
    data = payload.model_dump()
    data["loan_id"] = loan_id
    return loan_payment(payload=LoanPaymentRequest(**data), db=db, current_user=current_user)


@router.get("/budgets")
def architecture_list_budgets(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.budgets import list_budgets

    return list_budgets(family_id=family_id, db=db, current_user=current_user)


@router.get("/budgets/status")
def architecture_budget_status(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.budgets import get_budget_status

    return get_budget_status(family_id=family_id, db=db, current_user=current_user)


@router.post("/sync/push")
def architecture_sync_push(
    family_id: str = Query(...),
    payload: dict[str, Any] | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.offline_sync_hardened import phase10b_sync_push

    return phase10b_sync_push(
        family_id=family_id,
        body=payload or {},
        db=db,
        current_user=current_user,
    )


@router.get("/sync/pull")
def architecture_sync_pull(
    family_id: str = Query(...),
    since: str | None = Query(default=None),
    device_id: str = Query(default="default-device"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.offline_sync_hardened import phase10b_sync_pull

    return phase10b_sync_pull(
        family_id=family_id,
        device_id=device_id,
        since_token=since,
        db=db,
        current_user=current_user,
    )


@router.post("/export/pdf")
def architecture_export_pdf(
    payload: ExportJobBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.jobs import ExportJobCreate, create_export_job

    return create_export_job(
        payload=ExportJobCreate(
            family_id=payload.family_id,
            report_type=payload.report_type or "overview",
            format="pdf",
        ),
        db=db,
        current_user=current_user,
    )


@router.post("/export/excel")
def architecture_export_excel(
    payload: ExportJobBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.jobs import ExportJobCreate, create_export_job

    return create_export_job(
        payload=ExportJobCreate(
            family_id=payload.family_id,
            report_type=payload.report_type or "overview",
            format="excel",
        ),
        db=db,
        current_user=current_user,
    )


@router.get("/reports/monthly")
def architecture_reports_monthly(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.reports import monthly_trend_report

    return monthly_trend_report(family_id=family_id, db=db, current_user=current_user)


@router.get("/reports/cashflow")
def architecture_reports_cashflow(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.reports import cashflow_report

    return cashflow_report(family_id=family_id, db=db, current_user=current_user)


@router.get("/reports/net-worth")
def architecture_reports_net_worth(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.reports import net_worth_report

    return net_worth_report(family_id=family_id, db=db, current_user=current_user)


@router.get("/zakat/calculate")
def architecture_zakat_calculate_get(
    family_id: str = Query(...),
    calculation_year: str = Query(...),
    currency: str = Query(default="BDT"),
    cash_amount: Decimal = Query(default=Decimal("0")),
    gold_value: Decimal = Query(default=Decimal("0")),
    silver_value: Decimal = Query(default=Decimal("0")),
    investment_value: Decimal = Query(default=Decimal("0")),
    business_assets: Decimal = Query(default=Decimal("0")),
    receivables: Decimal = Query(default=Decimal("0")),
    deductible_debts: Decimal = Query(default=Decimal("0")),
    nisab_amount: Decimal = Query(default=Decimal("0")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.zakat import calculate_zakat
    from app.schemas.zakat import ZakatCalculateRequest

    payload = ZakatCalculateRequest(
        family_id=family_id,
        calculation_year=calculation_year,
        currency=currency,
        cash_amount=cash_amount,
        gold_value=gold_value,
        silver_value=silver_value,
        investment_value=investment_value,
        business_assets=business_assets,
        receivables=receivables,
        deductible_debts=deductible_debts,
        nisab_amount=nisab_amount,
    )
    return calculate_zakat(payload=payload, db=db, current_user=current_user)


@router.get("/notifications")
def architecture_list_notifications(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1 import notifications as notifications_api

    # Prefer list by family if exists
    for name in ("list_notifications", "get_notifications", "list_family_notifications"):
        fn = getattr(notifications_api, name, None)
        if callable(fn):
            try:
                return fn(family_id=family_id, db=db, current_user=current_user)
            except TypeError:
                continue
    # Direct query fallback
    from app.models.notification import Notification

    require_permission(db, family_id, current_user.id, "notification.read")
    rows = (
        db.query(Notification)
        .filter(Notification.family_id == family_id, Notification.deleted_at.is_(None))
        .order_by(Notification.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": n.id,
            "family_id": n.family_id,
            "title": n.title,
            "message": n.message,
            "severity": n.severity,
            "is_read": n.is_read,
            "created_at": n.created_at,
        }
        for n in rows
    ]


@router.get("/grocery/lists")
def architecture_grocery_lists(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.grocery import list_grocery_lists

    return list_grocery_lists(family_id=family_id, db=db, current_user=current_user)


@router.get("/income")
def architecture_list_income(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.compat_aliases import list_income_alias

    return list_income_alias(family_id=family_id, db=db, current_user=current_user)


@router.get("/expenses")
def architecture_list_expenses(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.compat_aliases import list_expense_alias

    return list_expense_alias(family_id=family_id, db=db, current_user=current_user)
