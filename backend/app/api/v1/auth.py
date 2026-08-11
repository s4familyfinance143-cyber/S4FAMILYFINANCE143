from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import settings
from app.core.dependencies import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.core.auth_cookies import clear_refresh_cookie, read_refresh_token, set_refresh_cookie
from app.core.field_encryption import encrypt_field
from app.models.user import User
from app.models.family_member import FamilyMember
from app.schemas.auth import (
    AuthTokenResponse,
    EmailStatusResponse,
    EmailVerifyRequest,
    EmailVerifyResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LogoutRequest,
    MessageResponse,
    RefreshTokenRequest,
    ResendEmailVerificationRequest,
    ResendEmailVerificationResponse,
    ResetPasswordRequest,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
)
from app.services.auth_security_service import AuthSecurityService
from app.services.avatar_service import (
    avatar_url_for,
    delete_avatar,
    find_avatar_file,
    save_avatar,
)
from app.services.email_service import (
    is_smtp_configured,
    send_email_verification_email,
    send_password_reset_email,
    smtp_status,
)
from app.core.rate_limit import (
    AUTH_LOGIN_LIMIT,
    AUTH_PASSWORD_EMAIL_LIMIT,
    AUTH_REGISTER_LIMIT,
    limiter,
)


router = APIRouter(prefix="/auth", tags=["Auth"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_email(email: str) -> str:
    return str(email).strip().lower()


def get_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def get_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def get_device_label(request: Request) -> str:
    """Stable device fingerprint for device_sessions + unknown-device alerts."""
    import hashlib

    explicit = (
        request.headers.get("x-device-id")
        or request.headers.get("x-device-fingerprint")
        or request.headers.get("x-client-device")
    )
    if explicit:
        return str(explicit).strip()[:120]
    ua = get_user_agent(request) or "unknown"
    return hashlib.sha256(ua.encode("utf-8")).hexdigest()[:40]


def primary_family_claims(db: Session, user_id: str) -> tuple[str | None, str | None]:
    member = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.user_id == user_id,
            FamilyMember.deleted_at.is_(None),
            FamilyMember.status == "ACTIVE",
        )
        .order_by(FamilyMember.created_at.asc())
        .first()
    )
    if not member:
        return None, None
    return str(member.family_id), str(member.role or "MEMBER")


def get_requested_new_password(payload: ResetPasswordRequest) -> str:
    new_password = payload.new_password or payload.password
    if not new_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="new_password is required",
        )
    return new_password


def to_user_response(user: User) -> UserResponse:
    from app.core.field_encryption import decrypt_field

    base = UserResponse.model_validate(user)
    phone = decrypt_field(user.phone) if user.phone else None
    return base.model_copy(update={"avatar_url": avatar_url_for(user.id), "phone": phone})


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(AUTH_REGISTER_LIMIT)
def register_user(
    payload: UserRegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    full_name = payload.full_name.strip()

    password_errors = AuthSecurityService.validate_password_strength(
        payload.password,
        email=email,
        full_name=full_name,
    )
    if password_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"password_errors": password_errors},
        )

    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if payload.phone:
        from app.core.field_encryption import encrypt_field

        phone_enc = encrypt_field(payload.phone)
        existing_phone = db.query(User).filter(User.phone == phone_enc).first()
        if existing_phone:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phone already registered")

    user = User(
        full_name=full_name,
        email=email,
        phone=phone_enc if payload.phone else None,
        password_hash=hash_password(payload.password),
        preferred_language="bn",
        is_active=True,
        # Local/dev: allow login without SMTP verification. Production still requires verify.
        is_email_verified=not settings.IS_PRODUCTION,
    )

    if not user.is_email_verified:
        AuthSecurityService.issue_email_verification_token(user)

    db.add(user)
    db.commit()
    db.refresh(user)

    return to_user_response(user)


@router.post("/verify-email", response_model=EmailVerifyResponse)
def verify_email(
    payload: EmailVerifyRequest,
    db: Session = Depends(get_db),
):
    user = AuthSecurityService.verify_email_token(db, payload.token)
    if not user:
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired email verification token",
        )

    db.commit()
    db.refresh(user)

    return EmailVerifyResponse(
        message="Email verified successfully",
        user=to_user_response(user),
    )


