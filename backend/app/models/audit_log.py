from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class AuditLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "audit_logs"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)

    action_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    severity: Mapped[str] = mapped_column(String(30), default="INFO", index=True, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(100), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
