from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SavingsGoal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "savings_goals"

    family_id: Mapped[str] = mapped_column(
        ForeignKey("families.id"),
        index=True,
        nullable=False,
    )

    owner_member_id: Mapped[str] = mapped_column(
        ForeignKey("family_members.id"),
        index=True,
        nullable=False,
    )

    wallet_account_id: Mapped[str] = mapped_column(
        ForeignKey("accounts.id"),
        index=True,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    goal_type: Mapped[str] = mapped_column(
        String(50),
        default="GENERAL",
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

    status: Mapped[str] = mapped_column(
        String(40),
        default="ACTIVE",
        index=True,
        nullable=False,
    )

    note: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )