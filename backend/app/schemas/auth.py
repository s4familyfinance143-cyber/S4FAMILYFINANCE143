from pydantic import BaseModel, EmailStr, Field


class UserRegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    phone: str = Field(min_length=8, max_length=40)
    password: str = Field(min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    phone: str | None
    preferred_language: str
    is_active: bool
    is_email_verified: bool
    is_phone_verified: bool = False
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: UserResponse


class RefreshTokenRequest(BaseModel):
    """Body optional when HttpOnly cookie carries the refresh token."""

    refresh_token: str | None = Field(default=None, min_length=20)


class LogoutRequest(BaseModel):
    refresh_token: str | None = Field(default=None, min_length=20)
    access_token: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_token: str | None = None
    email_delivery: dict | None = None


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class EmailVerifyRequest(BaseModel):
    token: str = Field(min_length=10)


class ResendEmailVerificationRequest(BaseModel):
    email: EmailStr


class MessageResponse(BaseModel):
    message: str


class EmailVerifyResponse(BaseModel):
    message: str
    user: UserResponse | None = None


class ResendEmailVerificationResponse(BaseModel):
    message: str
    verification_token: str | None = None
    email_delivery: dict | None = None


class EmailStatusResponse(BaseModel):
    smtp: dict
    auth_email_enabled: bool
    notification_email_enabled: bool
    can_send: bool
    note: str
    mobile: dict | None = None


class RegisterPendingResponse(BaseModel):
    message: str
    email: EmailStr
    verification_required: bool = True
    delivered_via: list[str] = []
    otp_ttl_seconds: int | None = None
    # Dev-only: never set in production
    debug_otp: str | None = None


class OtpVerifyRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=8)


class ResendOtpRequest(BaseModel):
    email: EmailStr


class OtpRequestResponse(BaseModel):
    message: str
    delivered_via: list[str] = []
    otp_ttl_seconds: int | None = None
    debug_otp: str | None = None


class LoginOtpRequest(BaseModel):
    email: EmailStr


class DeleteAccountConfirmRequest(BaseModel):
    otp: str = Field(min_length=4, max_length=8)
