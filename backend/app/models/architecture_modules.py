"""Architecture dedicated life-module tables (migrate from phase15/phase16)."""

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Investment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "investments"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)
    type: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    principal: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    start_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    maturity: Mapped[str | None] = mapped_column(String(30), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    legacy_phase15_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class InvestmentReturn(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "investment_returns"

    investment_id: Mapped[str] = mapped_column(ForeignKey("investments.id"), index=True, nullable=False)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    return_date: Mapped[str] = mapped_column(String(30), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class HealthExpense(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "health_expenses"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)
    type: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    doctor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    expense_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    year: Mapped[str | None] = mapped_column(String(10), index=True, nullable=True)
    legacy_phase15_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class VehicleExpense(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "vehicle_expenses"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    vehicle_name: Mapped[str] = mapped_column(String(150), nullable=False)
    vehicle_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    type: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    km_reading: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    expense_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    legacy_phase15_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class Property(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "properties"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    type: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    rent_income: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    repair_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    area: Mapped[str | None] = mapped_column(String(80), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    legacy_phase16_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    cycle: Mapped[str] = mapped_column(String(20), default="MONTHLY", nullable=False)
    next_due: Mapped[str | None] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    auto_remind: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    payment_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    legacy_phase16_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class Document(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "documents"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    type: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    expiry_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    legacy_phase16_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class EducationFund(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Architecture education module (was phase15 EDUCATION)."""

    __tablename__ = "education_funds"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    type: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    monthly_target: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    annual_target: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    year: Mapped[str | None] = mapped_column(String(10), index=True, nullable=True)
    target_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    legacy_phase15_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
