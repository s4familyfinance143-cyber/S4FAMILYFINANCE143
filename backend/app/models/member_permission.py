from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class MemberPermission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "member_permissions"

    __table_args__ = (
        UniqueConstraint("member_id", "permission_key", "scope", name="uq_member_permission_scope"),
    )

    member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    permission_key: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    allow: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope: Mapped[str] = mapped_column(String(120), default="family", nullable=False)
