"""Audit log middleware — records mutating API calls (POST/PATCH/PUT/DELETE)."""

from __future__ import annotations

import logging
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("s4.audit_mw")

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PREFIXES = (
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/auth/login",
    "/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v2/auth/login",
    "/api/v2/auth/register",
)

FAMILY_PATH_RE = re.compile(
    r"/(?:api/v[12]/)?(?:families|backup/list|permissions/family|join-requests/family|accounts/family|categories/family|transactions|grocery)/([0-9a-fA-F-]{36})"
)


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        try:
            if request.method not in MUTATING:
                return response
            path = request.url.path
            if any(path == p or path.startswith(p) for p in SKIP_PREFIXES):
                return response
            if response.status_code >= 400:
                return response

            family_id = None
            m = FAMILY_PATH_RE.search(path)
            if m:
                family_id = m.group(1)
            user_id = getattr(request.state, "user_id", None)
            request_id = getattr(request.state, "request_id", None)

            # Prefer DB audit when family context is known; always keep structured log.
            if family_id and user_id:
                try:
                    from app.core.database import SessionLocal
                    from app.models.family_member import FamilyMember
                    from app.services.audit_service import write_audit_log

                    db = SessionLocal()
                    try:
                        member = (
                            db.query(FamilyMember)
                            .filter(
                                FamilyMember.family_id == family_id,
                                FamilyMember.user_id == user_id,
                                FamilyMember.deleted_at.is_(None),
                            )
                            .first()
                        )
                        write_audit_log(
                            db,
                            family_id=family_id,
                            member_id=member.id if member else None,
                            action_type=request.method,
                            entity_type="HTTP_REQUEST",
                            entity_id=request_id,
                            title=f"{request.method} {path}",
                            description=f"status={response.status_code}",
                            severity="INFO",
                        )
                        db.commit()
                    finally:
                        db.close()
                except Exception as exc:
                    logger.debug("audit middleware db skip: %s", exc)

            logger.info(
                "audit method=%s path=%s status=%s user_id=%s family_id=%s request_id=%s",
                request.method,
                path,
                response.status_code,
                user_id,
                family_id,
                request_id,
            )
        except Exception as exc:
            logger.debug("audit middleware error: %s", exc)
        return response
