from datetime import date
from decimal import Decimal
from pydantic import BaseModel, Field


class GoalCreateRequest(BaseModel):
    family_id: str
    linked_savings_goal_id: str | None = None
    goal_name: str = Field(min_length=1, max_length=150)
    goal_type: str = Field(min_length=1, max_length=50)
    target_amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    target_date: date | None = None
    note: str | None = None


class GoalContributionRequest(BaseModel):
    family_id: str
    goal_id: str
    wallet_account_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None


class GoalWithdrawRequest(BaseModel):
    family_id: str
    goal_id: str
    wallet_account_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None