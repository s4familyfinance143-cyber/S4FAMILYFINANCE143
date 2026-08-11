from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuthSession(Base):
    """DEPRECATED alias: prefer refresh_tokens + device_sessions (architecture checklist).

    Still written by auth flows; architecture_bridge dual-writes checklist tables.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    token_family: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="ACTIVE", index=True)

    issued_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    replaced_by_session_id: Mapped[str | None] = mapped_column(String, nullable=True)

    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    user = relationship("User")

    __table_args__ = (
        Index("ix_auth_sessions_user_status", "user_id", "status"),
        Index("ix_auth_sessions_family", "token_family"),
        Index("ix_auth_sessions_expires", "expires_at"),
    )
