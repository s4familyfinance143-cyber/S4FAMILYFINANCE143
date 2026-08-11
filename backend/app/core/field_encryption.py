"""AES-256-GCM field encryption at rest (architecture Data Encryption)."""

from __future__ import annotations

import base64
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

_PREFIX = "enc:v1:"


def _key_bytes() -> bytes:
    raw = (settings.FIELD_ENCRYPTION_KEY or "").strip()
    if raw:
        try:
            key = base64.urlsafe_b64decode(raw)
            if len(key) == 32:
                return key
        except Exception:
            pass
        # Derive 32 bytes from provided secret
        import hashlib

        return hashlib.sha256(raw.encode("utf-8")).digest()
    # Dev fallback: derive from JWT secret (not for production long-term)
    import hashlib

    return hashlib.sha256(settings.JWT_SECRET_KEY.encode("utf-8")).digest()


def encrypt_field(plaintext: str | None, *, deterministic: bool = True) -> str | None:
    """Encrypt sensitive field with AES-256-GCM.

    deterministic=True (default) so unique constraints (e.g. phone) still work.
    """
    if plaintext is None or plaintext == "":
        return plaintext
    if str(plaintext).startswith(_PREFIX):
        return plaintext
    key = _key_bytes()
    aes = AESGCM(key)
    data = str(plaintext).encode("utf-8")
    if deterministic:
        import hashlib

        nonce = hashlib.sha256(key + data).digest()[:12]
    else:
        nonce = os.urandom(12)
    ct = aes.encrypt(nonce, data, None)
    blob = base64.urlsafe_b64encode(nonce + ct).decode("ascii")
    return f"{_PREFIX}{blob}"


def decrypt_field(ciphertext: str | None) -> str | None:
    if ciphertext is None or ciphertext == "":
        return ciphertext
    text = str(ciphertext)
    if not text.startswith(_PREFIX):
        return text
    raw = base64.urlsafe_b64decode(text[len(_PREFIX) :])
    nonce, ct = raw[:12], raw[12:]
    aes = AESGCM(_key_bytes())
    return aes.decrypt(nonce, ct, None).decode("utf-8")


def is_encrypted(value: Optional[str]) -> bool:
    return bool(value and str(value).startswith(_PREFIX))
