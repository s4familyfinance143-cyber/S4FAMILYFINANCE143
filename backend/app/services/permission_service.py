from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.family_member import FamilyMember


OWNER_ROLES = {"OWNER", "FAMILY_OWNER"}
SPOUSE_ROLES = {"WIFE", "HUSBAND", "SPOUSE"}
CHILD_ROLES = {"CHILD", "SON", "DAUGHTER"}


# Architecture RBAC exactly 5 roles: Owner > Admin > Member > Viewer > Child
# Spouse is a relationship type, not a security role (legacy SPOUSE maps → MEMBER).
ARCHITECTURE_ROLES = frozenset({"OWNER", "ADMIN", "MEMBER", "VIEWER", "CHILD"})

PERMISSIONS = {
    "OWNER": {
        "wallet.read", "wallet.create", "wallet.update", "wallet.delete",
        "transaction.read", "transaction.create", "transaction.update", "transaction.delete",
        "income.create", "expense.create", "transfer.create",
        "savings.read", "savings.create", "savings.deposit", "savings.withdraw",
        "loan.read", "loan.create", "loan.payment",
        "budget.read", "budget.create",
        "recurring.read", "recurring.create", "recurring.post",
        "goal.read", "goal.create", "goal.contribute", "goal.withdraw",
        "report.read", "dashboard.read", "notification.read", "audit.read",
        "member.read", "member.invite", "member.approve", "member.permission",
        "settings.manage",
        "backup.create",
        "backup.read",
        "backup.download",
        "backup.restore",
    },
    "ADMIN": {
        "wallet.read", "wallet.create", "wallet.update",
        "transaction.read", "transaction.create", "transaction.update",
        "income.create", "expense.create", "transfer.create",
        "savings.read", "savings.create", "savings.deposit", "savings.withdraw",
        "loan.read", "loan.create", "loan.payment",
        "budget.read", "budget.create",
        "recurring.read", "recurring.create", "recurring.post",
        "goal.read", "goal.create", "goal.contribute",
        "report.read", "dashboard.read", "notification.read", "audit.read",
        "member.read", "member.invite", "member.approve", "member.permission",
        "settings.manage",
        "backup.read", "backup.create", "backup.download",
    },
    "MEMBER": {
        "wallet.read", "transaction.read", "transaction.create",
        "income.create", "expense.create", "transfer.create",
        "savings.read", "savings.deposit", "savings.withdraw",
        "loan.read", "budget.read", "budget.create",
        "recurring.read", "goal.read", "goal.contribute",
        "report.read", "dashboard.read", "notification.read",
    },
    "VIEWER": {
        "wallet.read", "transaction.read", "report.read", "dashboard.read", "notification.read",
    },
    "CHILD": {
        "wallet.read", "transaction.read", "expense.create",
        "savings.read", "goal.read", "budget.read", "dashboard.read", "notification.read",
    },
}


def normalize_role(role: str | None) -> str:
    if not role:
        return "MEMBER"

    value = str(role).upper().strip()

    if value in OWNER_ROLES:
        return "OWNER"
    if value == "ADMIN":
        return "ADMIN"
    if value == "VIEWER":
        return "VIEWER"
    if value in CHILD_ROLES:
        return "CHILD"
    # Husband/Wife/Spouse are relationships — security role collapses to MEMBER
    if value in SPOUSE_ROLES or value == "SPOUSE":
        return "MEMBER"

    return "MEMBER"


def get_base_permissions(role: str | None):
    return sorted(PERMISSIONS.get(normalize_role(role), set()))


def merge_permission_overrides(base_permissions, extra_permissions=None, denied_permissions=None):
    permissions = set(base_permissions or [])

    if extra_permissions:
        permissions.update(extra_permissions)

    if denied_permissions:
        permissions.difference_update(denied_permissions)

    return sorted(permissions)


def get_active_member_or_403(db: Session, family_id: str, user_id: str) -> FamilyMember:
    member = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user_id,
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )

    if not member:
        raise HTTPException(status_code=403, detail="You are not an active family member")

    return member


def member_permission_override_map(overrides: list) -> dict[str, bool]:
    resolved: dict[str, bool] = {}
    for item in overrides:
        key = item.permission_key
        if item.allow:
            resolved[key] = True
        elif key not in resolved:
            resolved[key] = False
    return resolved


def effective_permission_keys(db: Session, member: FamilyMember) -> set[str]:
    from app.models.member_permission import MemberPermission

    base_permissions = set(get_base_permissions(getattr(member, "role", None)))

    overrides = (
        db.query(MemberPermission)
        .filter(
            MemberPermission.member_id == member.id,
            MemberPermission.deleted_at.is_(None),
        )
        .all()
    )

    override_map = member_permission_override_map(overrides)
    allowed_extra = {key for key, allowed in override_map.items() if allowed}
    denied = {key for key, allowed in override_map.items() if not allowed}

    role = normalize_role(getattr(member, "role", None))
    protected_denied = {
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

    if role == "OWNER":
        return base_permissions | allowed_extra

    return (base_permissions | allowed_extra) - denied - protected_denied


def has_permission(member: FamilyMember, permission: str, db: Session | None = None) -> bool:
    if db is not None:
        return permission in effective_permission_keys(db, member)

    role = normalize_role(getattr(member, "role", None))
    return permission in PERMISSIONS.get(role, set())


def require_permission(db: Session, family_id: str, user_id: str, permission: str) -> FamilyMember:
    member = get_active_member_or_403(db=db, family_id=family_id, user_id=user_id)

    if not has_permission(member, permission, db=db):
        raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")

    return member


def require_owner(db: Session, family_id: str, user_id: str) -> FamilyMember:
    member = get_active_member_or_403(db=db, family_id=family_id, user_id=user_id)

    if normalize_role(getattr(member, "role", None)) != "OWNER":
        raise HTTPException(status_code=403, detail="Owner permission required")

    return member


def require_owner_or_admin(db: Session, family_id: str, user_id: str) -> FamilyMember:
    """Architecture: Owner/Admin for invite/join/permission governance actions."""
    member = get_active_member_or_403(db=db, family_id=family_id, user_id=user_id)
    role = normalize_role(getattr(member, "role", None))
    if role not in {"OWNER", "ADMIN"}:
        raise HTTPException(status_code=403, detail="Owner or Admin permission required")
    return member

