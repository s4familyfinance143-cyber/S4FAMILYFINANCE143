"""offline_sync_hardened.py's phase10b_sync_pull used to dump the full
audit_logs table into every sync payload regardless of permission -- the
endpoint's own permission gate accepts report.read (VIEWER-held) or
sync.pull (aliased to dashboard.read, also VIEWER-held), neither of which
is audit.read. audit.read is in permission_service.PROTECTED_OWNER_PERMISSIONS
(Owner/Admin only, non-overridable by design), so any VIEWER could pull the
family's full audit trail as a side effect of a generic multi-table sync.
Must exclude audit_logs from the payload unless the caller actually holds
audit.read.
"""

from __future__ import annotations

from uuid import uuid4

from app.core.database import SessionLocal
from app.main import app as _app  # noqa: F401 - imports startup schema initialization
from app.api.v1 import offline_sync_hardened as sync
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.user import User


def _uid() -> str:
    return str(uuid4())


def _make_family_with_member(db, role: str):
    user = User(
        id=_uid(),
        full_name="Sync Audit Exposure Test User",
        email=f"sync-audit-exposure-{uuid4().hex[:8]}@example.com",
        password_hash="not-used-by-this-test",
        preferred_language="en",
        is_active=True,
        is_email_verified=True,
    )
    db.add(user)
    db.flush()

    family = Family(
        id=_uid(),
        name="Sync Audit Exposure Family",
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


def _seed_audit_log(db, family_id: str, user):
    sync._phase10b_ensure_sync_tables(db)
    current_user = type("U", (), {"id": user.id})()
    sync._phase10b_insert_audit(
        db, family_id, current_user, "TEST_EVENT", "Test Event", "seeded for test"
    )


def test_sync_pull_excludes_audit_logs_for_viewer():
    db = SessionLocal()
    try:
        user, family = _make_family_with_member(db, "VIEWER")
        db.commit()
        _seed_audit_log(db, family.id, user)
        current_user = type("U", (), {"id": user.id})()

        result = sync.phase10b_sync_pull(
            family_id=family.id, device_id="dev-1", since_token=None, limit=50,
            db=db, current_user=current_user,
        )
        assert result["changes"]["audit_logs"] == []
    finally:
        db.rollback()
        db.close()


def test_sync_pull_includes_audit_logs_for_owner():
    db = SessionLocal()
    try:
        user, family = _make_family_with_member(db, "OWNER")
        db.commit()
        _seed_audit_log(db, family.id, user)
        current_user = type("U", (), {"id": user.id})()

        result = sync.phase10b_sync_pull(
            family_id=family.id, device_id="dev-1", since_token=None, limit=50,
            db=db, current_user=current_user,
        )
        assert len(result["changes"]["audit_logs"]) >= 1
    finally:
        db.rollback()
        db.close()
