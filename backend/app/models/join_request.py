from sqlalchemy import ForeignKey, String, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class JoinRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "join_requests"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    invite_code_id: Mapped[str] = mapped_column(ForeignKey("invite_codes.id"), nullable=False)

    requested_role: Mapped[str] = mapped_column(String(40), default="MEMBER", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="PENDING", index=True, nullable=False)

    requested_relationship_type_id: Mapped[str | None] = mapped_column(
        ForeignKey("relationship_types.id"),
        nullable=True,
    )
    requested_relationship_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    requested_relationship_serial: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requested_serial_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    requested_linked_member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), nullable=True)
    requested_relationship_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    reviewed_by_member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
