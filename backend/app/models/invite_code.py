from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InviteCode(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "invite_codes"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)

    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), nullable=False)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    status: Mapped[str] = mapped_column(String(40), default="ACTIVE", index=True, nullable=False)
    invitee_email: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    invite_link_token: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    invite_channel: Mapped[str] = mapped_column(String(40), default="CODE", nullable=False)
    raw_code_hint: Mapped[str | None] = mapped_column(String(80), nullable=True)
