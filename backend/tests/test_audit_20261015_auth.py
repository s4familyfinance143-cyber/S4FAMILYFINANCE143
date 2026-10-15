"""AUD-09: replaying a rotated refresh token must revoke its whole token family.

Before: a rotated token just returned 401, so if a thief rotated a stolen
refresh token first, the thief's chain lived on for the full refresh lifetime
while the real user was quietly logged out.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from app.core.database import SessionLocal
from app.core.timeutil import utc_now
from app.main import app as _app  # noqa: F401 - registers models / schema
from app.models.architecture_auth import RefreshToken
from app.models.user import User
from app.services.auth_security_service import AuthSecurityService


def _user(db) -> User:
    user = User(
        full_name="Refresh Reuse",
        email=f"refresh-reuse-{uuid4().hex[:8]}@example.com",
        password_hash="not-used",
        preferred_language="en",
        is_active=True,
        is_email_verified=True,
        is_phone_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def test_aud09_rotated_refresh_replay_revokes_token_family():
    db = SessionLocal()
    try:
        user = _user(db)
        first = AuthSecurityService.create_refresh_session(db, user_id=user.id)
        second = AuthSecurityService.rotate_refresh_session(db, raw_refresh_token=first.refresh_token)
        assert second is not None
        # move the rotation outside the concurrent-refresh grace window
        old = db.get(RefreshToken, first.session.id)
        old.revoked_at = utc_now() - timedelta(minutes=5)
        db.commit()

        replay = AuthSecurityService.rotate_refresh_session(db, raw_refresh_token=first.refresh_token)
        db.commit()
        assert replay is None

        live = db.get(RefreshToken, second.session.id)
        db.refresh(live)
        assert live.status == AuthSecurityService.REVOKED
        assert live.revoked_reason == "REFRESH_REUSE_DETECTED"
        assert AuthSecurityService.rotate_refresh_session(db, raw_refresh_token=second.refresh_token) is None
    finally:
        db.rollback()
        db.close()


def test_aud09_concurrent_refresh_inside_grace_window_keeps_new_session():
    db = SessionLocal()
    try:
        user = _user(db)
        first = AuthSecurityService.create_refresh_session(db, user_id=user.id)
        second = AuthSecurityService.rotate_refresh_session(db, raw_refresh_token=first.refresh_token)
        db.commit()

        assert AuthSecurityService.rotate_refresh_session(db, raw_refresh_token=first.refresh_token) is None
        db.commit()
        live = db.get(RefreshToken, second.session.id)
        db.refresh(live)
        assert live.status == AuthSecurityService.ACTIVE
    finally:
        db.rollback()
        db.close()


def test_aud11_grocery_websocket_rejects_logged_out_token():
    """The grocery socket decoded the JWT itself and skipped the blacklist
    check get_current_user does, so a logged-out token kept a live feed."""
    import hashlib

    import pytest
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from app.core.security import create_access_token
    from app.main import app
    from app.services.redis_session import blacklist_token_hash

    db = SessionLocal()
    try:
        user = _user(db)
        db.commit()
        user_id = user.id
    finally:
        db.close()

    client = TestClient(app)
    token = create_access_token(user_id)
    res = client.post(
        "/api/v1/families",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": f"WS Fam {uuid4().hex[:6]}", "default_currency": "BDT", "timezone": "Asia/Dhaka"},
    )
    assert res.status_code in {200, 201}, res.text
    body = res.json()
    family_id = body.get("family_id") or body.get("id") or (body.get("family") or {}).get("id")

    with client.websocket_connect(f"/api/v1/grocery/ws/{family_id}?token={token}") as ws:
        assert ws.receive_json()["type"] == "grocery.subscribed"

    blacklist_token_hash(hashlib.sha256(token.encode("utf-8")).hexdigest(), 900)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/grocery/ws/{family_id}?token={token}") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_rt1_close_user_closes_only_that_members_sockets():
    import asyncio

    from app.services.grocery_realtime import GroceryRealtimeHub

    class FakeWS:
        def __init__(self):
            self.closed_with = None

        async def accept(self):
            return None

        async def close(self, code=1000):
            self.closed_with = code

    async def scenario():
        hub = GroceryRealtimeHub()
        a, b = FakeWS(), FakeWS()
        await hub.connect("fam", a, user_id="user-a")
        await hub.connect("fam", b, user_id="user-b")
        closed = await hub.close_user("fam", "user-a")
        return hub, a, b, closed

    hub, a, b, closed = asyncio.run(scenario())
    assert closed == 1
    assert a.closed_with == 4403
    assert b.closed_with is None
    assert hub.subscriber_count("fam") == 1


def test_bkp1_integrity_does_not_expose_server_path():
    from fastapi.testclient import TestClient

    from app.core.security import create_access_token
    from app.main import app

    db = SessionLocal()
    try:
        user = _user(db)
        db.commit()
        uid = user.id
    finally:
        db.close()
    res = TestClient(app).get(
        "/api/v1/backup/integrity", headers={"Authorization": f"Bearer {create_access_token(uid)}"}
    )
    assert res.status_code == 200, res.text
    db_field = str(res.json().get("database") or "")
    assert "/" not in db_field and "\\" not in db_field
