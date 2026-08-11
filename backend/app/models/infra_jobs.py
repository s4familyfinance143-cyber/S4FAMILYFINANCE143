"""Infrastructure tables for queued email, exports, and reminders."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class EmailOutbox(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "email_outbox"

    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    to_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PushOutbox(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "push_outbox"

    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    notification_id: Mapped[str | None] = mapped_column(ForeignKey("notifications.id"), index=True, nullable=True)
    fcm_token_preview: Mapped[str | None] = mapped_column(String(40), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExportJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "export_jobs"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    report_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    format: Mapped[str] = mapped_column(String(20), default="xlsx", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True, nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)


class ReminderSchedule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "reminder_schedules"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    channel: Mapped[str] = mapped_column(String(40), default="PUSH", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="SCHEDULED", index=True, nullable=False)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
