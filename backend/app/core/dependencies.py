from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.family_member import FamilyMember
from app.models.user import User
from app.services.permission_service import normalize_role, require_owner, require_permission
from app.services.redis_session import is_token_blacklisted
import hashlib

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    token = credentials.credentials
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        token_type = payload.get("type")
        jti = payload.get("jti")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if is_token_blacklisted(jti=jti, token_hash=token_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token revoked",
        )

    if not user_id or token_type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = db.get(User, user_id)

    if not user or not user.is_active or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


def require_owner_dep(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FamilyMember:
    return require_owner(db=db, family_id=family_id, user_id=current_user.id)


def require_role(role: str):
    """Depends factory: Owner > Admin > Member > Viewer > Child (architecture RBAC 5)."""

    RANK = {
        "OWNER": 50,
        "ADMIN": 40,
        "MEMBER": 30,
        "VIEWER": 20,
        "CHILD": 10,
    }
    wanted = str(role or "").upper()
    if wanted == "SPOUSE":
        wanted = "MEMBER"
    wanted_rank = RANK.get(wanted, 0)

    def _dependency(
        family_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> FamilyMember:
        from app.services.permission_service import normalize_role

        member = (
            db.query(FamilyMember)
            .filter(
                FamilyMember.family_id == family_id,
                FamilyMember.user_id == current_user.id,
                FamilyMember.deleted_at.is_(None),
                FamilyMember.status == "ACTIVE",
            )
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Not a family member")
        have = normalize_role(member.role)
        have_rank = RANK.get(have, 0)
        if have_rank < wanted_rank:
            raise HTTPException(status_code=403, detail=f"Role {wanted} or higher required")
        return member

    return _dependency


def require_permission_for_family(permission: str):
    """Depends factory using path/query `family_id`."""

    def _dependency(
        family_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> FamilyMember:
        return require_permission(
            db=db,
            family_id=family_id,
            user_id=current_user.id,
            permission=permission,
        )

    return _dependency
