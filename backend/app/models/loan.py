from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Loan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loans"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    owner_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    wallet_account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=False)

    loan_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    person_name: Mapped[str] = mapped_column(String(150), nullable=False)

    principal_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    remaining_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    interest_rate: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"), nullable=False)
    interest_type: Mapped[str] = mapped_column(String(20), default="NONE", nullable=False)
    installment_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    installment_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    start_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    next_due_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(30), nullable=True)

    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="ACTIVE", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
