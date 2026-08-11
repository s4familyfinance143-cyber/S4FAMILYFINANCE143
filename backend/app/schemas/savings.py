from decimal import Decimal

from pydantic import BaseModel, Field


class SavingsGoalCreateRequest(BaseModel):
    family_id: str
    wallet_account_id: str
    name: str = Field(min_length=1, max_length=150)
    goal_type: str = "GENERAL"
    target_amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    note: str | None = None


class SavingsGoalUpdateRequest(BaseModel):
    family_id: str
    name: str | None = Field(default=None, min_length=1, max_length=150)
    target_amount: Decimal | None = Field(default=None, gt=0)
    note: str | None = None


class SavingsGoalCloseRequest(BaseModel):
    family_id: str
    reason: str | None = None


class SavingsDepositRequest(BaseModel):
    family_id: str
    savings_goal_id: str
    from_account_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None


class SavingsWithdrawRequest(BaseModel):
    family_id: str
    savings_goal_id: str
    to_account_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None