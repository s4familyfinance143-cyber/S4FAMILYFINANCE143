from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )

    phone: Mapped[str | None] = mapped_column(
        String(40),
        unique=True,
        index=True,
        nullable=True,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    preferred_language: Mapped[str] = mapped_column(
        String(10),
        default="bn",
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    is_email_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    reset_password_token: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    reset_password_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    # Phase 2C auth production hardening fields
    email_verification_token_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reset_password_token_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    reset_password_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    family_memberships = relationship(
        "FamilyMember",
        back_populates="user",
    )
