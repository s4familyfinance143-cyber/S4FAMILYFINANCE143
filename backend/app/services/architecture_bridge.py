"""Architecture dual-write bridges: auth → user preferences."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.architecture_auth import UserPreference
from app.models.user import User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_user_preference(db: Session, user: User) -> UserPreference:
    pref = db.query(UserPreference).filter(UserPreference.user_id == user.id, UserPreference.deleted_at.is_(None)).first()
    if pref:
        return pref
    pref = UserPreference(
        user_id=user.id,
        language=user.preferred_language or "bn",
        theme="light",
        notification_on=True,
        currency="BDT",
    )
    db.add(pref)
    return pref
