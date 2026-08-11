"""API auth/security guards via FastAPI TestClient (no live network)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body.get("status") == "ok"
    assert body.get("service") == "s4-family-finance-api"
    assert body.get("database") in {"sqlite", "postgresql"}


def test_protected_routes_require_auth():
    paths = [
        "/api/v1/auth/me",
        "/api/v1/families",
        "/api/v1/notifications/fcm-status",
        "/api/v1/phase16/vault-status",
        "/api/v1/notifications/delivery-status/00000000-0000-0000-0000-000000000001",
    ]
    for path in paths:
        res = client.get(path)
        assert res.status_code in {401, 403, 404, 422}, f"{path} -> {res.status_code}"
        assert res.status_code != 200


def test_sync_status_requires_auth():
    res = client.get(
        "/api/v1/families/00000000-0000-0000-0000-000000000001/sync/status"
        "?device_id=pytest&device_name=pytest&platform=test"
    )
    assert res.status_code in {401, 403, 404}


def test_forgot_password_honest_without_user():
    res = client.post("/api/v1/auth/forgot-password", json={"email": "missing-user-xyz@s4family.com"})
    assert res.status_code == 200
    body = res.json()
    assert "message" in body
