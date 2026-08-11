from decimal import Decimal

from pydantic import BaseModel, Field


class LoanCreateRequest(BaseModel):
    family_id: str
    wallet_account_id: str
    loan_type: str = Field(pattern="^(GIVEN|TAKEN|given|taken)$")
    person_name: str = Field(min_length=1, max_length=150)
    principal_amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    note: str | None = None
    interest_rate: Decimal = Field(default=Decimal("0"), ge=0)
    interest_type: str = Field(default="NONE", pattern="^(NONE|FLAT|REDUCING|none|flat|reducing)$")
    installment_count: int | None = Field(default=None, ge=1, le=360)
    start_date: str | None = None


class LoanPaymentRequest(BaseModel):
    family_id: str
    loan_id: str
    wallet_account_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None


class LoanCloseRequest(BaseModel):
    family_id: str
    reason: str | None = None


class LoanUpdateRequest(BaseModel):
    family_id: str
    person_name: str = Field(min_length=1, max_length=150)
    note: str | None = None


class LoanScheduleGenerateRequest(BaseModel):
    family_id: str
    installment_count: int | None = Field(default=None, ge=1, le=360)
    interest_rate: Decimal | None = Field(default=None, ge=0)
    interest_type: str | None = None
    start_date: str | None = None
