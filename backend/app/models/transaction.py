from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Transaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "transactions"

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

    category_id: Mapped[str | None] = mapped_column(
        ForeignKey("categories.id"),
        index=True,
        nullable=True,
    )

    loan_id: Mapped[str | None] = mapped_column(
        ForeignKey("loans.id"),
        index=True,
        nullable=True,
    )

    goal_id: Mapped[str | None] = mapped_column(
        ForeignKey("financial_goals.id"),
        index=True,
        nullable=True,
    )

    transaction_type: Mapped[str] = mapped_column(
        String(40),
        index=True,
        nullable=False,
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4),
        nullable=False,
    )

    currency: Mapped[str] = mapped_column(
        String(10),
        default="BDT",
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(40),
        default="POSTED",
        index=True,
        nullable=False,
    )

    # Offline / sync idempotency key (unique per family when set)
    client_request_id: Mapped[str | None] = mapped_column(
        String(120),
        index=True,
        nullable=True,
    )

    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_split: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)