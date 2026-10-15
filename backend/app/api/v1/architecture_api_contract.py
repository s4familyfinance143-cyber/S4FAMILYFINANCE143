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
    member = require_permission(db, family_id, current_user.id, "wallet.read")
    from app.api.v1.accounts import can_view_wallet
    from app.services import accounting_service

    accounts = (
        db.query(Account)
        .filter(Account.family_id == family_id, Account.deleted_at.is_(None), Account.is_active.is_(True))
        .all()
    )
    rows = []
    for a in accounts:
        # Wallets + system CoA, same visibility rule as GET /accounts/coa/{family_id}:
        # another member's private wallet stays hidden from non-owners.
        if not (can_view_wallet(member, a) or getattr(a, "is_system", False)):
            continue
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
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.offline_sync_hardened import phase10b_sync_pull

    # Pass every parameter explicitly: calling an endpoint function directly
    # leaves omitted ones as FastAPI Query() objects, not their defaults.
    return phase10b_sync_pull(
        family_id=family_id,
        device_id=device_id,
        since_token=since,
        limit=limit,
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
    start_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.reports import cashflow_report

    return cashflow_report(
        family_id=family_id,
        start_date=start_date,
        end_date=end_date,
        db=db,
        current_user=current_user,
    )


@router.get("/reports/net-worth")
def architecture_reports_net_worth(
    family_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.reports import net_worth_report

    return net_worth_report(family_id=family_id, db=db, current_user=current_user)


