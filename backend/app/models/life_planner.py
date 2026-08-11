from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class FamilyTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "family_tasks"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    assigned_to_member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="OPEN", index=True, nullable=False)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CalendarEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "family_calendar_events"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    start_time: Mapped[str | None] = mapped_column(String(10), nullable=True)  # HH:MM
    end_time: Mapped[str | None] = mapped_column(String(10), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40), default="GENERAL", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="SCHEDULED", index=True, nullable=False)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OwnershipTransferRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ownership_transfer_requests"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    from_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    to_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    # PENDING_ADMIN → PENDING_ACCEPT → ACCEPTED | CANCELLED | REJECTED
    status: Mapped[str] = mapped_column(String(30), default="PENDING_ADMIN", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    admin_approved_by_member_id: Mapped[str | None] = mapped_column(
        ForeignKey("family_members.id"),
        index=True,
        nullable=True,
    )
