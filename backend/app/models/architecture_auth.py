"""Architecture checklist tables: user_preferences, refresh_tokens, device_sessions, push_tokens."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserPreference(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_preferences"
    __table_args__ = (UniqueConstraint("user_id", name="uq_user_preferences_user"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    theme: Mapped[str] = mapped_column(String(20), default="light", nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="bn", nullable=False)
    notification_on: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)


class RefreshToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Primary refresh-token store (architecture checklist). Supersedes auth_sessions."""

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_user_revoked", "user_id", "revoked"),
        Index("ix_refresh_tokens_user_status", "user_id", "status"),
        Index("ix_refresh_tokens_family", "token_family"),
        UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    device_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    # Bridge to legacy auth_sessions row when lazily migrated via dual-read
    legacy_session_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Fields promoted from legacy AuthSession (architecture cutover)
    token_family: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    replaced_by_token_id: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_label: Mapped[str | None] = mapped_column(String(120), nullable=True)


class DeviceSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "device_sessions"
    __table_args__ = (Index("ix_device_sessions_user_active", "user_id", "last_active"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(40), nullable=True)
    fcm_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_active: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    legacy_session_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class PushToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "push_tokens"
    __table_args__ = (
        UniqueConstraint("user_id", "fcm_token", name="uq_push_tokens_user_token"),
        Index("ix_push_tokens_active", "user_id", "is_active"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    fcm_token: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String(40), default="UNKNOWN", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    legacy_push_device_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
