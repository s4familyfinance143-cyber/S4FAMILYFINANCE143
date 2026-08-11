from decimal import Decimal

from pydantic import BaseModel, Field


class AccountCreateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=2, max_length=160)
    account_type: str = Field(min_length=2, max_length=40)
    currency: str = Field(default="BDT", max_length=10)
    opening_balance: Decimal = Field(default=Decimal("0"))
    institution_name: str | None = Field(default=None, max_length=160)
    account_number_masked: str | None = Field(default=None, max_length=80)
    is_shared_family: bool = True
    is_owner_wallet: bool = False


class AccountResponse(BaseModel):
    id: str
    family_id: str
    owner_member_id: str
    name: str
    account_type: str
    currency: str
    opening_balance: Decimal
    current_balance: Decimal
    institution_name: str | None
    account_number_masked: str | None
    is_shared_family: bool
    is_owner_wallet: bool
    is_active: bool
    is_system: bool = False

    model_config = {"from_attributes": True}
