from decimal import Decimal

from pydantic import BaseModel, Field


class ZakatCalculateRequest(BaseModel):
    family_id: str
    calculation_year: str = Field(min_length=1, max_length=20)
    currency: str = "BDT"
    cash_amount: Decimal = Field(default=Decimal("0"), ge=0)
    gold_value: Decimal = Field(default=Decimal("0"), ge=0)
    silver_value: Decimal = Field(default=Decimal("0"), ge=0)
    gold_grams: Decimal | None = Field(default=None, ge=0)
    silver_grams: Decimal | None = Field(default=None, ge=0)
    investment_value: Decimal = Field(default=Decimal("0"), ge=0)
    business_assets: Decimal = Field(default=Decimal("0"), ge=0)
    receivables: Decimal = Field(default=Decimal("0"), ge=0)
    deductible_debts: Decimal = Field(default=Decimal("0"), ge=0)
    nisab_amount: Decimal | None = Field(default=None, ge=0)
    nisab_metal: str | None = Field(default="SILVER", pattern="^(GOLD|SILVER|gold|silver)$")
    note: str | None = None
