from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Transaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "transactions"

    # client_request_id dedup (finance_posting.find_by_client_request_id) was
    # application-layer only: two concurrent requests with the same key (a
    # retried offline-sync push, or a double-tap submit before the button
    # disables) could both pass the "not found yet" check and both insert,
    # creating a duplicate money posting. NULLs are not compared equal by
    # UNIQUE in SQLite/Postgres, so rows without a client_request_id are
    # unaffected.
    __table_args__ = (
        UniqueConstraint(
            "family_id", "client_request_id", name="uq_transactions_family_client_request_id"
        ),
    )

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