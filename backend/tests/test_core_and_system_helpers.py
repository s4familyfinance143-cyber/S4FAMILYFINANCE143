"""Unit coverage for cache, response, cookie, and architecture-system helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import Response

from app.core import api_response, auth_cookies, timeutil
from app.services import architecture_system_hooks as hooks
from app.services import family_audit, redis_cache, redis_session


class Query:
    def __init__(self, row=None):
        self.row = row

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self.row


class Db:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.added = []

    def query(self, model):
        return Query(self.rows.pop(0) if self.rows else None)

    def add(self, row):
        self.added.append(row)


def test_api_response_shapes_and_detail_conversion():
    assert api_response.success_response(3) == {
        "success": True,
        "data": 3,
        "message": api_response.SUCCESS_MESSAGE_BN,
    }
    listed = api_response.list_response((1, 2), total=9, page=2, limit=1, message="ok")
    assert listed["data"] == [1, 2]
    assert listed["meta"] == {"total": 9, "page": 2, "limit": 1}
    assert api_response.list_response([])["meta"]["total"] == 0
    assert api_response.error_response(code="NOPE", message="bad")["error"]["code"] == "NOPE"
    assert api_response.http_status_to_code(401) == "AUTH_001"
    assert api_response.http_status_to_code(418) == "HTTP_418"
    assert api_response.detail_to_message("plain") == "plain"
    assert api_response.detail_to_message({"message": "nested"}) == "nested"
    assert api_response.detail_to_message({"detail": "fallback"}) == "fallback"
    assert api_response.detail_to_message(["invalid"]) == "Validation failed"
    assert api_response.detail_to_message(7) == "7"


def test_refresh_cookie_lifecycle_and_mobile_fallback(monkeypatch):
    monkeypatch.setattr(
        auth_cookies,
        "settings",
        SimpleNamespace(
            REFRESH_COOKIE_NAME="refresh",
            REFRESH_TOKEN_EXPIRE_DAYS=2,
            IS_PRODUCTION=False,
            REFRESH_COOKIE_SECURE=False,
            REFRESH_COOKIE_SAMESITE="strict",
        ),
    )

    response = Response()
    auth_cookies.set_refresh_cookie(response, "secret")
    cookie = response.headers["set-cookie"]
    assert "refresh=secret" in cookie
    assert "HttpOnly" in cookie and "Max-Age=172800" in cookie
    assert auth_cookies.read_refresh_token(SimpleNamespace(cookies={"refresh": "cookie"}), "body") == (
        "cookie"
    )
    assert auth_cookies.read_refresh_token(SimpleNamespace(cookies={}), "body") == "body"
    assert auth_cookies.read_refresh_token(SimpleNamespace(cookies={})) is None

    cleared = Response()
    auth_cookies.clear_refresh_cookie(cleared)
    assert "refresh=" in cleared.headers["set-cookie"]


def test_memory_cache_round_trip_expiry_and_bad_json(monkeypatch):
    monkeypatch.setattr(redis_cache.settings, "REDIS_URL", "")
    redis_cache._client = None
    redis_cache._memory.clear()
    redis_cache.cache_set("item", {"amount": 4}, ttl_seconds=5)
    assert redis_cache.cache_get("item") == {"amount": 4}
    assert redis_cache.cache_status()["backend"] == "memory"

    redis_cache._memory["expired"] = (1, "{}")
    assert redis_cache.cache_get("expired") is None
    redis_cache._memory["bad"] = (0, "{")
    assert redis_cache.cache_get("bad") is None
    redis_cache.cache_delete("item")
    assert redis_cache.cache_get("item") is None


def test_redis_cache_client_paths(monkeypatch):
    class Redis:
        def __init__(self):
            self.values = {"good": '{"ok": true}', "bad": "{"}
            self.deleted = []

        def get(self, key):
            return self.values.get(key)

        def setex(self, key, ttl, raw):
            self.values[key] = raw

        def delete(self, key):
            self.deleted.append(key)

    fake = Redis()
    monkeypatch.setattr(redis_cache, "_redis", lambda: fake)
    assert redis_cache.cache_get("good") == {"ok": True}
    assert redis_cache.cache_get("missing") is None
    assert redis_cache.cache_get("bad") is None
    redis_cache.cache_set("new", [1], ttl_seconds=0)
    assert fake.values["new"] == "[1]"
    redis_cache.cache_delete("new")
    assert fake.deleted == ["new"]


def test_redis_session_helpers_with_memory_backend(monkeypatch):
    values = {}
    monkeypatch.setattr(redis_session, "_redis", lambda: None)
    monkeypatch.setattr(redis_session, "cache_set", lambda key, value, ttl_seconds: values.__setitem__(key, value))
    monkeypatch.setattr(redis_session, "cache_get", values.get)
    monkeypatch.setattr(redis_session, "cache_delete", values.pop)

    redis_session.blacklist_jti("", 5)
    redis_session.blacklist_token_hash("", 5)
    redis_session.blacklist_jti("jti", 5)
    redis_session.blacklist_token_hash("hash", 5)
    assert redis_session.is_token_blacklisted(jti="jti")
    assert redis_session.is_token_blacklisted(token_hash="hash")
    assert not redis_session.is_token_blacklisted(jti="other")

    redis_session.session_set("one", {"user": 1}, ttl_seconds=9)
    assert redis_session.session_get("one") == {"user": 1}
    values["session:bad"] = "not-a-dict"
    assert redis_session.session_get("bad") is None
    redis_session.session_delete("one")
    assert redis_session.rate_limit_incr("login", 20) == 1
    assert redis_session.rate_limit_incr("login", 20) == 2
    assert redis_session.redis_stack_status()["connected"] is False


def test_architecture_sync_rows_and_finalization():
    db = Db()
    log = hooks.record_sync_log(
        db,
        device_id="d" * 140,
        family_id="family",
        items_synced=3,
        success=True,
        error_msg="x" * 2100,
    )
    assert len(log.device_id) == 120 and len(log.error_msg) == 2000

    queued = hooks.enqueue_architecture_sync_queue(
        db,
        device_id="",
        family_id="family",
        entity_type="expense",
        entity_id=123,
        action="CREATE",
        payload={"amount": 5},
        legacy_outbox_id="legacy",
    )
    assert queued.device_id == "default-device"
    assert queued.payload == '{"amount": 5}'
    assert hooks.enqueue_architecture_sync_queue(
        db,
        device_id="d",
        family_id=None,
        entity_type="x",
        entity_id=None,
        action="",
        payload="raw",
    ).payload == "raw"

    existing = SimpleNamespace(status="PENDING", last_error=None, retry_count=0, updated_at=None)
    hooks.finalize_architecture_sync_queue(
        Db([existing]), legacy_outbox_id="legacy", status="FAILED", last_error="boom"
    )
    assert existing.status == "FAILED" and existing.retry_count == 1
    hooks.finalize_architecture_sync_queue(
        Db([None]), legacy_outbox_id="missing", status="DONE"
    )


def test_device_registry_create_and_update():
    db = Db([None])
    created = hooks.upsert_device_registry(
        db,
        user_id="user",
        device_fingerprint=" ",
        platform="android",
        app_version="1",
        family_id="family",
    )
    assert created.device_fingerprint == "unknown"
    assert db.added == [created]

    existing = SimpleNamespace(platform="ios", app_version="1", family_id="old", updated_at=None)
    result = hooks.upsert_device_registry(
        Db([existing]),
        user_id="user",
        device_fingerprint="phone",
        platform=None,
        app_version="2",
        family_id="new",
    )
    assert result is existing
    assert existing.platform == "ios" and existing.app_version == "2" and existing.family_id == "new"


def test_rate_limit_create_increment_block_and_reset(monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(hooks, "_now", lambda: now)

    allowed, created = hooks.bump_rate_limit(
        Db([None]), identifier="", endpoint="", limit=2, window_seconds=60
    )
    assert allowed and created.count == 1

    row = SimpleNamespace(count=1, window_start=now, blocked_until=None)
    assert hooks.bump_rate_limit(
        Db([row]), identifier="u", endpoint="/login", limit=2
    )[0]
    assert row.count == 2
    assert not hooks.bump_rate_limit(
        Db([row]), identifier="u", endpoint="/login", limit=2
    )[0]
    assert row.blocked_until == now + timedelta(seconds=60)
    assert not hooks.bump_rate_limit(
        Db([row]), identifier="u", endpoint="/login", limit=2
    )[0]

    stale = SimpleNamespace(count=9, window_start=now - timedelta(seconds=61), blocked_until=None)
    allowed, reset = hooks.bump_rate_limit(
        Db([stale]), identifier="u", endpoint="/", limit=2, window_seconds=60
    )
    assert allowed and reset.count == 1 and reset.blocked_until is None


def test_time_and_family_audit_helpers(monkeypatch):
    assert timeutil.utc_now().tzinfo is None
    assert timeutil.utc_now_aware().tzinfo == timezone.utc

    calls = []
    monkeypatch.setattr(family_audit, "write_audit_log", lambda db, **kwargs: calls.append(kwargs))
    family_audit.write_family_audit(
        object(), family_id="family", member_id="member", action_type="UPDATE", entity_type="FAMILY"
    )
    assert calls[0]["title"] == "UPDATE"

    monkeypatch.setattr(
        family_audit, "write_audit_log", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError())
    )
    family_audit.write_family_audit(
        object(), family_id="family", member_id=None, action_type="X", entity_type="Y"
    )
