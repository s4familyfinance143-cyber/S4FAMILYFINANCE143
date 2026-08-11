"""Production config safety: RS256 keys required; HS256 allowed with secret."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rs256_requires_keys():
    with pytest.raises((ValidationError, ValueError)):
        Settings(
            _env_file=None,
            ENVIRONMENT="production",
            DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/db",
            AUTO_CREATE_TABLES=False,
            JWT_SECRET_KEY="production_secret_key_at_least_32_chars_xx",
            JWT_ALGORITHM="RS256",
            JWT_PRIVATE_KEY=None,
            JWT_PUBLIC_KEY=None,
        )


def test_production_hs256_allowed_without_rsa():
    s = Settings(
        _env_file=None,
        ENVIRONMENT="production",
        DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/db",
        AUTO_CREATE_TABLES=False,
        JWT_SECRET_KEY="production_secret_key_at_least_32_chars_xx",
        JWT_ALGORITHM="HS256",
    )
    assert s.IS_PRODUCTION
    assert s.JWT_ALGORITHM.upper() == "HS256"
    assert s.REFRESH_COOKIE_SECURE is True
