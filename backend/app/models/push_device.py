from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PushDevice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """DEPRECATED alias: prefer push_tokens (architecture checklist). Dual-written via bridge."""

    __tablename__ = "push_devices"
    __table_args__ = (
        UniqueConstraint("family_id", "token", name="uq_push_devices_family_token"),
    )

    family_id: Mapped[str] = mapped_column(
        ForeignKey("families.id"),
        index=True,
        nullable=False,
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )

    member_id: Mapped[str | None] = mapped_column(
        ForeignKey("family_members.id"),
        index=True,
        nullable=True,
    )

    token: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        index=True,
    )

    platform: Mapped[str] = mapped_column(
        String(40),
        default="UNKNOWN",
        nullable=False,
    )

    provider: Mapped[str] = mapped_column(
        String(40),
        default="FCM",
        nullable=False,
    )

    device_label: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
