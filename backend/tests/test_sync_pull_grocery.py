"""Sync pull includes grocery tables (Phase 10B)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.api.v1 import offline_sync_hardened as sync


def test_sync_pull_payload_includes_grocery_keys(monkeypatch):
    db = MagicMock()
    user = MagicMock()

    monkeypatch.setattr(sync, "_phase10b_require_any_permission", lambda *a, **k: None)
    monkeypatch.setattr(sync, "_phase10b_register_device", lambda *a, **k: None)
    monkeypatch.setattr(sync, "_phase10b_insert_audit", lambda *a, **k: None)
    monkeypatch.setattr(sync, "_phase10b_family_rows", lambda *a, **k: [{"id": "x"}])
    monkeypatch.setattr(sync, "_phase10b_transaction_line_rows", lambda *a, **k: [])
    monkeypatch.setattr(sync, "_phase10b_now_token", lambda: "token-1")
    monkeypatch.setattr(sync, "_phase10b_json", lambda payload: payload)
    monkeypatch.setattr(sync, "_phase10b_json_text", lambda payload: "{}")

    execute = MagicMock()
    db.execute = execute
    db.commit = MagicMock()

    result = sync.phase10b_sync_pull(
        family_id="fam-1",
        device_id="test-device",
        since_token=None,
        limit=10,
        db=db,
        current_user=user,
    )

    assert result["status"] == "ok"
    changes = result["changes"]
    for key in ("grocery_lists", "grocery_items", "grocery_vendors"):
        assert key in changes
        assert key in result["change_counts"]
