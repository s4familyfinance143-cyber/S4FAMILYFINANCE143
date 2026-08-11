from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ZakatRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "zakat_records"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)

    calculation_year: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)

    cash_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    gold_value: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    silver_value: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    investment_value: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    business_assets: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    receivables: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    deductible_debts: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    nisab_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    zakatable_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    zakat_due: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="CALCULATED", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
