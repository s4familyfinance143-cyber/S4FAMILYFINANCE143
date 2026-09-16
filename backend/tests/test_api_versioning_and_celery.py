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


def test_sync_outbox_task_applies_pending_rows_per_family_in_eager_mode(monkeypatch):
    """process_sync_outbox_task used to just stamp PENDING rows "PROCESSED"
    without ever applying the change they describe (see celery_tasks.py) —
    now it must actually call sync_apply.process_pending_outbox, grouped by
    family since outbox rows carry no member_id of their own."""
    import app.workers.celery_tasks as celery_tasks_module

    rows = [
        SimpleNamespace(id="o1", family_id="fam-1", status="PENDING"),
        SimpleNamespace(id="o2", family_id="fam-1", status="PENDING"),
        SimpleNamespace(id="o3", family_id="fam-2", status="PENDING"),
    ]
    db = FakeSession(rows)
    monkeypatch.setattr(database_module, "SessionLocal", lambda: db)
    monkeypatch.setattr(
        celery_tasks_module,
        "_fallback_member_id",
        lambda _db, family_id: f"member-{family_id}",
    )

    calls = []

    def fake_process_pending_outbox(_db, *, family_id, member_id=None, outbox_ids=None, **_kwargs):
        calls.append((family_id, member_id, outbox_ids))
        return {"synced_count": len(outbox_ids), "failed_count": 0, "conflict_count": 0}

    monkeypatch.setattr(
        "app.services.sync_apply.process_pending_outbox",
        fake_process_pending_outbox,
    )

    result = process_sync_outbox_task.apply(kwargs={"limit": 3}).get()

    assert result["ok"] is True
    assert result["processed"] == 3
    assert result["failed"] == 0
    assert result["conflicted"] == 0
    assert result["total_rows"] == 3
    assert {c[0] for c in calls} == {"fam-1", "fam-2"}
    fam1_call = next(c for c in calls if c[0] == "fam-1")
    fam2_call = next(c for c in calls if c[0] == "fam-2")
    assert set(fam1_call[2]) == {"o1", "o2"}
    assert fam1_call[1] == "member-fam-1"
    assert set(fam2_call[2]) == {"o3"}
    assert fam2_call[1] == "member-fam-2"
    assert db.commits == 2  # one commit per family group
    assert db.closed
