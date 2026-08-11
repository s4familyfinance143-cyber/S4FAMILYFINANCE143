from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RecurringTransaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "recurring_transactions"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=False)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), index=True, nullable=True)

    title: Mapped[str] = mapped_column(String(150), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)

    frequency: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    next_due_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)