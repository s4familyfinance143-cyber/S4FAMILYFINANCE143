from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Phase16Item(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """DEPRECATED: prefer dedicated tables (subscriptions/documents/properties).

    Kept for facade + dual-write bridge. Prefer /api/v1/documents upload paths.
    """

    __tablename__ = "phase16_items"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)

    module_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    sub_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    secondary_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    renewal_or_expiry_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    secondary_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    billing_cycle: Mapped[str | None] = mapped_column(String(20), nullable=True)
    payment_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    file_size: Mapped[int | None] = mapped_column(nullable=True)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_encrypted: Mapped[bool] = mapped_column(default=False, nullable=False)
