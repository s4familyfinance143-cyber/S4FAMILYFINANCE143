"""Auth feature module — real entrypoints (not stubs)."""

from app.api.v1 import auth as auth_router
from app.core import security
from app.services import auth_security_service

__all__ = ["auth_router", "security", "auth_security_service"]
