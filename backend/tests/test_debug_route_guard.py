"""Debug routes must not leak in production-like environments."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def test_debug_ws_routes_available_in_development():
    if settings.IS_PRODUCTION or settings.ENVIRONMENT.lower() in {"staging", "prod"}:
        return
    res = client.get("/debug/ws-routes")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_debug_ws_routes_hidden_in_staging_env(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "staging")
    res = client.get("/debug/ws-routes")
    assert res.status_code == 404