@router.get("/email-status", response_model=EmailStatusResponse)
def auth_email_status():
    status_info = smtp_status()
    can_send = bool(status_info["configured"] and settings.AUTH_EMAIL_ENABLED)
    note = (
        "SMTP ready — auth emails will be sent for real."
        if can_send
        else "SMTP not configured. Set SMTP_HOST + SMTP_FROM_EMAIL in backend .env (no fake send)."
    )
    return EmailStatusResponse(
        smtp=status_info,
        auth_email_enabled=bool(settings.AUTH_EMAIL_ENABLED),
        notification_email_enabled=bool(settings.NOTIFICATION_EMAIL_ENABLED),
        can_send=can_send,
        note=note,
    )


@router.post("/resend-verification", response_model=ResendEmailVerificationResponse)
@limiter.limit(AUTH_PASSWORD_EMAIL_LIMIT)
def resend_email_verification(
    payload: ResendEmailVerificationRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    safe_message = "If this email exists and is not verified, a verification token has been created."

    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        return ResendEmailVerificationResponse(message=safe_message, verification_token=None, email_delivery=None)

    if user.is_email_verified:
        return ResendEmailVerificationResponse(
            message="Email is already verified",
            verification_token=None,
            email_delivery=None,
        )

    raw_token = AuthSecurityService.issue_email_verification_token(user)
    delivery = send_email_verification_email(to_email=user.email, token=raw_token)
    db.commit()

    message = safe_message
    if delivery.sent:
        message = "Verification email sent."
    elif is_smtp_configured():
        message = f"Verification token created, but email was not sent: {delivery.reason}"
    else:
        message = "Verification token created. SMTP not configured — email was not sent."

    return ResendEmailVerificationResponse(
        message=message,
        verification_token=None if settings.IS_PRODUCTION else raw_token,
        email_delivery=delivery.as_dict(),
    )


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
@limiter.limit(AUTH_PASSWORD_EMAIL_LIMIT)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    safe_message = "If this email exists, a password reset token has been created."

    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        return ForgotPasswordResponse(message=safe_message, reset_token=None, email_delivery=None)

    raw_token = AuthSecurityService.issue_password_reset_token(user)
    delivery = send_password_reset_email(to_email=user.email, token=raw_token)
    db.commit()

    message = safe_message
    if delivery.sent:
        message = "Password reset email sent."
    elif is_smtp_configured():
        message = f"Reset token created, but email was not sent: {delivery.reason}"
    else:
        message = "Reset token created. SMTP not configured — email was not sent."

    return ForgotPasswordResponse(
        message=message,
        reset_token=None if settings.IS_PRODUCTION else raw_token,
        email_delivery=delivery.as_dict(),
    )


@router.post("/login", response_model=AuthTokenResponse)
@limiter.limit(AUTH_LOGIN_LIMIT)
def login_user(
    payload: UserLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if AuthSecurityService.is_user_locked(user):
        raise HTTPException(
            status_code=423,
            detail="Account temporarily locked. Try again later.",
        )

    if not verify_password(payload.password, user.password_hash):
        AuthSecurityService.record_failed_login(user)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    if not user.is_email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email verification required before login",
        )

    AuthSecurityService.record_successful_login(user, ip_address=get_client_ip(request))

    try:
        from app.services.architecture_bridge import ensure_user_preference

        ensure_user_preference(db, user)
    except Exception:
        pass

    device_label = get_device_label(request)
    bundle = AuthSecurityService.create_refresh_session(
        db,
        user_id=user.id,
        user_agent=get_user_agent(request),
        ip_address=get_client_ip(request),
        device_label=device_label,
    )

    family_id, role = primary_family_claims(db, user.id)
    access_token = create_access_token(
        subject=user.id,
        user_id=user.id,
        family_id=family_id,
        role=role,
    )

    db.commit()
    db.refresh(user)

    set_refresh_cookie(response, bundle.refresh_token)
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=bundle.refresh_token,  # also returned for mobile SecureStore
        user=to_user_response(user),
    )


