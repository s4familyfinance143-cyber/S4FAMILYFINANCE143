from decimal import Decimal

from pydantic import BaseModel, Field


class BudgetCreateRequest(BaseModel):
    family_id: str
    category_id: str
    name: str = Field(min_length=1, max_length=150)
    budget_amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    period_type: str = "MONTHLY"
    note: str | None = None


class BudgetUpdateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    budget_amount: Decimal = Field(gt=0)
    note: str | None = None


class BudgetCloseRequest(BaseModel):
    family_id: str
    reason: str | None = None