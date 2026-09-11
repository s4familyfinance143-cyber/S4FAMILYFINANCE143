"""6-digit OTP store (Redis when available, memory fallback)."""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from app.core.config import settings
from app.services.redis_cache import _redis, cache_delete, cache_get, cache_set


def _otp_length() -> int:
    return max(4, min(8, int(getattr(settings, "OTP_LENGTH", 6) or 6)))


def _ttl() -> int:
    return max(60, int(getattr(settings, "OTP_TTL_SECONDS", 600) or 600))


def _max_attempts() -> int:
    return max(3, int(getattr(settings, "OTP_MAX_ATTEMPTS", 5) or 5))


def generate_otp_code() -> str:
    length = _otp_length()
    # cryptographically strong digits, fixed width
    upper = 10**length
    return str(secrets.randbelow(upper)).zfill(length)


def _hash_code(code: str) -> str:
    return hashlib.sha256(str(code).strip().encode("utf-8")).hexdigest()


def _key(purpose: str, email: str) -> str:
    return f"s4:otp:{purpose}:{str(email).strip().lower()}"


@dataclass
class OtpIssueResult:
    code: str
    ttl_seconds: int
    purpose: str


@dataclass
class OtpVerifyResult:
    ok: bool
    reason: str


def issue_otp(*, purpose: str, email: str) -> OtpIssueResult:
    code = generate_otp_code()
    ttl = _ttl()
    payload = {
        "hash": _hash_code(code),
        "attempts": 0,
        "max_attempts": _max_attempts(),
        "created_at": time.time(),
    }
    cache_set(_key(purpose, email), payload, ttl_seconds=ttl)
    return OtpIssueResult(code=code, ttl_seconds=ttl, purpose=purpose)


def verify_otp(*, purpose: str, email: str, code: str, consume: bool = True) -> OtpVerifyResult:
    key = _key(purpose, email)
    row = cache_get(key)
    if not row or not isinstance(row, dict):
        return OtpVerifyResult(False, "Invalid or expired OTP")
    attempts = int(row.get("attempts") or 0)
    max_attempts = int(row.get("max_attempts") or _max_attempts())
    if attempts >= max_attempts:
        cache_delete(key)
        return OtpVerifyResult(False, "Too many invalid OTP attempts")
    expected = str(row.get("hash") or "")
    given = _hash_code(code)
    if not secrets.compare_digest(expected, given):
        row["attempts"] = attempts + 1
        # refresh remaining TTL best-effort
        r = _redis()
        ttl_left = _ttl()
        if r:
            try:
                ttl_left = max(1, int(r.ttl(key) or _ttl()))
            except Exception:
                pass
        cache_set(key, row, ttl_seconds=ttl_left)
        return OtpVerifyResult(False, "Invalid or expired OTP")
    if consume:
        cache_delete(key)
    return OtpVerifyResult(True, "ok")


def clear_otp(*, purpose: str, email: str) -> None:
    cache_delete(_key(purpose, email))
