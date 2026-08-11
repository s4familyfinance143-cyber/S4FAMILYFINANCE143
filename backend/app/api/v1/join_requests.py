from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family_member import FamilyMember
from app.models.invite_code import InviteCode
from app.models.join_request import JoinRequest
from app.models.user import User
from app.schemas.join_request import JoinRequestDecisionRequest
from app.services.audit_service import write_audit_log
from app.services.join_request_service import expire_stale_join_requests
from app.services.permission_service import require_owner, require_owner_or_admin


router = APIRouter(
    prefix="/join-requests",
    tags=["Join Requests"],
)


@router.get("/family/{family_id}")
def get_pending_requests(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owner_or_admin(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
    )

    expire_stale_join_requests(db, family_id)

    requests = (
        db.query(JoinRequest)
        .filter(
            JoinRequest.family_id == family_id,
            JoinRequest.status == "PENDING",
            JoinRequest.deleted_at.is_(None),
        )
        .order_by(JoinRequest.created_at.desc())
        .all()
    )

    return [
        {
            "request_id": item.id,
            "family_id": item.family_id,
            "user_id": item.user_id,
            "status": item.status,
            "requested_role": item.requested_role,
            "relationship": item.requested_relationship_label,
            "relationship_serial": item.requested_relationship_serial,
            "created_at": item.created_at,
        }
        for item in requests
    ]


@router.post("/{request_id}/cancel")
def cancel_join_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request = (
        db.query(JoinRequest)
        .filter(JoinRequest.id == request_id, JoinRequest.deleted_at.is_(None))
        .first()
    )
    if not request:
        raise HTTPException(404, "Request not found")
    if request.status != "PENDING":
        raise HTTPException(400, f"Request already {request.status}")

    is_requester = request.user_id == current_user.id
    is_owner = False
    try:
        require_owner(db=db, family_id=request.family_id, user_id=current_user.id)
        is_owner = True
    except HTTPException:
        pass
    if not is_requester and not is_owner:
        raise HTTPException(403, "Only requester or owner can cancel")

    actor = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == request.family_id,
            FamilyMember.user_id == current_user.id,
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )
    request.status = "CANCELLED"
    write_audit_log(
        db=db,
        family_id=request.family_id,
        member_id=actor.id if actor else None,
        action_type="CANCEL",
        entity_type="JOIN_REQUEST",
        entity_id=request.id,
        title="Join Request Cancelled",
        description=f"Join request cancelled for user {request.user_id}",
    )
    db.commit()
    return {"success": True, "status": "CANCELLED", "request_id": request_id}


@router.post("/{request_id}/decision")
def approve_or_reject_request(
    request_id: str,
    payload: JoinRequestDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request = (
        db.query(JoinRequest)
        .filter(
            JoinRequest.id == request_id,
            JoinRequest.deleted_at.is_(None),
        )
        .first()
    )

    if not request:
        raise HTTPException(404, "Request not found")

    actor = require_owner_or_admin(
        db=db,
        family_id=request.family_id,
        user_id=current_user.id,
    )

    if request.user_id == current_user.id:
        raise HTTPException(403, "You cannot approve yourself")

    expire_stale_join_requests(db, request.family_id)
    db.refresh(request)

    if request.status != "PENDING":
        raise HTTPException(400, f"Request already {request.status}")

    action = payload.action.upper().strip()

    if action not in {"APPROVE", "REJECT"}:
        raise HTTPException(400, "Invalid action")

    if action == "REJECT":
        reason = (payload.note or "").strip()
        if not reason:
            raise HTTPException(422, "Reject reason is required")
        request.status = "REJECTED"
        request.reviewed_by_member_id = actor.id
        request.review_note = reason

        write_audit_log(
            db=db,
            family_id=request.family_id,
            member_id=actor.id,
            action_type="REJECT",
            entity_type="JOIN_REQUEST",
            entity_id=request.id,
            title="Join Request Rejected",
            description=f"Join request rejected for user {request.user_id}: {reason}",
        )

        db.commit()

        return {
            "success": True,
            "status": "REJECTED",
        }

    existing_member = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == request.family_id,
            FamilyMember.user_id == request.user_id,
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )

    if existing_member:
        raise HTTPException(409, "User already family member")

    member = FamilyMember(
        family_id=request.family_id,
        user_id=request.user_id,
        role=request.requested_role or "MEMBER",
        status="ACTIVE",
        relationship_type_id=request.requested_relationship_type_id,
        relationship_serial=request.requested_relationship_serial,
        relationship_display_label=request.requested_relationship_label,
        invited_by_member_id=actor.id,
        can_login_family=True,
    )

    db.add(member)
    db.flush()

    invite = db.get(InviteCode, request.invite_code_id)

    if invite:
        invite.used_count += 1

        if invite.used_count >= invite.max_uses:
            invite.status = "USED"

    request.status = "APPROVED"
    request.reviewed_by_member_id = actor.id
    request.review_note = payload.note

    write_audit_log(
        db=db,
        family_id=request.family_id,
        member_id=actor.id,
        action_type="APPROVE",
        entity_type="JOIN_REQUEST",
        entity_id=request.id,
        title="Join Request Approved",
        description=f"{member.relationship_display_label} joined family",
    )

    db.commit()
    db.refresh(member)

    return {
        "success": True,
        "status": "APPROVED",
        "member_created": True,
        "member_id": member.id,
        "relationship": member.relationship_display_label,
    }