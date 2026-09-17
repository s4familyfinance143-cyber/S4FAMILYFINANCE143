"""reports_audit_integration_hardened.py's phase8b_audit_activity used to accept
ANY of ["audit.view", "audit.view_all", "reports.view", "reports.view_all"] --
but "reports.view" maps to report.read, which VIEWER/MEMBER hold, letting them
bypass audit.read being in permission_service.PROTECTED_OWNER_PERMISSIONS
(explicitly non-overridable, Owner/Admin only by design). Must reject VIEWER.
Same bug/fix as test_audit_trail_permission.py.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.core.database import SessionLocal
from app.main import app as _app  # noqa: F401 - imports startup schema initialization
from app.api.v1 import reports_audit_integration_hardened as mod
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.user import User


def _uid() -> str:
    return str(uuid4())


def _make_family_with_member(db, role: str):
    user = User(
        id=_uid(),
        full_name="Reports Audit Perm Test User",
        email=f"reports-audit-perm-{uuid4().hex[:8]}@example.com",
        password_hash="not-used-by-this-test",
        preferred_language="en",
        is_active=True,
        is_email_verified=True,
    )
    db.add(user)
    db.flush()

    family = Family(
        id=_uid(),
        name="Reports Audit Perm Family",
        owner_user_id=user.id,
        default_currency="BDT",
        timezone="Asia/Dhaka",
        is_active=True,
    )
    db.add(family)
    db.flush()

    member = FamilyMember(
        id=_uid(),
        family_id=family.id,
        user_id=user.id,
        role=role,
        status="ACTIVE",
    )
    db.add(member)
    db.flush()
    return user, family


def test_phase8b_audit_activity_rejects_viewer():
    db = SessionLocal()
    try:
        user, family = _make_family_with_member(db, "VIEWER")
        db.commit()
        current_user = type("U", (), {"id": user.id})()

        with pytest.raises(HTTPException) as exc:
            mod.phase8b_audit_activity(family_id=family.id, limit=50, db=db, current_user=current_user)
        assert exc.value.status_code == 403
    finally:
        db.rollback()
        db.close()


def test_phase8b_audit_activity_allows_owner():
    db = SessionLocal()
    try:
        user, family = _make_family_with_member(db, "OWNER")
        db.commit()
        current_user = type("U", (), {"id": user.id})()

        result = mod.phase8b_audit_activity(family_id=family.id, limit=50, db=db, current_user=current_user)
        assert result["status"] == "ok"
    finally:
        db.rollback()
        db.close()
