from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Family(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "families"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    main_responsible_member_id: Mapped[str | None] = mapped_column(
        ForeignKey("family_members.id"),
        nullable=True,
    )

    default_currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Dhaka", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    members = relationship(
        "FamilyMember",
        back_populates="family",
        foreign_keys="FamilyMember.family_id",
    )
