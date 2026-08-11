"""Phase 10B sync tables as ORM models aligned with offline_sync_hardened DDL."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class SyncDevice(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "sync_devices"
    __table_args__ = (UniqueConstraint("family_id", "device_id", name="uq_sync_device_family"),)

    family_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(40), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncState(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "sync_state"
    __table_args__ = (UniqueConstraint("family_id", "device_id", name="uq_sync_state_family"),)

    family_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    last_pull_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_push_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncOutbox(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "sync_outbox"

    family_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    client_change_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    operation: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncInbox(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "sync_inbox"

    family_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    sync_token: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncConflict(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "sync_conflicts"

    family_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    local_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    remote_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="OPEN", index=True, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_member_id: Mapped[str | None] = mapped_column(String, nullable=True)
