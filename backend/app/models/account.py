from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Account(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "accounts"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    owner_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    account_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)

    opening_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    current_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)

    institution_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    account_number_masked: Mapped[str | None] = mapped_column(String(80), nullable=True)

    is_shared_family: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_owner_wallet: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # System Chart-of-Accounts rows (Salary Income, Loan Payable, …) — not spend wallets
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
