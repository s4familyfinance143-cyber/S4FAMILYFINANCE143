from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TransactionLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "transaction_lines"

    transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"), index=True, nullable=False)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=True)

    line_type: Mapped[str] = mapped_column(String(40), nullable=False)
    debit: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    credit: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)

    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
