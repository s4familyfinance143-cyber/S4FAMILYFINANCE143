"""Architecture system APIs: user preferences, sync logs, device registry, templates."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.architecture_system import DeviceRegistry, NotificationTemplate, SyncLog
from app.models.user import User
from app.services.architecture_bridge import ensure_user_preference
from app.services.permission_service import require_permission

router = APIRouter(tags=["Architecture System"])


class UserPreferencePatch(BaseModel):
    theme: str | None = Field(default=None, max_length=20)
    language: str | None = Field(default=None, max_length=10)
    notification_on: bool | None = None
    currency: str | None = Field(default=None, max_length=10)


def _pref_out(pref) -> dict:
    return {
        "id": pref.id,
        "user_id": pref.user_id,
        "theme": pref.theme,
        "language": pref.language,
        "notification_on": pref.notification_on,
        "currency": pref.currency,
    }


@router.get("/user-preferences")
def get_user_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pref = ensure_user_preference(db, user)
    db.commit()
    db.refresh(pref)
    return _pref_out(pref)


@router.patch("/user-preferences")
def patch_user_preferences(
    payload: UserPreferencePatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    pref = ensure_user_preference(db, user)
    data = payload.model_dump(exclude_unset=True)
    for key, val in data.items():
        if val is None:
            continue
        if key == "currency" and isinstance(val, str):
            setattr(pref, key, val.upper()[:10])
        elif key == "language" and isinstance(val, str):
            setattr(pref, key, val.lower()[:10])
        elif key == "theme" and isinstance(val, str):
            setattr(pref, key, val.lower()[:20])
        else:
            setattr(pref, key, val)
    db.commit()
    db.refresh(pref)
    return _pref_out(pref)


@router.get("/sync-logs")
def list_sync_logs(
    family_id: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(SyncLog)
        .filter(SyncLog.family_id == family_id, SyncLog.deleted_at.is_(None))
        .order_by(SyncLog.synced_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [
        {
            "id": r.id,
            "device_id": r.device_id,
            "family_id": r.family_id,
            "synced_at": r.synced_at,
            "items_synced": r.items_synced,
            "success": r.success,
            "error_msg": r.error_msg,
        }
        for r in rows
    ]


@router.get("/device-registry")
def list_device_registry(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(DeviceRegistry)
        .filter(DeviceRegistry.user_id == user.id, DeviceRegistry.deleted_at.is_(None))
        .order_by(DeviceRegistry.registered_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "device_fingerprint": r.device_fingerprint,
            "platform": r.platform,
            "app_version": r.app_version,
            "registered_at": r.registered_at,
            "family_id": r.family_id,
        }
        for r in rows
    ]


@router.get("/notification-templates")
def list_notification_templates(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ = user
    rows = (
        db.query(NotificationTemplate)
        .filter(NotificationTemplate.deleted_at.is_(None))
        .order_by(NotificationTemplate.type.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "type": r.type,
            "title_bn": r.title_bn,
            "title_en": r.title_en,
            "body_bn": r.body_bn,
            "body_en": r.body_en,
            "variables": r.variables,
        }
        for r in rows
    ]
