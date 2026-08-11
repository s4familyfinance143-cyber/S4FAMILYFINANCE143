from decimal import Decimal

from pydantic import BaseModel, Field


class Phase15ItemCreateRequest(BaseModel):
    family_id: str
    module_type: str = Field(pattern="^(INVESTMENT|HEALTH|VEHICLE|EDUCATION|investment|health|vehicle|education)$")
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    sub_type: str | None = Field(default=None, max_length=80)
    provider: str | None = Field(default=None, max_length=200)
    member_id: str | None = None
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    secondary_amount: Decimal | None = Field(default=None, ge=0)
    currency: str = "BDT"
    target_date: str | None = None
    secondary_date: str | None = None
    note: str | None = None


class Phase15ItemUpdateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    sub_type: str | None = Field(default=None, max_length=80)
    provider: str | None = Field(default=None, max_length=200)
    member_id: str | None = None
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    secondary_amount: Decimal | None = Field(default=None, ge=0)
    target_date: str | None = None
    secondary_date: str | None = None
    note: str | None = None


class Phase15ItemCloseRequest(BaseModel):
    family_id: str
    reason: str | None = None
