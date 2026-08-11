from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Currency(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "currencies"

    __table_args__ = (
        UniqueConstraint("code", name="uq_currency_code"),
    )

    code: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(10), nullable=True)
    decimal_places: Mapped[int] = mapped_column(default=2, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ExchangeRate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "exchange_rates"

    __table_args__ = (
        UniqueConstraint("from_currency", "to_currency", "rate_date", name="uq_exchange_rate_day"),
    )

    from_currency: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    to_currency: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    rate_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
