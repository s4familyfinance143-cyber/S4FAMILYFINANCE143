"""Tables/columns for architecture MISSING cutover (split, loan schedule, rates, budgets)."""

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ExpenseSplit(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "expense_splits"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"), index=True, nullable=False)
    member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    share_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    share_percent: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class LoanInstallment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loan_installments"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    loan_id: Mapped[str] = mapped_column(ForeignKey("loans.id"), index=True, nullable=False)
    installment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[str] = mapped_column(String(30), nullable=False)
    principal_due: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    interest_due: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    total_due: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True, nullable=False)
    paid_at: Mapped[str | None] = mapped_column(String(30), nullable=True)


class MetalRate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "metal_rates"

    metal: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="GRAM", nullable=False)
    rate_bdt: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    effective_date: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    source: Mapped[str | None] = mapped_column(String(80), nullable=True)


class Vehicle(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "vehicles"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(80), default="CAR", nullable=False)
    registration_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    current_km: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class HealthAnnualBudget(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "health_annual_budgets"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=True)
    year: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    spent_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class PropertyRepair(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "property_repairs"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    repair_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