@router.post("/refresh", response_model=AuthTokenResponse)
def refresh_access_token(
    request: Request,
    response: Response,
    payload: RefreshTokenRequest | None = None,
    db: Session = Depends(get_db),
):
    body_token = payload.refresh_token if payload else None
    raw = read_refresh_token(request, body_token)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required (cookie or body)",
        )

    bundle = AuthSecurityService.rotate_refresh_session(
        db,
        raw_refresh_token=raw,
        user_agent=get_user_agent(request),
        ip_address=get_client_ip(request),
        device_label=get_device_label(request),
    )

    if bundle is None:
        db.commit()
        clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user = db.query(User).filter(User.id == bundle.session.user_id).first()
    if not user or not user.is_active:
        db.commit()
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    family_id, role = primary_family_claims(db, user.id)
    access_token = create_access_token(
        subject=user.id,
        user_id=user.id,
        family_id=family_id,
        role=role,
    )

    db.commit()
    db.refresh(user)

    set_refresh_cookie(response, bundle.refresh_token)
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=bundle.refresh_token,
        user=to_user_response(user),
    )


@router.post("/logout", response_model=MessageResponse)
def logout_user(
    request: Request,
    response: Response,
    payload: LogoutRequest | None = None,
    db: Session = Depends(get_db),
):
    import hashlib
    from datetime import datetime, timezone

    from app.core.config import settings
    from app.core.security import decode_token
    from app.services.redis_session import blacklist_jti, blacklist_token_hash, session_delete

    body_refresh = payload.refresh_token if payload else None
    raw = read_refresh_token(request, body_refresh)
    if raw:
        AuthSecurityService.revoke_refresh_session(
            db,
            raw_refresh_token=raw,
            reason="LOGOUT",
        )
    access = payload.access_token if payload else None
    if access:
        token_hash = hashlib.sha256(access.encode("utf-8")).hexdigest()
        ttl = max(60, int(settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60)
        try:
            decoded = decode_token(access)
            jti = decoded.get("jti")
            if jti:
                blacklist_jti(jti, ttl)
            exp = decoded.get("exp")
            if exp:
                remaining = int(exp - datetime.now(timezone.utc).timestamp())
                ttl = max(60, remaining)
        except Exception:
            pass
        blacklist_token_hash(token_hash, ttl)
        session_delete(token_hash)
    db.commit()
    clear_refresh_cookie(response)
    return MessageResponse(message="Logged out successfully")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    new_password = get_requested_new_password(payload)

    user = AuthSecurityService.consume_password_reset_token(db, payload.token)
    if not user:
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    password_errors = AuthSecurityService.validate_password_strength(
        new_password,
        email=user.email,
        full_name=user.full_name,
    )
    if password_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"password_errors": password_errors},
        )

    user.password_hash = hash_password(new_password)
    user.password_changed_at = utc_now()

    AuthSecurityService.revoke_all_user_sessions(
        db,
        user_id=user.id,
        reason="PASSWORD_RESET",
    )

    db.commit()

    return MessageResponse(message="Password reset successfully")


@router.get("/me", response_model=UserResponse)
def read_me(current_user: User = Depends(get_current_user)):
    return to_user_response(current_user)


@router.get("/avatar/{user_id}")
def get_user_avatar(user_id: str, current_user: User = Depends(get_current_user)):
    # Architecture: no public direct file access — authenticated only
    if current_user.id != user_id:
        # Allow only self for now (family-shared avatars can expand later)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Avatar access denied")
    path = find_avatar_file(user_id)
    if not path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar not found")
    media = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media)


@router.post("/me/avatar", response_model=UserResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    await save_avatar(current_user.id, file)
    return to_user_response(current_user)


@router.delete("/me/avatar", response_model=UserResponse)
def remove_my_avatar(current_user: User = Depends(get_current_user)):
    delete_avatar(current_user.id)
    return to_user_response(current_user)
