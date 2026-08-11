from pydantic import BaseModel, Field


class InviteCodeCreateRequest(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=1, ge=1, le=100)
    invitee_email: str | None = Field(default=None, max_length=255)
    send_email: bool = False


class InviteEmailRequest(BaseModel):
    invitee_email: str = Field(min_length=5, max_length=255)
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=1, ge=1, le=100)
    relationship_hint: str | None = Field(default=None, max_length=80)


class InviteLinkRequest(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=5, ge=1, le=100)
    invitee_email: str | None = Field(default=None, max_length=255)


class InviteCodeResponse(BaseModel):
    invite_id: str | None = None
    invite_code: str
    expires_in_days: int
    max_uses: int
    status: str | None = "ACTIVE"
    invite_channel: str | None = "CODE"
    invitee_email: str | None = None
    invite_link: str | None = None
    email_sent: bool | None = None
    email_reason: str | None = None


class JoinByCodeRequest(BaseModel):
    invite_code: str = Field(min_length=4, max_length=100)
    relationship_type: str = Field(min_length=2, max_length=80)
    relationship_serial: int | None = None


class JoinRequestResponse(BaseModel):
    request_id: str
    status: str
    message: str
