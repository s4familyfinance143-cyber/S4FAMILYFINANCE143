"""End-to-end auth → family create → seed wallets via API."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.main import app
from app.models.user import User

client = TestClient(app)
PASSWORD = "RealTest9!"


def _verified_user(email: str, full_name: str = "API Owner") -> User:
    db = SessionLocal()
    try:
        user = User(
            full_name=full_name,
            email=email,
            password_hash=hash_password(PASSWORD),
            preferred_language="bn",
            is_active=True,
            is_email_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def test_register_rejects_weak_password(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ENVIRONMENT", "production")
    email = f"weak-{uuid4().hex[:8]}@s4family.com"
    res = client.post(
        "/api/v1/auth/register",
        json={"full_name": "Weak User", "email": email, "password": "password"},
    )
    assert res.status_code == 422


def test_register_auto_verifies_in_development():
    """Non-production register marks email verified so local login works without SMTP."""
    email = f"devreg-{uuid4().hex[:8]}@s4family.com"
    reg = client.post(
        "/api/v1/auth/register",
        json={"full_name": "Dev User", "email": email, "password": PASSWORD},
    )
    assert reg.status_code == 201
    login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text


def test_login_blocks_unverified_email():
    email = f"unver-{uuid4().hex[:8]}@s4family.com"
    db = SessionLocal()
    try:
        user = User(
            full_name="Unverified",
            email=email,
            password_hash=hash_password(PASSWORD),
            preferred_language="bn",
            is_active=True,
            is_email_verified=False,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()

    login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 403
    body = login.json()
    msg = str(body.get("detail") or (body.get("error") or {}).get("message") or "")
    assert "verification" in msg.lower()


def test_verified_user_can_create_family_with_seeded_wallets():
    email = f"owner-{uuid4().hex[:8]}@s4family.com"
    _verified_user(email)

    login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == email

    created = client.post(
        "/api/v1/families",
        headers=headers,
        json={
            "name": f"Fam {uuid4().hex[:6]}",
            "default_currency": "BDT",
            "timezone": "Asia/Dhaka",
            "relationship_type": "Husband",
        },
    )
    assert created.status_code in {200, 201}, created.text
    body = created.json()
    family_id = body.get("family_id") or body.get("id") or (body.get("family") or {}).get("id")
    assert family_id

    wallets = client.get(f"/api/v1/accounts/family/{family_id}", headers=headers)
    assert wallets.status_code == 200, wallets.text
    rows = wallets.json()
    assert isinstance(rows, list)
    assert len(rows) >= 6
    types = {str(r.get("account_type") or "").upper() for r in rows}
    for needed in ("CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "CARD", "GOLD", "ASSET"):
        assert needed in types
