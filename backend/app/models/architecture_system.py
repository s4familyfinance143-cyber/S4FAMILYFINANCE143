"""Architecture system tables: sync_queue, sync_logs, device_registry, templates, api_logs, rate_limits."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SyncQueue(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sync_queue"

    device_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    entity_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    legacy_outbox_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class SyncLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sync_logs"

    device_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    items_synced: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)


class DeviceRegistry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "device_registry"
    __table_args__ = (
        UniqueConstraint("user_id", "device_fingerprint", name="uq_device_registry_user_fp"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    device_fingerprint: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    platform: Mapped[str | None] = mapped_column(String(40), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    legacy_sync_device_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class NotificationTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_templates"
    __table_args__ = (UniqueConstraint("type", name="uq_notification_templates_type"),)

    type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    title_bn: Mapped[str] = mapped_column(String(200), nullable=False)
    title_en: Mapped[str] = mapped_column(String(200), nullable=False)
    body_bn: Mapped[str] = mapped_column(String(500), nullable=False)
    body_en: Mapped[str] = mapped_column(String(500), nullable=False)
    variables: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list string


class ApiLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "api_logs"

    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    endpoint: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class RateLimit(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "rate_limits"
    __table_args__ = (
        UniqueConstraint("identifier", "endpoint", name="uq_rate_limits_identifier_endpoint"),
    )

    identifier: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
