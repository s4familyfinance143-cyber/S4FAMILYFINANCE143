from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"

    family_id: Mapped[str] = mapped_column(
        ForeignKey("families.id"),
        index=True,
        nullable=False,
    )

    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"),
        index=True,
        nullable=True,
    )

    member_id: Mapped[str | None] = mapped_column(
        ForeignKey("family_members.id"),
        index=True,
        nullable=True,
    )

    notification_type: Mapped[str] = mapped_column(
        String(50),
        index=True,
        nullable=False,
    )

    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )

    message: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    severity: Mapped[str] = mapped_column(
        String(20),
        default="INFO",
        index=True,
        nullable=False,
    )

    is_read: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="ACTIVE",
        index=True,
        nullable=False,
    )