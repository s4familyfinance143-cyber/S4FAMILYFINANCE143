"""Architecture dual-write bridges: auth → refresh/device/push."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.architecture_auth import PushToken, UserPreference
from app.models.push_device import PushDevice
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


def mirror_push_device(db: Session, device: PushDevice) -> None:
    existing = (
        db.query(PushToken)
        .filter(PushToken.legacy_push_device_id == device.id, PushToken.deleted_at.is_(None))
        .first()
    )
    if existing:
        existing.fcm_token = device.token
        existing.platform = device.platform
        existing.is_active = device.is_active
        existing.family_id = device.family_id
        existing.updated_at = _now()
        return
    db.add(
        PushToken(
            user_id=device.user_id,
            device_id=device.device_label,
            fcm_token=device.token,
            platform=device.platform or "UNKNOWN",
            is_active=device.is_active,
            family_id=device.family_id,
            legacy_push_device_id=device.id,
        )
    )


