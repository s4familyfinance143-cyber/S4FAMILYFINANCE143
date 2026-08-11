from decimal import Decimal

from pydantic import BaseModel, Field


class Phase16ItemCreateRequest(BaseModel):
    family_id: str
    module_type: str = Field(pattern="^(SUBSCRIPTION|DOCUMENT|PROPERTY|subscription|document|property)$")
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    sub_type: str | None = Field(default=None, max_length=80)
    provider: str | None = Field(default=None, max_length=200)
    member_id: str | None = None
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    secondary_amount: Decimal | None = Field(default=None, ge=0)
    currency: str = "BDT"
    renewal_or_expiry_date: str | None = None
    secondary_date: str | None = None
    billing_cycle: str | None = Field(default=None, max_length=20)
    payment_account_id: str | None = None
    reference: str | None = None
    note: str | None = None


class Phase16ItemUpdateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    sub_type: str | None = Field(default=None, max_length=80)
    provider: str | None = Field(default=None, max_length=200)
    member_id: str | None = None
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    secondary_amount: Decimal | None = Field(default=None, ge=0)
    renewal_or_expiry_date: str | None = None
    secondary_date: str | None = None
    billing_cycle: str | None = Field(default=None, max_length=20)
    payment_account_id: str | None = None
    reference: str | None = None
    note: str | None = None


class Phase16ItemCloseRequest(BaseModel):
    family_id: str
    reason: str | None = None
