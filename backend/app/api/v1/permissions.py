from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family_member import FamilyMember
from app.models.member_permission import MemberPermission
from app.models.user import User
from app.schemas.permission import PermissionUpdateRequest
from app.services.permission_service import (
    get_base_permissions,
    normalize_role,
    require_owner,
    require_owner_or_admin,
)

router = APIRouter(prefix="/permissions", tags=["Permissions"])


PROTECTED_OWNER_PERMISSIONS = {
    "member.permission",
    "member.approve",
    "member.invite",
    "settings.manage",
    "audit.read",
    "backup.create",
    "backup.read",
    "backup.download",
    "backup.restore",
}

def get_active_member(
    db: Session,
    user_id: str,
    family_id: str,
) -> FamilyMember | None:
    return (
        db.query(FamilyMember)
        .filter(
            FamilyMember.user_id == user_id,
            FamilyMember.family_id == family_id,
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )


def serialize_override(item: MemberPermission):
    return {
        "id": item.id,
        "permission_key": item.permission_key,
        "allow": item.allow,
        "scope": item.scope,
    }


def effective_permissions_for_member(
    db: Session,
    member: FamilyMember,
):
    base_permissions = set(
        get_base_permissions(
            getattr(member, "role", None)
        )
    )

    overrides = (
        db.query(MemberPermission)
        .filter(
            MemberPermission.member_id == member.id,
            MemberPermission.deleted_at.is_(None),
        )
        .all()
    )

    from app.services.permission_service import member_permission_override_map

    override_map = member_permission_override_map(overrides)
    allowed_extra = {key for key, allowed in override_map.items() if allowed}
    denied = {key for key, allowed in override_map.items() if not allowed}

    role = normalize_role(
        getattr(member, "role", None)
    )

    if role == "OWNER":
        effective = base_permissions | allowed_extra
    else:
        protected_denied = PROTECTED_OWNER_PERMISSIONS
        effective = (
            base_permissions
            | allowed_extra
        ) - denied - protected_denied

    return {
        "base_permissions": sorted(base_permissions),
        "overrides": [
            serialize_override(item)
            for item in overrides
        ],
        "effective_permissions": sorted(effective),
    }


@router.get("/family/{family_id}/me")
def my_effective_permissions(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = get_active_member(
        db,
        current_user.id,
        family_id,
    )

    if not member:
        raise HTTPException(
            404,
            "You are not an active member of this family",
        )

    data = effective_permissions_for_member(
        db,
        member,
    )

    return {
        "member_id": member.id,
        "user_id": member.user_id,
        "role": member.role,
        "normalized_role": normalize_role(member.role),
        "relationship": getattr(
            member,
            "relationship_display_label",
            None,
        ),
        **data,
    }


@router.get("/family/{family_id}/members")
def family_members_permissions(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_owner(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
    )

    members = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .all()
    )

    output = []

    for member in members:
        data = effective_permissions_for_member(
            db,
            member,
        )

        output.append(
            {
                "member_id": member.id,
                "user_id": member.user_id,
                "role": member.role,
                "normalized_role": normalize_role(member.role),
                "relationship": getattr(
                    member,
                    "relationship_display_label",
                    None,
                ),
                **data,
            }
        )

    return output


@router.patch("/members/{member_id}")
def update_member_permission(
    member_id: str,
    payload: PermissionUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_member = db.get(
        FamilyMember,
        member_id,
    )

    if (
        not target_member
        or target_member.deleted_at is not None
        or target_member.status != "ACTIVE"
    ):
        raise HTTPException(
            404,
            "Member not found",
        )

    actor = require_owner_or_admin(
        db=db,
        family_id=target_member.family_id,
        user_id=current_user.id,
    )

    if target_member.id == actor.id:
        raise HTTPException(
            400,
            "Owner cannot modify own permissions",
        )

    if normalize_role(target_member.role) == "OWNER":
        raise HTTPException(
            403,
            "Owner permissions cannot be changed",
        )

    if payload.permission_key in PROTECTED_OWNER_PERMISSIONS and payload.allow:
        raise HTTPException(
            403,
            "Protected owner-level permission cannot be granted",
        )

    existing = (
        db.query(MemberPermission)
        .filter(
            MemberPermission.member_id == member_id,
            MemberPermission.permission_key == payload.permission_key,
            MemberPermission.scope == payload.scope,
            MemberPermission.deleted_at.is_(None),
        )
        .first()
    )

    if existing:
        existing.allow = payload.allow
    else:
        existing = MemberPermission(
            member_id=member_id,
            permission_key=payload.permission_key,
            allow=payload.allow,
            scope=payload.scope,
        )
        db.add(existing)

    from app.services.audit_service import write_audit_log

    write_audit_log(
        db=db,
        family_id=target_member.family_id,
        member_id=actor.id,
        action_type="UPDATE",
        entity_type="MEMBER_PERMISSION",
        entity_id=existing.id if getattr(existing, "id", None) else member_id,
        title="Member permission override updated",
        description=f"{payload.permission_key} allow={payload.allow} scope={payload.scope}",
    )

    db.commit()
    db.refresh(existing)

    return {
        "success": True,
        "member_id": member_id,
        "permission_key": existing.permission_key,
        "allow": existing.allow,
        "scope": existing.scope,
    }