from pydantic import BaseModel, Field


class FamilyCreateRequest(BaseModel):
    family_name: str = Field(min_length=2, max_length=160)
    responsible_person_type: str = Field(min_length=2, max_length=80)
    currency: str = Field(default="BDT", max_length=10)
    timezone: str = Field(default="Asia/Dhaka", max_length=80)


class FamilyResponse(BaseModel):
    id: str
    name: str
    owner_user_id: str
    default_currency: str
    timezone: str
    is_active: bool

    model_config = {"from_attributes": True}
