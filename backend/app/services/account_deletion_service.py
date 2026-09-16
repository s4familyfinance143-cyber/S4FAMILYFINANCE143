"""Soft-delete / anonymize user account (no hard FK wipe)."""

from __future__ import annotations

import secrets

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.services.auth_security_service import AuthSecurityService
from app.services.avatar_service import delete_avatar


def deactivate_and_anonymize_user(db: Session, user: User) -> dict:
    """Disable login and scrub PII. Keeps row for FK integrity (families, ledger).

    Google Drive backups on the user's own Drive are untouched (client-side).
    """
    user_id = str(user.id)
    original_email = str(user.email or "")

    try:
        delete_avatar(user_id)
    except Exception:
        pass

    AuthSecurityService.revoke_all_user_sessions(
        db,
        user_id=user_id,
        reason="ACCOUNT_DELETED",
    )

    user.is_active = False
    user.full_name = "Deleted User"
    user.email = f"deleted-{user_id}@deleted.local"
    user.phone = None
    user.is_email_verified = False
    user.is_phone_verified = False
    user.password_hash = hash_password(secrets.token_urlsafe(48))
    user.reset_password_token = None
    # reset_password_token_hash (not reset_password_token, a separate unused legacy
    # field) is what consume_password_reset_token() actually matches on. Leaving it
    # set here while clearing reset_password_expires_at made a pending reset token
    # issued before deletion look "never expired" (the expiry check is skipped when
    # expires_at is falsy) — the token would still validate and let a holder of the
    # old raw token reset the password on this now-deactivated, anonymized account.
    # Not exploitable for takeover (login still blocked on is_active), but it's a
    # gap in the deletion — a reset token issued before deletion should die with it.
    user.reset_password_token_hash = None
    user.reset_password_expires_at = None
    user.email_verification_token_hash = None
    user.email_verification_expires_at = None
    user.email_verified_at = None
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_ip = None

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "user_id": user_id,
        "previous_email": original_email,
        "message": "Account deleted. You can no longer sign in with this account.",
    }
