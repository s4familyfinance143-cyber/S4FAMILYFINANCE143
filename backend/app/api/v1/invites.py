import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family_member import FamilyMember
from app.models.invite_code import InviteCode
from app.models.join_request import JoinRequest
from app.models.relationship_type import RelationshipType
from app.models.user import User
from app.schemas.invite import (
    InviteCodeCreateRequest,
    InviteCodeResponse,
    InviteEmailRequest,
    InviteLinkRequest,
    JoinByCodeRequest,
    JoinRequestResponse,
)
from app.core.rate_limit import JOIN_REQUEST_LIMIT, limiter
from fastapi import Request
from app.core.config import settings
from app.core.timeutil import utc_now
from app.services.audit_service import write_audit_log
from app.services.email_service import send_email
from app.services.permission_service import require_permission

router = APIRouter(prefix="/invites", tags=["Invites"])


def hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def normalize_invite_code(code: str) -> str:
    return code.strip().upper()


def _public_join_link(code_or_token: str) -> str:
    base = (settings.APP_PUBLIC_URL or "http://127.0.0.1:5173").rstrip("/")
    return f"{base}/join?code={code_or_token}"


def _create_invite_row(
    *,
    db: Session,
    family_id: str,
    actor_id: str,
    expires_days: int,
    max_uses: int,
    channel: str,
    invitee_email: str | None = None,
) -> tuple[InviteCode, str]:
    raw_code = f"S4F-{secrets.token_hex(4).upper()}"
    link_token = secrets.token_urlsafe(24)
    invite = InviteCode(
        family_id=family_id,
        code_hash=hash_code(raw_code),
        created_by_member_id=actor_id,
        expires_at=utc_now() + timedelta(days=expires_days),
        max_uses=max_uses,
        used_count=0,
        status="ACTIVE",
        invitee_email=(invitee_email or "").strip().lower() or None,
        invite_link_token=link_token,
        invite_channel=channel,
        raw_code_hint=raw_code[:12],
    )
    db.add(invite)
    db.flush()
    return invite, raw_code


def _maybe_send_invite_email(*, to_email: str, code: str, link: str) -> tuple[bool, str]:
    subject = "S4 Family Finance — Family Invite"
    text = (
        f"You are invited to join a family on S4 Family Finance.\n\n"
        f"Invite code: {code}\n"
        f"Join link: {link}\n\n"
        f"Open the app, sign in, and use the code or link to request join."
    )
    html = (
        f"<p>You are invited to join a family on <strong>S4 Family Finance</strong>.</p>"
        f"<p>Invite code: <code>{code}</code></p>"
        f'<p><a href="{link}">Open join link</a></p>'
    )
    result = send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)
    return bool(result.sent), result.reason


@router.post("/generate/{family_id}", response_model=InviteCodeResponse)
def generate_invite_code(
    family_id: str,
    payload: InviteCodeCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="member.invite",
    )

    expires_days = int(payload.expires_in_days or 1)
    max_uses = int(payload.max_uses or 1)

    if expires_days < 1 or expires_days > 30:
        raise HTTPException(400, "Invite expiry must be between 1 and 30 days")

    if max_uses < 1 or max_uses > 20:
        raise HTTPException(400, "Invite max uses must be between 1 and 20")

    email = (payload.invitee_email or "").strip().lower() or None
    channel = "EMAIL" if email else "CODE"
    invite, raw_code = _create_invite_row(
        db=db,
        family_id=family_id,
        actor_id=actor.id,
        expires_days=expires_days,
        max_uses=max_uses,
        channel=channel,
        invitee_email=email,
    )
    link = _public_join_link(raw_code)

    email_sent = None
    email_reason = None
    if email and payload.send_email:
        email_sent, email_reason = _maybe_send_invite_email(to_email=email, code=raw_code, link=link)

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=actor.id,
        action_type="CREATE",
        entity_type="INVITE_CODE",
        entity_id=invite.id,
        title="Invite Code Generated",
        description=f"Invite ({channel}) max uses {max_uses}, expiry {expires_days} days",
    )

    db.commit()

    return InviteCodeResponse(
        invite_id=invite.id,
        invite_code=raw_code,
        expires_in_days=expires_days,
        max_uses=max_uses,
        status=invite.status,
        invite_channel=channel,
        invitee_email=email,
        invite_link=link,
        email_sent=email_sent,
        email_reason=email_reason,
    )


@router.post("/email/{family_id}", response_model=InviteCodeResponse)
def invite_by_email(
    family_id: str,
    payload: InviteEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = require_permission(db=db, family_id=family_id, user_id=current_user.id, permission="member.invite")
    email = payload.invitee_email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Valid invitee_email required")

    invite, raw_code = _create_invite_row(
        db=db,
        family_id=family_id,
        actor_id=actor.id,
        expires_days=int(payload.expires_in_days),
        max_uses=int(payload.max_uses),
        channel="EMAIL",
        invitee_email=email,
    )
    link = _public_join_link(raw_code)
    email_sent, email_reason = _maybe_send_invite_email(to_email=email, code=raw_code, link=link)

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=actor.id,
        action_type="CREATE",
        entity_type="INVITE_EMAIL",
        entity_id=invite.id,
        title="Email invite created",
        description=f"{email} · sent={email_sent}",
    )
    db.commit()
    return InviteCodeResponse(
        invite_id=invite.id,
        invite_code=raw_code,
        expires_in_days=payload.expires_in_days,
        max_uses=payload.max_uses,
        status=invite.status,
        invite_channel="EMAIL",
        invitee_email=email,
        invite_link=link,
        email_sent=email_sent,
        email_reason=email_reason,
    )


