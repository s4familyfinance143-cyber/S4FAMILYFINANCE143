"""JWT / password crypto — architecture Auth & Security (RS256, bcrypt cost 12)."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

# Architecture: bcrypt cost factor 12
password_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=int(getattr(settings, "BCRYPT_ROUNDS", 12) or 12),
)

_KEY_DIR = Path(__file__).resolve().parents[2] / "secrets"
_PRIVATE_PATH = _KEY_DIR / "jwt_rs256_private.pem"
_PUBLIC_PATH = _KEY_DIR / "jwt_rs256_public.pem"


def _ensure_rsa_keys() -> tuple[str, str]:
    """Load or generate RS256 PEM key pair for JWT."""
    private_pem = (getattr(settings, "JWT_PRIVATE_KEY", None) or "").strip()
    public_pem = (getattr(settings, "JWT_PUBLIC_KEY", None) or "").strip()
    if private_pem and public_pem:
        return private_pem, public_pem

    if _PRIVATE_PATH.exists() and _PUBLIC_PATH.exists():
        return _PRIVATE_PATH.read_text(encoding="utf-8"), _PUBLIC_PATH.read_text(encoding="utf-8")

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = (
        key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )
    try:
        _KEY_DIR.mkdir(parents=True, exist_ok=True)
        _PRIVATE_PATH.write_text(private_pem, encoding="utf-8")
        _PUBLIC_PATH.write_text(public_pem, encoding="utf-8")
    except Exception:
        pass
    return private_pem, public_pem


def _signing_key() -> str:
    alg = (settings.JWT_ALGORITHM or "RS256").upper()
    if alg.startswith("RS"):
        private_pem, _ = _ensure_rsa_keys()
        return private_pem
    return settings.JWT_SECRET_KEY


def _verify_key() -> str:
    alg = (settings.JWT_ALGORITHM or "RS256").upper()
    if alg.startswith("RS"):
        _, public_pem = _ensure_rsa_keys()
        return public_pem
    return settings.JWT_SECRET_KEY


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return password_context.verify(plain_password, password_hash)


def create_access_token(
    subject: str,
    extra: dict[str, Any] | None = None,
    *,
    family_id: str | None = None,
    role: str | None = None,
    user_id: str | None = None,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    uid = user_id or subject
    payload: dict[str, Any] = {
        "sub": subject,
        "user_id": uid,
        "family_id": family_id,
        "role": role,
        "type": "access",
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _signing_key(), algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """Legacy JWT refresh helper (opaque DB refresh is primary)."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": "refresh",
        "exp": expire,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _signing_key(), algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        _verify_key(),
        algorithms=[settings.JWT_ALGORITHM],
        options={"verify_aud": False},
    )


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
