from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class FamilyMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "family_members"

    __table_args__ = (
        UniqueConstraint("family_id", "user_id", name="uq_family_member_user"),
    )

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)

    role: Mapped[str] = mapped_column(String(40), default="MEMBER", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="ACTIVE", index=True, nullable=False)

    relationship_type_id: Mapped[str | None] = mapped_column(
        ForeignKey("relationship_types.id"),
        nullable=True,
    )
    relationship_serial: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relationship_display_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    linked_member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), nullable=True)
    relationship_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    invited_by_member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), nullable=True)

    can_login_family: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    family = relationship("Family", back_populates="members", foreign_keys=[family_id])
    user = relationship("User", back_populates="family_memberships")
    relationship_type = relationship("RelationshipType")