@router.post("/link/{family_id}", response_model=InviteCodeResponse)
def invite_by_link(
    family_id: str,
    payload: InviteLinkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    actor = require_permission(db=db, family_id=family_id, user_id=current_user.id, permission="member.invite")
    email = (payload.invitee_email or "").strip().lower() or None
    invite, raw_code = _create_invite_row(
        db=db,
        family_id=family_id,
        actor_id=actor.id,
        expires_days=int(payload.expires_in_days),
        max_uses=int(payload.max_uses),
        channel="LINK",
        invitee_email=email,
    )
    # Prefer opaque link token in URL while code still works for join
    link = _public_join_link(invite.invite_link_token or raw_code)
    email_sent = None
    email_reason = None
    if email:
        email_sent, email_reason = _maybe_send_invite_email(to_email=email, code=raw_code, link=link)

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=actor.id,
        action_type="CREATE",
        entity_type="INVITE_LINK",
        entity_id=invite.id,
        title="Link invite created",
        description=link,
    )
    db.commit()
    return InviteCodeResponse(
        invite_id=invite.id,
        invite_code=raw_code,
        expires_in_days=payload.expires_in_days,
        max_uses=payload.max_uses,
        status=invite.status,
        invite_channel="LINK",
        invitee_email=email,
        invite_link=link,
        email_sent=email_sent,
        email_reason=email_reason,
    )


@router.post("/{invite_id}/revoke")
def revoke_invite_code(
    invite_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite = (
        db.query(InviteCode)
        .filter(InviteCode.id == invite_id, InviteCode.deleted_at.is_(None))
        .first()
    )
    if not invite:
        raise HTTPException(404, "Invite not found")

    actor = require_permission(
        db=db,
        family_id=invite.family_id,
        user_id=current_user.id,
        permission="member.invite",
    )

    if invite.status == "REVOKED":
        return {"invite_id": invite.id, "status": "REVOKED", "message": "Already revoked"}

    invite.status = "REVOKED"
    write_audit_log(
        db=db,
        family_id=invite.family_id,
        member_id=actor.id,
        action_type="UPDATE",
        entity_type="INVITE_CODE",
        entity_id=invite.id,
        title="Invite Code Revoked",
        description="Invite code revoked by family member",
    )
    db.commit()
    return {"invite_id": invite.id, "status": "REVOKED", "message": "Invite revoked"}


@router.post("/join", response_model=JoinRequestResponse)
@limiter.limit(JOIN_REQUEST_LIMIT)
def join_family_by_code(
    request: Request,
    payload: JoinByCodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite_code = normalize_invite_code(payload.invite_code)
    raw_input = payload.invite_code.strip()

    invite = (
        db.query(InviteCode)
        .filter(
            InviteCode.code_hash == hash_code(invite_code),
            InviteCode.status == "ACTIVE",
            InviteCode.deleted_at.is_(None),
        )
        .first()
    )
    if not invite:
        invite = (
            db.query(InviteCode)
            .filter(
                InviteCode.invite_link_token == raw_input,
                InviteCode.status == "ACTIVE",
                InviteCode.deleted_at.is_(None),
            )
            .first()
        )

    if not invite:
        raise HTTPException(404, "Invalid invite code")

    if invite.expires_at.replace(tzinfo=None) < utc_now():
        invite.status = "EXPIRED"
        db.commit()
        raise HTTPException(400, "Invite code expired")

    if invite.used_count >= invite.max_uses:
        invite.status = "USED"
        db.commit()
        raise HTTPException(400, "Invite code limit reached")

    already_member = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == invite.family_id,
            FamilyMember.user_id == current_user.id,
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )

    if already_member:
        raise HTTPException(409, "Already member")

    existing_pending = (
        db.query(JoinRequest)
        .filter(
            JoinRequest.family_id == invite.family_id,
            JoinRequest.user_id == current_user.id,
            JoinRequest.status == "PENDING",
            JoinRequest.deleted_at.is_(None),
        )
        .first()
    )

    if existing_pending:
        raise HTTPException(409, "Pending join request already exists")

    relationship_text = payload.relationship_type.strip()

    if not relationship_text:
        raise HTTPException(400, "Relationship type is required")

    relationship = (
        db.query(RelationshipType)
        .filter(
            RelationshipType.name_en.ilike(relationship_text),
            RelationshipType.deleted_at.is_(None),
        )
        .first()
    )

    if not relationship:
        relationship = RelationshipType(
            name_bn=relationship_text,
            name_en=relationship_text,
            group_name="FAMILY",
            needs_serial=payload.relationship_serial is not None,
            is_system=True,
            is_active=True,
        )
        db.add(relationship)
        db.flush()

    request = JoinRequest(
        family_id=invite.family_id,
        user_id=current_user.id,
        invite_code_id=invite.id,
        requested_role="MEMBER",
        status="PENDING",
        requested_relationship_type_id=relationship.id,
        requested_relationship_label=relationship_text,
        requested_relationship_serial=payload.relationship_serial,
    )

    db.add(request)
    db.flush()

    write_audit_log(
        db=db,
        family_id=invite.family_id,
        member_id=invite.created_by_member_id,
        action_type="CREATE",
        entity_type="JOIN_REQUEST",
        entity_id=request.id,
        title="Join Request Created",
        description=f"Join request created for relationship {relationship_text}",
    )

    db.commit()
    db.refresh(request)

    return JoinRequestResponse(
        request_id=request.id,
        status="PENDING",
        message="Join request sent",
    )