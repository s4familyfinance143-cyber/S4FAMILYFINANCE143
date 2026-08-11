from pydantic import BaseModel, Field


class PermissionResponse(BaseModel):
    permission_key: str
    allow: bool
    scope: str


class PermissionUpdateRequest(BaseModel):
    permission_key: str = Field(min_length=2, max_length=120)
    allow: bool
    scope: str = Field(default="family", max_length=120)


class MemberPermissionSummary(BaseModel):
    member_id: str
    role: str
    effective_permissions: dict[str, bool]
