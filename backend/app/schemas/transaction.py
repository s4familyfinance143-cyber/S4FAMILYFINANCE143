from decimal import Decimal
from pydantic import BaseModel, Field


class IncomeCreateRequest(BaseModel):
    family_id: str
    account_id: str
    category_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None
    client_request_id: str | None = None


class ExpenseCreateRequest(BaseModel):
    family_id: str
    account_id: str
    category_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None
    client_request_id: str | None = None


class TransferCreateRequest(BaseModel):
    family_id: str
    from_account_id: str
    to_account_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None
    client_request_id: str | None = None