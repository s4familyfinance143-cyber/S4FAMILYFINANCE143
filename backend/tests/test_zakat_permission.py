"""calculate_zakat() creates/overwrites a ZakatRecord -- a write action --
but used to be gated only behind report.read, which VIEWER also holds
(VIEWER is supposed to be read-only). Must require budget.create instead.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.core.database import SessionLocal
from app.main import app as _app  # noqa: F401 - imports startup schema initialization
from app.api.v1 import zakat as zakat_mod
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.user import User
from app.schemas.zakat import ZakatCalculateRequest


def _uid() -> str:
    return str(uuid4())


def _make_family_with_member(db, role: str):
    user = User(
        id=_uid(),
        full_name="Zakat Test User",
        email=f"zakat-perm-{uuid4().hex[:8]}@example.com",
        password_hash="not-used-by-this-test",
        preferred_language="en",
        is_active=True,
        is_email_verified=True,
    )
    db.add(user)
    db.flush()

    family = Family(
        id=_uid(),
        name="Zakat Perm Family",
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
    return user, family, member


def test_calculate_zakat_rejects_viewer_role():
    db = SessionLocal()
    try:
        user, family, _member = _make_family_with_member(db, "VIEWER")
        db.commit()

        payload = ZakatCalculateRequest(
            family_id=family.id,
            calculation_year="2026",
            cash_amount=Decimal("100000"),
        )
        current_user = type("U", (), {"id": user.id})()

        with pytest.raises(HTTPException) as exc:
            zakat_mod.calculate_zakat(payload, db=db, current_user=current_user)
        assert exc.value.status_code == 403
    finally:
        db.rollback()
        db.close()


def test_calculate_zakat_allows_member_role():
    db = SessionLocal()
    try:
        user, family, _member = _make_family_with_member(db, "MEMBER")
        db.commit()

        payload = ZakatCalculateRequest(
            family_id=family.id,
            calculation_year="2026",
            cash_amount=Decimal("100000"),
            nisab_amount=Decimal("50000"),
        )
        current_user = type("U", (), {"id": user.id})()

        result = zakat_mod.calculate_zakat(payload, db=db, current_user=current_user)
        assert result["family_id"] == family.id
        assert result["status"] == "CALCULATED"
    finally:
        db.rollback()
        db.close()
