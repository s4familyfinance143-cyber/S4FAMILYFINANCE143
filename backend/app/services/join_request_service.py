"""Join-request lifecycle: expire stale PENDING rows when invite is dead."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.invite_code import InviteCode
from app.models.join_request import JoinRequest


def expire_stale_join_requests(db: Session, family_id: str, *, commit: bool = True) -> int:
    """Mark PENDING join requests EXPIRED when invite is expired/revoked/used-up or past expires_at."""
    now = datetime.now(timezone.utc)
    pending = (
        db.query(JoinRequest)
        .filter(
            JoinRequest.family_id == family_id,
            JoinRequest.status == "PENDING",
            JoinRequest.deleted_at.is_(None),
        )
        .all()
    )
    changed = 0
    for item in pending:
        invite = db.get(InviteCode, item.invite_code_id) if item.invite_code_id else None
        expired = False
        if invite is None:
            expired = True
        else:
            status = str(invite.status or "").upper()
            if status in {"REVOKED", "EXPIRED", "USED", "INACTIVE"}:
                expired = True
            exp = getattr(invite, "expires_at", None)
            if exp is not None:
                if getattr(exp, "tzinfo", None) is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < now:
                    expired = True
                    if status == "ACTIVE":
                        invite.status = "EXPIRED"
        if expired:
            item.status = "EXPIRED"
            changed += 1
    if changed and commit:
        db.commit()
    return changed
