"""Invite security: hash-only storage, no plaintext hint persisted."""

from __future__ import annotations

from uuid import uuid4

from app.api.v1.invites import hash_code, normalize_invite_code
from app.core.database import SessionLocal
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.invite_code import InviteCode
from app.models.user import User
from app.core.security import hash_password


def test_hash_code_is_stable_and_normalized():
    a = hash_code("s4f-abcd")
    b = hash_code(" S4F-ABCD ")
    assert a == b
    assert len(a) == 64
    assert a != "S4F-ABCD"


def test_normalize_invite_code_uppercases():
    assert normalize_invite_code("  abc-12  ") == "ABC-12"


def test_create_invite_does_not_store_raw_code_hint():
    from app.api.v1.invites import _create_invite_row

    db = SessionLocal()
    try:
        user = User(
            full_name="Invite Owner",
            email=f"invite-owner-{uuid4().hex[:8]}@s4family.com",
            password_hash=hash_password("RealTest9!"),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        db.add(user)
        db.flush()
        family = Family(name="Invite Family", owner_user_id=user.id)
        db.add(family)
        db.flush()
        member = FamilyMember(
            family_id=family.id,
            user_id=user.id,
            role="OWNER",
            status="ACTIVE",
        )
        db.add(member)
        db.flush()

        invite, raw = _create_invite_row(
            db=db,
            family_id=family.id,
            actor_id=member.id,
            expires_days=7,
            max_uses=1,
            channel="CODE",
        )
        db.commit()
        db.refresh(invite)

        assert raw.startswith("S4F-")
        assert invite.code_hash == hash_code(raw)
        assert invite.raw_code_hint is None
        assert invite.code_hash != raw
    finally:
        db.close()
