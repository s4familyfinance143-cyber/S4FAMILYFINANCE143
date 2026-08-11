from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class CurrencyCreate(BaseModel):
    code: str = Field(min_length=3, max_length=10)
    name: str
    symbol: str | None = None
    decimal_places: int = 2


class ExchangeRateCreate(BaseModel):
    from_currency: str = Field(min_length=3, max_length=10)
    to_currency: str = Field(min_length=3, max_length=10)
    rate: Decimal
    rate_date: date
    source: str | None = None


class ConvertAmountRequest(BaseModel):
    amount: Decimal
    from_currency: str
    to_currency: str
    rate_date: date | None = None
