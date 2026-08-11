from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Phase15Item(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """DEPRECATED: prefer dedicated tables (investments/health_expenses/vehicle_expenses/education_funds).

    Kept for mobile/API facade + dual-write bridge. Do not add new features here.
    """

    __tablename__ = "phase15_items"

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
    target_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    secondary_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
