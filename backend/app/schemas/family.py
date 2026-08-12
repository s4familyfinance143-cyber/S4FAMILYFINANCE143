from pydantic import BaseModel, Field, AliasChoices, model_validator


class FamilyCreateRequest(BaseModel):
    """Accept both architecture names and mobile/web client names."""

    family_name: str = Field(
        min_length=2,
        max_length=160,
        validation_alias=AliasChoices("family_name", "name"),
    )
    responsible_person_type: str = Field(
        min_length=2,
        max_length=80,
        validation_alias=AliasChoices("responsible_person_type", "relationship_type"),
    )
    currency: str = Field(
        default="BDT",
        max_length=10,
        validation_alias=AliasChoices("currency", "default_currency"),
    )
    timezone: str = Field(default="Asia/Dhaka", max_length=80)

    @model_validator(mode="before")
    @classmethod
    def _normalize_client_aliases(cls, data):
        if not isinstance(data, dict):
            return data
        out = dict(data)
        if "family_name" not in out and out.get("name"):
            out["family_name"] = out["name"]
        if "responsible_person_type" not in out and out.get("relationship_type"):
            out["responsible_person_type"] = out["relationship_type"]
        if "currency" not in out and out.get("default_currency"):
            out["currency"] = out["default_currency"]
        return out


class FamilyResponse(BaseModel):
    id: str
    name: str
    owner_user_id: str
    default_currency: str
    timezone: str
    is_active: bool

    model_config = {"from_attributes": True}
