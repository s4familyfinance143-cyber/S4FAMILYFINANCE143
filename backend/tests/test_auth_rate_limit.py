"""Auth endpoint rate-limit wiring smoke."""

from app.core.rate_limit import (
    AUTH_LOGIN_LIMIT,
    AUTH_PASSWORD_EMAIL_LIMIT,
    AUTH_REGISTER_LIMIT,
    limiter,
)
from app.main import app


def test_limiter_attached_to_app_state():
    assert app.state.limiter is limiter


def test_auth_rate_limit_constants():
    assert AUTH_LOGIN_LIMIT.endswith("/minute")
    assert AUTH_REGISTER_LIMIT.endswith("/hour")
    assert AUTH_PASSWORD_EMAIL_LIMIT.endswith("/minute")
