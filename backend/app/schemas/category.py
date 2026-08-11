from pydantic import BaseModel, Field


class CategoryCreateRequest(BaseModel):
    family_id: str
    name_bn: str = Field(min_length=2, max_length=120)
    name_en: str = Field(min_length=2, max_length=120)
    category_type: str = Field(min_length=2, max_length=40)
    parent_id: str | None = None
    icon: str | None = None
    color: str | None = None


class CategoryResponse(BaseModel):
    id: str
    family_id: str | None
    parent_id: str | None
    name_bn: str
    name_en: str
    category_type: str
    icon: str | None
    color: str | None
    is_system: bool
    is_active: bool

    model_config = {"from_attributes": True}
