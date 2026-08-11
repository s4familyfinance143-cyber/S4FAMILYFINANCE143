from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class FinancialGoal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "financial_goals"

    family_id: Mapped[str] = mapped_column(
        ForeignKey("families.id"),
        index=True,
        nullable=False,
    )

    created_by_member_id: Mapped[str] = mapped_column(
        ForeignKey("family_members.id"),
        index=True,
        nullable=False,
    )

    linked_savings_goal_id: Mapped[str | None] = mapped_column(
        ForeignKey("savings_goals.id"),
        index=True,
        nullable=True,
    )

    goal_name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    goal_type: Mapped[str] = mapped_column(
        String(50),
        index=True,
        nullable=False,
    )

    target_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    current_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        default=Decimal("0"),
        nullable=False,
    )

    currency: Mapped[str] = mapped_column(
        String(10),
        default="BDT",
        nullable=False,
    )

    target_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(30),
        default="ACTIVE",
        index=True,
        nullable=False,
    )

    note: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )