from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class RecurringCreateRequest(BaseModel):
    family_id: str
    account_id: str
    category_id: str | None = None
    title: str
    transaction_type: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    frequency: str
    start_date: date
    end_date: date | None = None
    description: str | None = None


class RecurringUpdateRequest(BaseModel):
    family_id: str
    title: str
    amount: Decimal = Field(gt=0)
    frequency: str
    end_date: date | None = None
    description: str | None = None


class RecurringStatusRequest(BaseModel):
    family_id: str


class RecurringHistoryRequest(BaseModel):
    family_id: str