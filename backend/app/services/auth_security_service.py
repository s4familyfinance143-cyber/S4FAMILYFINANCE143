from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.architecture_auth import DeviceSession, RefreshToken
from app.models.auth_session import AuthSession
from app.models.user import User


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _naive(value: datetime | None) -> datetime | None:
    """Normalize any datetime to naive-UTC so comparisons never fail on tz-mixing."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


@dataclass(frozen=True)
class RefreshSessionBundle:
    refresh_token: str
    session: RefreshToken


class AuthSecurityService:
    """Production auth security helper.

    Rules:
    - Raw refresh/reset/email tokens are returned once only.
    - Database stores token hashes only.
    - PRIMARY store is RefreshToken + DeviceSession (app.models.architecture_auth).
      Refresh token rotation revokes the old row and creates a new one.
    - Logout revokes the active refresh token.
    - AuthSession (legacy) is no longer written to. A dual-read fallback lazily
      migrates any still-active legacy row into RefreshToken the first time it's seen.
    """

    ACTIVE = "ACTIVE"
    ROTATED = "ROTATED"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"

    @staticmethod
    def generate_secure_token(byte_count: int | None = None) -> str:
        size = byte_count or settings.AUTH_REFRESH_TOKEN_BYTES
        return secrets.token_urlsafe(size)

    @staticmethod
    def hash_token(raw_token: str) -> str:
        if not raw_token:
            raise ValueError("raw_token is required")
        secret = settings.JWT_SECRET_KEY.encode("utf-8")
        return hmac.new(secret, raw_token.encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def constant_time_equals(raw_token: str, token_hash: str) -> bool:
        return hmac.compare_digest(AuthSecurityService.hash_token(raw_token), token_hash)

    @staticmethod
    def validate_password_strength(
        password: str,
        *,
        email: str | None = None,
        full_name: str | None = None,
    ) -> list[str]:
        errors: list[str] = []

        if len(password or "") < 8:
            errors.append("Password must be at least 8 characters long.")
        if not any(ch.islower() for ch in password):
            errors.append("Password must contain a lowercase letter.")
        if not any(ch.isupper() for ch in password):
            errors.append("Password must contain an uppercase letter.")
        if not any(ch.isdigit() for ch in password):
            errors.append("Password must contain a number.")
        if not any(not ch.isalnum() for ch in password):
            errors.append("Password must contain a special character.")

        low = (password or "").lower()
        if email:
            local = email.split("@")[0].lower()
            if local and len(local) >= 3 and local in low:
                errors.append("Password must not contain the email name.")
        if full_name:
            for part in full_name.lower().split():
                if len(part) >= 3 and part in low:
                    errors.append("Password must not contain the user's name.")

        return errors

    @staticmethod
    def _upsert_device_session(
        db: Session,
        *,
        user_id: str,
        device_label: str | None,
        platform: str | None,
        user_agent: str | None,
        ip_address: str | None,
        now: datetime,
    ) -> tuple[DeviceSession, bool]:
        """Returns (device, is_new_unknown_device)."""
        query = db.query(DeviceSession).filter(
            DeviceSession.user_id == user_id,
            DeviceSession.deleted_at.is_(None),
        )
        query = query.filter(DeviceSession.device_name == device_label) if device_label else query.filter(
            DeviceSession.device_name.is_(None)
        )
        device = query.first()
        is_new = False
        if device is None:
            is_new = True
            device = DeviceSession(
                user_id=user_id,
                device_name=device_label,
                platform=platform,
                last_active=now,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            db.add(device)
        else:
            device.last_active = now
            device.platform = platform or device.platform
            device.ip_address = ip_address or device.ip_address
            device.user_agent = user_agent or device.user_agent
        return device, is_new

    @staticmethod
    def create_refresh_session(
        db: Session,
        *,
        user_id: str,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_label: str | None = None,
        token_family: str | None = None,
    ) -> RefreshSessionBundle:
        raw_refresh_token = AuthSecurityService.generate_secure_token()
        now = utc_now()

        token = RefreshToken(
            user_id=user_id,
            token_hash=AuthSecurityService.hash_token(raw_refresh_token),
            device_id=device_label,
            expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            revoked=False,
            token_family=token_family or uuid4().hex,
            status=AuthSecurityService.ACTIVE,
            user_agent=user_agent,
            ip_address=ip_address,
            device_label=device_label,
        )
        db.add(token)
        db.flush()

        try:
            device, is_new_device = AuthSecurityService._upsert_device_session(
                db,
                user_id=user_id,
                device_label=device_label,
                platform=None,
                user_agent=user_agent,
                ip_address=ip_address,
                now=now,
            )
            from app.services.architecture_system_hooks import upsert_device_registry

            upsert_device_registry(
                db,
                user_id=user_id,
                device_fingerprint=device_label or token.id,
                platform=None,
            )
            db.flush()
            if is_new_device:
                try:
                    user = db.get(User, user_id)
                    if user and user.email:
                        from app.services.email_service import send_email

                        send_email(
                            to_email=user.email,
                            subject="New device sign-in — S4 Family Finance",
                            text_body=(
                                f"A new device signed in to your account.\n"
                                f"Device: {device_label or 'unknown'}\n"
                                f"IP: {ip_address or 'unknown'}\n"
                                f"User-Agent: {(user_agent or '')[:200]}\n"
                                f"If this wasn't you, change your password and revoke sessions."
                            ),
                        )
                except Exception:
                    pass
        except Exception:
            # Architecture side-effects must not break login
            pass

        return RefreshSessionBundle(refresh_token=raw_refresh_token, session=token)

    @staticmethod
    def _migrate_legacy_auth_session(db: Session, legacy: AuthSession) -> RefreshToken:
        """Lazy dual-read migration: legacy AuthSession row -> RefreshToken row."""
        existing = (
            db.query(RefreshToken)
            .filter(RefreshToken.legacy_session_id == legacy.id)
            .first()
        )
        if existing:
            return existing

        token = RefreshToken(
            user_id=legacy.user_id,
            token_hash=legacy.refresh_token_hash,
            device_id=legacy.device_label,
            expires_at=_naive(legacy.expires_at),
            revoked=legacy.status != AuthSecurityService.ACTIVE or legacy.revoked_at is not None,
            legacy_session_id=legacy.id,
            token_family=legacy.token_family,
            status=legacy.status or AuthSecurityService.ACTIVE,
            revoked_at=_naive(legacy.revoked_at),
            revoked_reason=legacy.revoked_reason,
            user_agent=legacy.user_agent,
            ip_address=legacy.ip_address,
            device_label=legacy.device_label,
        )
        db.add(token)
        db.flush()
        return token

    @staticmethod
    def get_session_by_refresh_token(db: Session, raw_refresh_token: str) -> RefreshToken | None:
        token_hash = AuthSecurityService.hash_token(raw_refresh_token)

        token = db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.deleted_at.is_(None),
            )
        ).scalar_one_or_none()
        if token is not None:
            return token

        # Dual-read fallback: legacy AuthSession row not yet migrated (table may be dropped).
        try:
            from sqlalchemy import inspect as sa_inspect

            if not sa_inspect(db.get_bind()).has_table("auth_sessions"):
                return None
            legacy = db.execute(
                select(AuthSession).where(
                    AuthSession.refresh_token_hash == token_hash,
                    AuthSession.deleted_at.is_(None),
                )
            ).scalar_one_or_none()
        except Exception:
            return None
        if legacy is None:
            return None

        return AuthSecurityService._migrate_legacy_auth_session(db, legacy)

    @staticmethod
    def get_active_session_by_refresh_token(db: Session, raw_refresh_token: str) -> RefreshToken | None:
        token = AuthSecurityService.get_session_by_refresh_token(db, raw_refresh_token)
        if token is None:
            return None

        now = utc_now()
        if token.revoked or (token.status or AuthSecurityService.ACTIVE) != AuthSecurityService.ACTIVE:
            return None

        expires_at = _naive(token.expires_at)
        if expires_at and expires_at <= now:
            token.status = AuthSecurityService.EXPIRED
            token.revoked = True
            token.revoked_at = now
            token.revoked_reason = "EXPIRED"
            db.flush()
            return None

        return token

    @staticmethod
    def rotate_refresh_session(
        db: Session,
        *,
        raw_refresh_token: str,
        user_agent: str | None = None,
        ip_address: str | None = None,
        device_label: str | None = None,
    ) -> RefreshSessionBundle | None:
        current = AuthSecurityService.get_active_session_by_refresh_token(db, raw_refresh_token)
        if current is None:
            return None

        now = utc_now()
        current.status = AuthSecurityService.ROTATED
        current.revoked = True
        current.revoked_at = now
        current.revoked_reason = "ROTATED"

        new_bundle = AuthSecurityService.create_refresh_session(
            db,
            user_id=current.user_id,
            user_agent=user_agent,
            ip_address=ip_address,
            device_label=device_label or current.device_label,
            token_family=current.token_family,
        )

        current.replaced_by_token_id = new_bundle.session.id
        db.flush()

        return new_bundle

    @staticmethod
    def revoke_refresh_session(
        db: Session,
        *,
        raw_refresh_token: str,
        reason: str = "LOGOUT",
    ) -> bool:
        token = AuthSecurityService.get_active_session_by_refresh_token(db, raw_refresh_token)
        if token is None:
            return False

        token.status = AuthSecurityService.REVOKED
        token.revoked = True
        token.revoked_at = utc_now()
        token.revoked_reason = reason
        db.flush()
        return True

    @staticmethod
    def revoke_all_user_sessions(
        db: Session,
        *,
        user_id: str,
        reason: str = "REVOKE_ALL",
    ) -> int:
        now = utc_now()
        result = db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.status == AuthSecurityService.ACTIVE,
            )
            .values(
                status=AuthSecurityService.REVOKED,
                revoked=True,
                revoked_at=now,
                revoked_reason=reason,
            )
        )

        # Also close out any not-yet-migrated legacy rows (no-op if table dropped).
        try:
            from sqlalchemy import inspect as sa_inspect

            if sa_inspect(db.get_bind()).has_table("auth_sessions"):
                db.execute(
                    update(AuthSession)
                    .where(
                        AuthSession.user_id == user_id,
                        AuthSession.status == AuthSecurityService.ACTIVE,
                    )
                    .values(
                        status=AuthSecurityService.REVOKED,
                        revoked_at=now,
                        revoked_reason=reason,
                    )
                )
        except Exception:
            pass
        db.flush()
        return int(result.rowcount or 0)

    @staticmethod
    def issue_email_verification_token(user: User) -> str:
        raw_token = AuthSecurityService.generate_secure_token()
        user.email_verification_token_hash = AuthSecurityService.hash_token(raw_token)
        user.email_verification_expires_at = utc_now() + timedelta(
            hours=settings.EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS
        )
        return raw_token

    @staticmethod
    def verify_email_token(db: Session, raw_token: str) -> User | None:
        token_hash = AuthSecurityService.hash_token(raw_token)
        user = db.execute(
            select(User).where(User.email_verification_token_hash == token_hash)
        ).scalar_one_or_none()

        if user is None:
            return None

        now = utc_now()
        if user.email_verification_expires_at and user.email_verification_expires_at <= now:
            return None

        user.is_email_verified = True
        user.email_verified_at = now
        user.email_verification_token_hash = None
        user.email_verification_expires_at = None
        db.flush()
        return user

    @staticmethod
    def issue_password_reset_token(user: User) -> str:
        raw_token = AuthSecurityService.generate_secure_token()
        user.reset_password_token_hash = AuthSecurityService.hash_token(raw_token)
        user.reset_password_expires_at = utc_now() + timedelta(
            minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
        )
        user.reset_password_used_at = None

        if hasattr(user, "reset_password_token"):
            user.reset_password_token = None

        return raw_token

    @staticmethod
    def consume_password_reset_token(db: Session, raw_token: str) -> User | None:
        token_hash = AuthSecurityService.hash_token(raw_token)
        user = db.execute(
            select(User).where(User.reset_password_token_hash == token_hash)
        ).scalar_one_or_none()

        if user is None:
            return None

        now = utc_now()
        if user.reset_password_expires_at and user.reset_password_expires_at <= now:
            return None

        user.reset_password_token_hash = None
        user.reset_password_expires_at = None
        user.reset_password_used_at = now

        if hasattr(user, "reset_password_token"):
            user.reset_password_token = None

        db.flush()
        return user

    @staticmethod
    def is_user_locked(user: User) -> bool:
        return bool(user.locked_until and user.locked_until > utc_now())

    @staticmethod
    def record_failed_login(user: User) -> None:
        user.failed_login_count = int(user.failed_login_count or 0) + 1
        if user.failed_login_count >= settings.FAILED_LOGIN_MAX_ATTEMPTS:
            user.locked_until = utc_now() + timedelta(minutes=settings.FAILED_LOGIN_LOCK_MINUTES)

    @staticmethod
    def record_successful_login(user: User, *, ip_address: str | None = None) -> None:
        user.failed_login_count = 0
        user.locked_until = None
        user.last_login_at = utc_now()
        user.last_login_ip = ip_address
