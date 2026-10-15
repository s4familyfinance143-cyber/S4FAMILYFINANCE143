"""Family-wide live updates over the VPS WebSocket.

- an event is published only after the session commits (never on rollback)
- a member's /realtime/ws socket receives another member's committed change
- CHILD (no report.read) can still subscribe (dashboard.read)
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.models.family_member import FamilyMember
from app.models.user import User
from app.services import family_realtime, grocery_realtime


def _user(db, label: str) -> User:
    user = User(
        full_name=f"RT {label}",
        email=f"rt-{label.lower()}-{uuid4().hex[:8]}@example.com",
        password_hash="not-used",
        preferred_language="en",
        is_active=True,
        is_email_verified=True,
        is_phone_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _headers(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(uid)}"}


def test_event_published_only_after_commit(monkeypatch):
    sent = []
    monkeypatch.setattr(grocery_realtime, "publish_family_event", lambda fid, ev: sent.append((fid, ev)))

    db = SessionLocal()
    try:
        family_realtime.queue_family_event(db, "fam-x", entity_type="wallet", action="update", entity_id="w1")
        db.rollback()
        assert sent == []

        family_realtime.queue_family_event(db, "fam-x", entity_type="wallet", action="update", entity_id="w1")
        family_realtime.queue_family_event(db, "fam-x", entity_type="wallet", action="update", entity_id="w1")
        db.commit()
        assert len(sent) == 1  # duplicates within one commit collapse
        fid, ev = sent[0]
        assert fid == "fam-x"
        assert ev["type"] == "family.changed" and ev["entity_type"] == "WALLET" and ev["action"] == "UPDATE"
        assert "ts" in ev
    finally:
        db.close()


def test_member_socket_receives_other_members_committed_change():
    db = SessionLocal()
    try:
        owner = _user(db, "Owner")
        child = _user(db, "Child")
        db.commit()
        owner_id, child_id = owner.id, child.id
    finally:
        db.close()

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/families",
            headers=_headers(owner_id),
            json={"name": f"RT Fam {uuid4().hex[:6]}", "default_currency": "BDT", "timezone": "Asia/Dhaka"},
        )
        assert res.status_code in {200, 201}, res.text
        body = res.json()
        family_id = body.get("family_id") or body.get("id") or (body.get("family") or {}).get("id")

        db = SessionLocal()
        try:
            db.add(FamilyMember(family_id=family_id, user_id=child_id, role="CHILD", status="ACTIVE"))
            db.commit()
        finally:
            db.close()

        token = create_access_token(child_id)
        with client.websocket_connect(f"/api/v1/realtime/ws/{family_id}?token={token}") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "family.subscribed"

            created = client.post(
                "/api/v1/accounts",
                headers=_headers(owner_id),
                json={
                    "family_id": family_id,
                    "name": "Live Wallet",
                    "account_type": "CASH",
                    "currency": "BDT",
                    "opening_balance": "0",
                },
            )
            assert created.status_code in {200, 201}, created.text

            event = ws.receive_json()
            while event.get("type") != "family.changed":
                event = ws.receive_json()
            assert event["family_id"] == family_id
            assert event["entity_type"] == "WALLET"
            assert "amount" not in event and "name" not in event  # no data in the event, only a refetch hint


def test_publish_failure_never_breaks_the_commit(monkeypatch):
    """The data is committed before the broadcast; a broken socket hub must
    not turn a successful write into an error for the caller."""

    def boom(fid, ev):
        raise RuntimeError("hub down")

    monkeypatch.setattr(grocery_realtime, "publish_family_event", boom)
    db = SessionLocal()
    try:
        family_realtime.queue_family_event(db, "fam-y", entity_type="budget", action="create")
        db.commit()  # must not raise
    finally:
        db.close()
