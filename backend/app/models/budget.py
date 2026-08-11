from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Budget(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "budgets"

    family_id: Mapped[str] = mapped_column(
        ForeignKey("families.id"),
        index=True,
        nullable=False,
    )

    category_id: Mapped[str] = mapped_column(
        ForeignKey("categories.id"),
        index=True,
        nullable=False,
    )

    created_by_member_id: Mapped[str] = mapped_column(
        ForeignKey("family_members.id"),
        index=True,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    budget_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    spent_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        default=Decimal("0"),
        nullable=False,
    )

    currency: Mapped[str] = mapped_column(
        String(10),
        default="BDT",
        nullable=False,
    )

    period_type: Mapped[str] = mapped_column(
        String(30),
        default="MONTHLY",
        index=True,
        nullable=False,
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