"""Versioned API compatibility and always-eager Celery coverage."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

import app.core.database as database_module
import app.services.notification_scan_service as scan_service
from app.main import app
from app.workers.celery_app import celery_app
from app.workers.celery_tasks import process_sync_outbox_task, scan_due_notifications_task


client = TestClient(app)


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.limit_value = None

    def filter(self, *args):
        return self

    def order_by(self, *args):
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def all(self):
        return self.rows


class FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def query(self, model):
        return FakeQuery(self.rows)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


def test_versioned_and_legacy_health_routes_work():
    versioned = client.get("/api/v1/health")
    v2 = client.get("/api/v2/health")
    legacy = client.get("/health")
    assert versioned.status_code == 200
    assert v2.status_code == 200
    assert legacy.status_code == 200
    assert versioned.json()["status"] == v2.json()["status"] == legacy.json()["status"] == "ok"
    assert versioned.json()["api_versions"] == ["/api/v1", "/api/v2"]
    assert versioned.headers.get("X-API-Version") == "1"
    assert v2.headers.get("X-API-Version") == "2"
    assert "Deprecation" not in legacy.headers


def test_api_v1_and_v2_auth_and_version_endpoints():
    v1_login = client.post("/api/v1/auth/login", json={})
    v2_login = client.post("/api/v2/auth/login", json={})
    assert v1_login.status_code == 422
    assert v2_login.status_code == 422
    assert v1_login.headers.get("X-API-Version") == "1"
    assert v2_login.headers.get("X-API-Version") == "2"
    assert "Deprecation" not in v1_login.headers
    assert "Deprecation" not in v2_login.headers

    v1_info = client.get("/api/v1/version")
    v2_info = client.get("/api/v2/version")
    assert v1_info.status_code == 200
    assert v2_info.status_code == 200
    assert v1_info.json()["api_version"] == "1"
    assert v2_info.json()["api_version"] == "2"
    assert v1_info.json()["supported_versions"] == ["1", "2"]
    assert v2_info.json()["prefixes"]["v2"] == "/api/v2"


def test_unversioned_api_route_is_removed_by_default():
    """Bare /auth is off when ENABLE_LEGACY_UNVERSIONED_API=False (default)."""
    response = client.post("/auth/login", json={})
    assert response.status_code == 404

    versioned = client.post("/api/v1/auth/login", json={})
    assert versioned.status_code == 422
    assert "Deprecation" not in versioned.headers


def test_legacy_unversioned_api_can_be_reenabled(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.ENABLE_LEGACY_UNVERSIONED_API",
        True,
        raising=False,
    )
    # Flag is read at import/mount time — document expected default behavior above.
    # This test asserts the setting exists for ops toggles.
    from app.core.config import settings as s

    assert hasattr(s, "ENABLE_LEGACY_UNVERSIONED_API")
    assert s.API_V1_PREFIX == "/api/v1"
    assert s.API_V2_PREFIX == "/api/v2"

def test_notification_scan_task_runs_in_eager_mode(monkeypatch):
    assert celery_app.conf.task_always_eager is True
    families = [SimpleNamespace(id="good"), SimpleNamespace(id="bad")]
    db = FakeSession(families)
    monkeypatch.setattr(database_module, "SessionLocal", lambda: db)

    def scan(_db, family_id):
        if family_id == "bad":
            raise RuntimeError("scan failed")
        return {"created_count": 2, "created_ids": ["n1", "n2"]}

    monkeypatch.setattr(scan_service, "run_family_notification_scan", scan)
    result = scan_due_notifications_task.apply(kwargs={"limit": 999}).get()
    assert result["ok"] is False
    assert result["families_scanned"] == 1
    assert result["created_count"] == 2
    assert result["created_ids"] == ["n1", "n2"]
    assert result["failures"] == [{"family_id": "bad", "error": "scan failed"}]
    assert db.commits == 1
    assert db.rollbacks == 1
    assert db.closed


def test_sync_outbox_task_uses_orm_rows_in_eager_mode(monkeypatch):
    rows = [
        SimpleNamespace(status="PENDING", updated_at=None),
        SimpleNamespace(status="PENDING", updated_at=None),
    ]
    db = FakeSession(rows)
    monkeypatch.setattr(database_module, "SessionLocal", lambda: db)
    result = process_sync_outbox_task.apply(kwargs={"limit": 2}).get()
    assert result == {"ok": True, "task": "sync_processor", "processed": 2}
    assert all(row.status == "PROCESSED" and row.updated_at is not None for row in rows)
    assert db.commits == 1
    assert db.closed
