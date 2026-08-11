"""Helpers to persist architecture sync_logs / device_registry / rate_limits / sync_queue."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.architecture_system import DeviceRegistry, RateLimit, SyncLog, SyncQueue


def _now() -> datetime:
    return datetime.now(timezone.utc)


def record_sync_log(
    db: Session,
    *,
    device_id: str,
    family_id: str | None,
    items_synced: int,
    success: bool,
    error_msg: str | None = None,
) -> SyncLog:
    row = SyncLog(
        device_id=device_id[:120],
        family_id=family_id,
        synced_at=_now(),
        items_synced=int(items_synced or 0),
        success=bool(success),
        error_msg=(error_msg or None)[:2000] if error_msg else None,
    )
    db.add(row)
    return row


def enqueue_architecture_sync_queue(
    db: Session,
    *,
    device_id: str,
    family_id: str | None,
    entity_type: str,
    entity_id: str | None,
    action: str,
    payload: Any = None,
    legacy_outbox_id: str | None = None,
    status: str = "PENDING",
) -> SyncQueue:
    """Dual-write architecture sync_queue alongside legacy sync_outbox."""
    import json

    if payload is None:
        payload_text = None
    elif isinstance(payload, str):
        payload_text = payload
    else:
        payload_text = json.dumps(payload, default=str)

    row = SyncQueue(
        device_id=(device_id or "default-device")[:120],
        family_id=family_id,
        entity_type=(entity_type or "unknown")[:80],
        entity_id=(str(entity_id)[:80] if entity_id else None),
        action=(action or "UPSERT")[:40],
        payload=payload_text,
        status=(status or "PENDING")[:30],
        retry_count=0,
        last_error=None,
        legacy_outbox_id=legacy_outbox_id,
    )
    db.add(row)
    return row


def finalize_architecture_sync_queue(
    db: Session,
    *,
    legacy_outbox_id: str,
    status: str,
    last_error: str | None = None,
) -> None:
    row = (
        db.query(SyncQueue)
        .filter(SyncQueue.legacy_outbox_id == legacy_outbox_id, SyncQueue.deleted_at.is_(None))
        .first()
    )
    if not row:
        return
    row.status = (status or row.status)[:30]
    if last_error:
        row.last_error = last_error[:2000]
        row.retry_count = int(row.retry_count or 0) + 1
    row.updated_at = _now()


def upsert_device_registry(
    db: Session,
    *,
    user_id: str,
    device_fingerprint: str,
    platform: str | None = None,
    app_version: str | None = None,
    family_id: str | None = None,
) -> DeviceRegistry:
    fp = (device_fingerprint or "").strip()[:120] or "unknown"
    row = (
        db.query(DeviceRegistry)
        .filter(
            DeviceRegistry.user_id == user_id,
            DeviceRegistry.device_fingerprint == fp,
            DeviceRegistry.deleted_at.is_(None),
        )
        .first()
    )
    if row:
        row.platform = platform or row.platform
        row.app_version = app_version or row.app_version
        row.family_id = family_id or row.family_id
        row.updated_at = _now()
        return row
    row = DeviceRegistry(
        user_id=user_id,
        device_fingerprint=fp,
        platform=platform,
        app_version=app_version,
        registered_at=_now(),
        family_id=family_id,
    )
    db.add(row)
    return row


def bump_rate_limit(
    db: Session,
    *,
    identifier: str,
    endpoint: str,
    limit: int,
    window_seconds: int = 60,
) -> tuple[bool, RateLimit]:
    """Returns (allowed, row). allowed=False when blocked."""
    now = _now()
    key_id = (identifier or "anon")[:120]
    ep = (endpoint or "/")[:255]
    row = (
        db.query(RateLimit)
        .filter(RateLimit.identifier == key_id, RateLimit.endpoint == ep, RateLimit.deleted_at.is_(None))
        .first()
    )
    if row and row.blocked_until and row.blocked_until > now:
        return False, row
    if row is None:
        row = RateLimit(
            identifier=key_id,
            endpoint=ep,
            count=1,
            window_start=now,
            blocked_until=None,
        )
        db.add(row)
        return True, row

    # reset window
    elapsed = (now - row.window_start).total_seconds() if row.window_start else window_seconds + 1
    if elapsed >= window_seconds:
        row.count = 1
        row.window_start = now
        row.blocked_until = None
        return True, row

    row.count = int(row.count or 0) + 1
    if row.count > limit:
        from datetime import timedelta

        row.blocked_until = now + timedelta(seconds=window_seconds)
        return False, row
    return True, row
