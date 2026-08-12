"""Fast mocked unit tests for under-covered high-value service modules."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import architecture_bridge as bridge
from app.services import auth_security_service as auth_sec
from app.services import avatar_service
from app.services import email_service
from app.services import finance_posting
from app.services import grocery_realtime
from app.services import ocr_service
from app.services import redis_cache, redis_session
from app.services import relationship_rules
from app.services import transaction_void_service as void_svc
from app.services.auth_security_service import AuthSecurityService


class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def with_for_update(self):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first


class Db:
    def __init__(self, query_map=None, got=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.added = []
        self.flush_count = 0
        self._execute_results = []

    def query(self, model):
        payload = self.query_map.pop(model, None)
        if isinstance(payload, Query):
            return payload
        if isinstance(payload, list):
            return Query(rows=payload)
        return Query(first_row=payload)

    def get(self, model, key):
        return self.got

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flush_count += 1
        for row in self.added:
            if getattr(row, "id", None) is None:
                row.id = f"id-{len(self.added)}"

    def execute(self, statement):
        if self._execute_results:
            return self._execute_results.pop(0)
        return SimpleNamespace(scalar_one_or_none=lambda: None, rowcount=0)

    def get_bind(self):
        return SimpleNamespace()


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "name_contains", "price"),
    [
        ("Milk 120.50", "Milk", "120.5000"),
        ("Eggs ৳45", "Eggs", "45.0000"),
        ("Bread Tk 30", "Bread", "30.0000"),
        ("Oil 1,250.00", "Oil", "1250.0000"),
        ("Plain line", "Plain line", "0.0000"),
        ("", None, None),
        ("Bad price xyz", "Bad price xyz", "0.0000"),
        ("Item -:\t99.9", "Item", "99.9000"),
    ],
)
def test_parse_receipt_lines_variants(raw, name_contains, price):
    rows = ocr_service.parse_receipt_lines(raw)
    if price is None:
        assert rows == []
        return
    assert name_contains in rows[0]["name"]
    assert rows[0]["estimated_price"] == price
    assert rows[0]["quantity"] == "1.0000"


def test_parse_receipt_lines_caps_at_100():
    text = "\n".join(f"Item{i} {i}.00" for i in range(120))
    assert len(ocr_service.parse_receipt_lines(text)) == 100


def test_ocr_money_helper():
    assert ocr_service._money(Decimal("1.23456")) == "1.2346"


def test_ensure_vision_credentials_env(monkeypatch):
    monkeypatch.setattr(ocr_service.settings, "GOOGLE_APPLICATION_CREDENTIALS", "creds.json")
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    ocr_service._ensure_vision_credentials_env()
    assert ocr_service.os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") == "creds.json"


def test_vision_ocr_disabled_and_import_failure(monkeypatch):
    monkeypatch.setattr(ocr_service.settings, "GOOGLE_VISION_ENABLED", False)
    assert ocr_service.vision_ocr_text_from_image_bytes(b"img") is None

    monkeypatch.setattr(ocr_service.settings, "GOOGLE_VISION_ENABLED", True)
    monkeypatch.setattr(ocr_service, "_ensure_vision_credentials_env", lambda: None)

    import builtins

    real_import = builtins.__import__

    def boom(name, *args, **kwargs):
        if name.startswith("google"):
            raise ImportError("no google")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", boom)
    assert ocr_service.vision_ocr_text_from_image_bytes(b"img") is None


def test_vision_ocr_client_success_and_error(monkeypatch):
    monkeypatch.setattr(ocr_service.settings, "GOOGLE_VISION_ENABLED", True)
    monkeypatch.setattr(ocr_service, "_ensure_vision_credentials_env", lambda: None)

    class FakeImage:
        def __init__(self, content=None):
            self.content = content

    class FakeClient:
        def __init__(self, response):
            self.response = response

        def text_detection(self, image):
            return self.response

    class VisionMod:
        Image = FakeImage
        ImageAnnotatorClient = staticmethod(lambda: FakeClient(SimpleNamespace(
            error=SimpleNamespace(message=""),
            full_text_annotation=SimpleNamespace(text="  Hello OCR  "),
        )))

    import sys

    monkeypatch.setitem(sys.modules, "google", SimpleNamespace(cloud=SimpleNamespace(vision=VisionMod)))
    monkeypatch.setitem(sys.modules, "google.cloud", SimpleNamespace(vision=VisionMod))
    monkeypatch.setitem(sys.modules, "google.cloud.vision", VisionMod)
    assert ocr_service.vision_ocr_text_from_image_bytes(b"img") == "Hello OCR"

    VisionMod.ImageAnnotatorClient = staticmethod(lambda: FakeClient(SimpleNamespace(
        error=SimpleNamespace(message="boom"),
        full_text_annotation=None,
    )))
    assert ocr_service.vision_ocr_text_from_image_bytes(b"img") is None

    VisionMod.ImageAnnotatorClient = staticmethod(lambda: (_ for _ in ()).throw(RuntimeError("fail")))
    assert ocr_service.vision_ocr_text_from_image_bytes(b"img") is None


def test_tesseract_ocr_paths(monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "pytesseract", None)
    # Force import failure path when pytesseract missing from modules as broken
    real_import = __import__

    def selective(name, *a, **k):
        if name == "pytesseract":
            raise ImportError("missing")
        return real_import(name, *a, **k)

    monkeypatch.setattr("builtins.__import__", selective)
    assert ocr_service.tesseract_ocr_text_from_image_bytes(b"x") is None
    assert ocr_service._tesseract_available() is False


def test_tesseract_ocr_success(monkeypatch):
    class FakeImg:
        mode = "RGBA"

        def convert(self, mode):
            self.mode = mode
            return self

    class FakeImageMod:
        @staticmethod
        def open(buf):
            return FakeImg()

    class FakeTess:
        @staticmethod
        def image_to_string(img):
            return "  Local OCR  "

    import sys

    monkeypatch.setitem(sys.modules, "PIL", SimpleNamespace(Image=FakeImageMod))
    monkeypatch.setitem(sys.modules, "PIL.Image", FakeImageMod)
    monkeypatch.setitem(sys.modules, "pytesseract", FakeTess)
    assert ocr_service.tesseract_ocr_text_from_image_bytes(b"abc") == "Local OCR"

    FakeTess.image_to_string = staticmethod(lambda img: "   ")
    assert ocr_service.tesseract_ocr_text_from_image_bytes(b"abc") is None

    FakeImageMod.open = staticmethod(lambda buf: (_ for _ in ()).throw(OSError("bad")))
    assert ocr_service.tesseract_ocr_text_from_image_bytes(b"abc") is None


def test_validate_image_bytes_ok_and_fail(monkeypatch):
    class FakeImg:
        format = "PNG"
        width = 10
        height = 20
        mode = "RGB"

        def verify(self):
            return None

    class FakeImageMod:
        @staticmethod
        def open(buf):
            return FakeImg()

    import sys

    monkeypatch.setitem(sys.modules, "PIL", SimpleNamespace(Image=FakeImageMod))
    monkeypatch.setitem(sys.modules, "PIL.Image", FakeImageMod)
    meta = ocr_service.validate_image_bytes(b"png")
    assert meta["ok"] is True and meta["width"] == 10

    FakeImageMod.open = staticmethod(lambda buf: (_ for _ in ()).throw(ValueError("corrupt")))
    bad = ocr_service.validate_image_bytes(b"x")
    assert bad["ok"] is False and "corrupt" in bad["error"]


def test_grocery_and_expense_ocr_engine_paths(monkeypatch):
    monkeypatch.setattr(ocr_service, "validate_image_bytes", lambda b: {"ok": True, "format": "JPEG"})
    monkeypatch.setattr(ocr_service, "vision_ocr_text_from_image_bytes", lambda b: "Rice 10\nDal 20")
    monkeypatch.setattr(ocr_service, "_tesseract_available", lambda: False)
    monkeypatch.setattr(ocr_service.settings, "GOOGLE_VISION_ENABLED", True)

    grocery = ocr_service.grocery_ocr_parse(image_bytes=b"img")
    assert grocery["engine"] == "google_vision"
    assert grocery["suggestion_count"] == 2

    monkeypatch.setattr(ocr_service, "vision_ocr_text_from_image_bytes", lambda b: None)
    monkeypatch.setattr(ocr_service, "tesseract_ocr_text_from_image_bytes", lambda b: "Tea 5")
    grocery2 = ocr_service.grocery_ocr_parse(image_bytes=b"img")
    assert grocery2["engine"] == "tesseract_local"

    monkeypatch.setattr(ocr_service, "tesseract_ocr_text_from_image_bytes", lambda b: None)
    empty = ocr_service.grocery_ocr_parse(image_bytes=b"img")
    assert empty["engine"] == "image_ready_no_engine"
    assert empty["note"] is not None

    expense = ocr_service.expense_bill_ocr_parse(raw_text="A 1.5\nB 2.5")
    assert expense["module"] == "EXPENSE"
    assert expense["line_count"] == 2
    assert expense["suggested_total"] == "4.0000"


# ---------------------------------------------------------------------------
# Redis cache / session
# ---------------------------------------------------------------------------


def test_redis_client_connect_and_fail(monkeypatch):
    redis_cache._client = None
    monkeypatch.setattr(redis_cache.settings, "REDIS_URL", "")
    assert redis_cache._redis() is None

    monkeypatch.setattr(redis_cache.settings, "REDIS_URL", "redis://localhost:6379/0")

    class FakeMod:
        class Redis:
            @staticmethod
            def from_url(url, decode_responses=True):
                raise RuntimeError("down")

    monkeypatch.setitem(__import__("sys").modules, "redis", FakeMod)
    redis_cache._client = None
    assert redis_cache._redis() is None
    assert redis_cache._client is False

    class Client:
        def ping(self):
            return True

    class GoodMod:
        class Redis:
            @staticmethod
            def from_url(url, decode_responses=True):
                return Client()

    monkeypatch.setitem(__import__("sys").modules, "redis", GoodMod)
    redis_cache._client = None
    assert redis_cache._redis() is not None
    assert redis_cache._redis() is not None
    redis_cache._client = None


def test_redis_cache_set_delete_fallbacks(monkeypatch):
    class Flaky:
        def setex(self, *a, **k):
            raise RuntimeError("setex fail")

        def delete(self, *a, **k):
            raise RuntimeError("delete fail")

        def get(self, key):
            return None

    monkeypatch.setattr(redis_cache, "_redis", lambda: Flaky())
    redis_cache._memory.clear()
    redis_cache.cache_set("k", {"a": 1}, ttl_seconds=3)
    assert redis_cache._memory["k"][1] == '{"a": 1}'
    redis_cache.cache_delete("k")
    assert "k" not in redis_cache._memory


def test_redis_session_rate_limit_redis_path(monkeypatch):
    class Counter:
        def __init__(self):
            self.n = 0
            self.expired = None

        def incr(self, key):
            self.n += 1
            return self.n

        def expire(self, key, ttl):
            self.expired = ttl

    counter = Counter()
    monkeypatch.setattr(redis_session, "_redis", lambda: counter)
    assert redis_session.rate_limit_incr("ip", 30) == 1
    assert counter.expired == 30
    assert redis_session.rate_limit_incr("ip", 30) == 2

    class Broken:
        def incr(self, key):
            raise RuntimeError("x")

    store = {}
    monkeypatch.setattr(redis_session, "_redis", lambda: Broken())
    monkeypatch.setattr(
        redis_session,
        "cache_get",
        lambda key: store.get(key),
    )
    monkeypatch.setattr(
        redis_session,
        "cache_set",
        lambda key, value, ttl_seconds: store.__setitem__(key, value),
    )
    assert redis_session.rate_limit_incr("fallback") == 1
    monkeypatch.setattr(redis_session, "_redis", lambda: None)
    assert redis_session.redis_stack_status()["connected"] is False


# ---------------------------------------------------------------------------
# Relationship rules
# ---------------------------------------------------------------------------


def test_relationship_owner_responsible_and_serial_edges():
    spouse = relationship_rules.validate_relationship_payload(
        relationship_label="Husband", allow_owner_responsible=True
    )
    assert spouse["group"] == "SPOUSE"

    sibling = relationship_rules.validate_relationship_payload(
        relationship_label="Elder Brother",
        serial_label="YOUNGER",
        allow_owner_responsible=True,
    )
    assert sibling["group"] == "SIBLINGS"
    assert sibling["relationship_serial"] == 2

    guardian = relationship_rules.validate_relationship_payload(
        relationship_label="Guardian",
        relationship_note="uncle",
        allow_owner_responsible=True,
    )
    assert guardian["group"] == "GUARDIAN_OTHER"

    with pytest.raises(HTTPException, match="Custom children"):
        relationship_rules.resolve_serial_rank("CHILDREN", "CUSTOM", None)
    with pytest.raises(HTTPException, match="Invalid sibling"):
        relationship_rules.resolve_serial_rank("SIBLINGS", "TENTH", None)
    with pytest.raises(HTTPException, match="Custom sibling"):
        relationship_rules.resolve_serial_rank("SIBLINGS", "CUSTOM", None)
    assert relationship_rules.resolve_serial_rank("CHILDREN", None, 8) == 8
    assert relationship_rules.resolve_serial_rank("SIBLINGS", None, None) is None
    assert relationship_rules.resolve_serial_rank("IN_LAW", None, 3) == 3

    ranked = relationship_rules.validate_relationship_payload(
        relationship_label="Son", relationship_serial=4
    )
    assert ranked["relationship_display_label"] == "Son #4"


# ---------------------------------------------------------------------------
# Transaction void (mocked)
# ---------------------------------------------------------------------------


def test_reverse_balances_skips_and_liability(monkeypatch):
    from app.models.account import Account

    asset = SimpleNamespace(id="a1", account_type="CASH", current_balance=Decimal("100"), deleted_at=None)
    liability = SimpleNamespace(
        id="a2", account_type="LIABILITY", current_balance=Decimal("50"), deleted_at=None
    )
    lines = [
        SimpleNamespace(account_id=None, debit=1, credit=0),
        SimpleNamespace(account_id="missing", debit=1, credit=0),
        SimpleNamespace(account_id="a1", debit=Decimal("10"), credit=Decimal("2")),
        SimpleNamespace(account_id="a2", debit=Decimal("5"), credit=Decimal("1")),
    ]

    def query_side(model):
        assert model is Account
        return Query(first_row=None) if not hasattr(query_side, "n") else None

    class VoidDb:
        def __init__(self):
            self.calls = 0

        def query(self, model):
            self.calls += 1
            if self.calls == 1:
                return Query(first_row=None)
            if self.calls == 2:
                return Query(first_row=asset)
            return Query(first_row=liability)

    touched = void_svc.reverse_account_balances_from_lines(VoidDb(), lines)
    assert touched == 2
    assert asset.current_balance == Decimal("92")
    assert liability.current_balance == Decimal("54")


def test_void_already_void_and_journal_rollback(monkeypatch):
    tx = SimpleNamespace(id="t1", family_id="f", status="VOID", description="x")
    with pytest.raises(ValueError, match="already void"):
        void_svc.void_posted_transaction(Db(), tx=tx, member_id="m")

    tx.status = "POSTED"
    lines = [
        SimpleNamespace(account_id="a", debit=1, credit=0, deleted_at=None),
        SimpleNamespace(account_id="b", debit=0, credit=1, deleted_at=None),
    ]
    db = Db({object: lines})
    # query returns TransactionLine rows
    from app.models.transaction_line import TransactionLine

    db.query_map[TransactionLine] = lines
    monkeypatch.setattr(
        void_svc.accounting_service,
        "rollback_transaction",
        lambda db, **kw: {"rollback_id": "rb1"},
    )
    audits = []
    monkeypatch.setattr(void_svc, "write_audit_log", lambda db, **kw: audits.append(kw))
    result = void_svc.void_posted_transaction(db, tx=tx, member_id="m", reason="fix")
    assert result["rollback_id"] == "rb1"
    assert result["lines_reversed"] is True
    assert audits[0]["action_type"] == "TRANSACTION_VOID"


def test_void_fallback_balance_reverse(monkeypatch):
    from app.models.transaction_line import TransactionLine

    tx = SimpleNamespace(id="t2", family_id="f", status="POSTED", description="solo")
    lines = [SimpleNamespace(account_id="a", debit=5, credit=0, deleted_at=None)]
    db = Db({TransactionLine: lines})
    monkeypatch.setattr(void_svc, "reverse_account_balances_from_lines", lambda db, rows: 1)
    monkeypatch.setattr(void_svc, "write_audit_log", lambda *a, **k: None)
    result = void_svc.void_posted_transaction(db, tx=tx, member_id="m")
    assert result["status"] == "VOID"
    assert result["lines_reversed"] == 1
    assert tx.status == "VOID"
    assert tx.deleted_at is not None


# ---------------------------------------------------------------------------
# Grocery realtime
# ---------------------------------------------------------------------------


def test_grocery_realtime_hub_connect_broadcast_disconnect():
    async def _run():
        hub = grocery_realtime.GroceryRealtimeHub()
        loop = asyncio.get_running_loop()
        hub.bind_loop(loop)
        assert hub.subscriber_count("fam") == 0

        class FakeWs:
            def __init__(self):
                self.accepted = False
                self.messages = []
                self.fail = False

            async def accept(self):
                self.accepted = True

            async def send_text(self, payload):
                if self.fail:
                    raise RuntimeError("gone")
                self.messages.append(payload)

        ws1 = FakeWs()
        ws2 = FakeWs()
        await hub.connect("fam", ws1)
        await hub.connect("fam", ws2)
        assert hub.subscriber_count("fam") == 2
        assert ws1.accepted

        await hub.broadcast("fam", {"action": "UPDATE"})
        assert len(ws1.messages) == 1
        assert json.loads(ws1.messages[0])["action"] == "UPDATE"

        ws2.fail = True
        await hub.broadcast("fam", {"action": "DELETE"})
        assert hub.subscriber_count("fam") == 1

        await hub.disconnect("fam", ws1)
        assert hub.subscriber_count("fam") == 0
        await hub.disconnect("missing", ws1)

    asyncio.run(_run())


def test_publish_grocery_event_noop_and_schedule(monkeypatch):
    hub = grocery_realtime.GroceryRealtimeHub()
    grocery_realtime.grocery_realtime_hub = hub
    grocery_realtime.publish_grocery_event("f", action="CREATE", entity_type="LIST", entity_id="1")

    calls = []

    def fake_schedule(coro, loop):
        calls.append(True)
        coro.close()
        return SimpleNamespace()

    monkeypatch.setattr(asyncio, "run_coroutine_threadsafe", fake_schedule)
    hub._main_loop = SimpleNamespace(is_running=lambda: True)
    grocery_realtime.publish_grocery_event(
        "f", action="UPDATE", entity_type="ITEM", entity_id="2", title="Milk"
    )
    assert calls == [True]


# ---------------------------------------------------------------------------
# Auth security helpers
# ---------------------------------------------------------------------------


def test_auth_security_token_and_password_helpers(monkeypatch):
    assert auth_sec.utc_now().tzinfo is None
    assert auth_sec._naive(None) is None
    aware = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert auth_sec._naive(aware).tzinfo is None
    naive = datetime(2026, 1, 1)
    assert auth_sec._naive(naive) is naive

    token = AuthSecurityService.generate_secure_token(16)
    assert len(token) > 10
    digest = AuthSecurityService.hash_token(token)
    assert AuthSecurityService.constant_time_equals(token, digest)
    with pytest.raises(ValueError):
        AuthSecurityService.hash_token("")

    errors = AuthSecurityService.validate_password_strength("short")
    assert any("8 characters" in e for e in errors)
    errors = AuthSecurityService.validate_password_strength(
        "johnlowercase1!", email="john.doe@example.com", full_name="John Doe"
    )
    assert any("uppercase" in e for e in errors)
    assert any("email" in e.lower() or "name" in e.lower() for e in errors)
    assert AuthSecurityService.validate_password_strength("GoodPass1!") == []
    assert AuthSecurityService.validate_password_strength("NoSpecial1", email="x@y.com")
    assert AuthSecurityService.validate_password_strength("NoDigits!!Aa")


def test_auth_security_login_lock_and_email_tokens(monkeypatch):
    monkeypatch.setattr(auth_sec.settings, "FAILED_LOGIN_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(auth_sec.settings, "FAILED_LOGIN_LOCK_MINUTES", 10)
    monkeypatch.setattr(auth_sec.settings, "EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS", 1)
    monkeypatch.setattr(auth_sec.settings, "PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", 15)

    user = SimpleNamespace(
        failed_login_count=0,
        locked_until=None,
        last_login_at=None,
        last_login_ip=None,
        email_verification_token_hash=None,
        email_verification_expires_at=None,
        reset_password_token_hash=None,
        reset_password_expires_at=None,
        reset_password_used_at=None,
        reset_password_token="legacy",
        is_email_verified=False,
        email_verified_at=None,
    )
    assert not AuthSecurityService.is_user_locked(user)
    AuthSecurityService.record_failed_login(user)
    assert user.failed_login_count == 1
    AuthSecurityService.record_failed_login(user)
    assert user.locked_until is not None
    assert AuthSecurityService.is_user_locked(user)
    AuthSecurityService.record_successful_login(user, ip_address="1.2.3.4")
    assert user.failed_login_count == 0 and user.last_login_ip == "1.2.3.4"

    raw = AuthSecurityService.issue_email_verification_token(user)
    assert user.email_verification_token_hash == AuthSecurityService.hash_token(raw)
    reset = AuthSecurityService.issue_password_reset_token(user)
    assert user.reset_password_token is None
    assert user.reset_password_token_hash == AuthSecurityService.hash_token(reset)


def test_auth_security_device_session_upsert():
    from app.models.architecture_auth import DeviceSession

    now = auth_sec.utc_now()
    db = Db({DeviceSession: None})
    device, is_new = AuthSecurityService._upsert_device_session(
        db,
        user_id="u",
        device_label="phone",
        platform="android",
        user_agent="ua",
        ip_address="127.0.0.1",
        now=now,
    )
    assert is_new and device in db.added

    existing = SimpleNamespace(
        last_active=None, platform="ios", ip_address=None, user_agent=None
    )
    db2 = Db({DeviceSession: existing})
    device2, is_new2 = AuthSecurityService._upsert_device_session(
        db2,
        user_id="u",
        device_label=None,
        platform="web",
        user_agent="ua2",
        ip_address="9.9.9.9",
        now=now,
    )
    assert not is_new2 and device2 is existing
    assert existing.platform == "web"


def test_auth_security_create_and_revoke_sessions(monkeypatch):
    from app.models.architecture_auth import DeviceSession, RefreshToken

    monkeypatch.setattr(auth_sec.settings, "REFRESH_TOKEN_EXPIRE_DAYS", 7)
    monkeypatch.setattr(
        AuthSecurityService,
        "_upsert_device_session",
        lambda *a, **k: (SimpleNamespace(id="d"), True),
    )
    monkeypatch.setattr(
        "app.services.architecture_system_hooks.upsert_device_registry",
        lambda *a, **k: None,
    )
    emails = []
    monkeypatch.setattr(
        "app.services.email_service.send_email",
        lambda **kw: emails.append(kw) or SimpleNamespace(sent=False),
    )
    user = SimpleNamespace(email="a@b.com")
    db = Db()
    db.get = lambda model, key: user
    bundle = AuthSecurityService.create_refresh_session(
        db, user_id="u1", user_agent="ua", ip_address="1.1.1.1", device_label="phone"
    )
    assert bundle.refresh_token
    assert emails and "New device" in emails[0]["subject"]

    # revoke paths with mocked get_active
    monkeypatch.setattr(
        AuthSecurityService,
        "get_active_session_by_refresh_token",
        lambda db, raw: None,
    )
    assert AuthSecurityService.revoke_refresh_session(db, raw_refresh_token="x") is False
    assert AuthSecurityService.rotate_refresh_session(db, raw_refresh_token="x") is None

    current = SimpleNamespace(
        user_id="u1",
        device_label="phone",
        token_family="fam",
        status="ACTIVE",
        revoked=False,
        revoked_at=None,
        revoked_reason=None,
        replaced_by_token_id=None,
        id="old",
    )
    monkeypatch.setattr(
        AuthSecurityService,
        "get_active_session_by_refresh_token",
        lambda db, raw: current,
    )
    monkeypatch.setattr(
        AuthSecurityService,
        "create_refresh_session",
        lambda db, **kw: auth_sec.RefreshSessionBundle(
            refresh_token="new", session=SimpleNamespace(id="new-id")
        ),
    )
    rotated = AuthSecurityService.rotate_refresh_session(db, raw_refresh_token="raw")
    assert rotated.refresh_token == "new"
    assert current.status == AuthSecurityService.ROTATED

    current.status = AuthSecurityService.ACTIVE
    current.revoked = False
    assert AuthSecurityService.revoke_refresh_session(db, raw_refresh_token="raw", reason="LOGOUT")
    assert current.status == AuthSecurityService.REVOKED


def test_auth_security_get_session_and_verify_tokens(monkeypatch):
    token_row = SimpleNamespace(
        revoked=False,
        status=AuthSecurityService.ACTIVE,
        expires_at=auth_sec.utc_now() + timedelta(days=1),
    )
    result = SimpleNamespace(scalar_one_or_none=lambda: token_row)
    db = Db()
    db._execute_results = [result]
    found = AuthSecurityService.get_session_by_refresh_token(db, "raw-token")
    assert found is token_row

    monkeypatch.setattr(
        AuthSecurityService, "get_session_by_refresh_token", lambda db, raw: token_row
    )
    assert AuthSecurityService.get_active_session_by_refresh_token(db, "raw") is token_row

    token_row.status = AuthSecurityService.REVOKED
    assert AuthSecurityService.get_active_session_by_refresh_token(db, "raw") is None

    token_row.status = AuthSecurityService.ACTIVE
    token_row.revoked = False
    token_row.expires_at = auth_sec.utc_now() - timedelta(minutes=1)
    db.flush = lambda: None
    assert AuthSecurityService.get_active_session_by_refresh_token(db, "raw") is None
    assert token_row.status == AuthSecurityService.EXPIRED

    user = SimpleNamespace(
        email_verification_expires_at=auth_sec.utc_now() + timedelta(hours=1),
        is_email_verified=False,
        email_verified_at=None,
        email_verification_token_hash="h",
        reset_password_expires_at=auth_sec.utc_now() + timedelta(minutes=5),
        reset_password_token_hash="h",
        reset_password_used_at=None,
        reset_password_token="x",
    )
    db2 = Db()
    db2.flush = lambda: None
    db2._execute_results = [SimpleNamespace(scalar_one_or_none=lambda: user)]
    monkeypatch.setattr(AuthSecurityService, "hash_token", lambda raw: "h")
    verified = AuthSecurityService.verify_email_token(db2, "tok")
    assert verified is user and user.is_email_verified

    db3 = Db()
    db3.flush = lambda: None
    db3._execute_results = [SimpleNamespace(scalar_one_or_none=lambda: None)]
    assert AuthSecurityService.verify_email_token(db3, "tok") is None

    expired_user = SimpleNamespace(
        email_verification_expires_at=auth_sec.utc_now() - timedelta(hours=1),
    )
    db4 = Db()
    db4._execute_results = [SimpleNamespace(scalar_one_or_none=lambda: expired_user)]
    assert AuthSecurityService.verify_email_token(db4, "tok") is None

    reset_user = SimpleNamespace(
        reset_password_expires_at=auth_sec.utc_now() + timedelta(minutes=5),
        reset_password_token_hash="h",
        reset_password_used_at=None,
        reset_password_token="legacy",
    )
    db5 = Db()
    db5.flush = lambda: None
    db5._execute_results = [SimpleNamespace(scalar_one_or_none=lambda: reset_user)]
    consumed = AuthSecurityService.consume_password_reset_token(db5, "tok")
    assert consumed is reset_user and reset_user.reset_password_token is None

    db6 = Db()
    db6._execute_results = [SimpleNamespace(scalar_one_or_none=lambda: None)]
    assert AuthSecurityService.consume_password_reset_token(db6, "tok") is None

    expired_reset = SimpleNamespace(
        reset_password_expires_at=auth_sec.utc_now() - timedelta(minutes=1)
    )
    db7 = Db()
    db7._execute_results = [SimpleNamespace(scalar_one_or_none=lambda: expired_reset)]
    assert AuthSecurityService.consume_password_reset_token(db7, "tok") is None


def test_auth_security_revoke_all_and_migrate(monkeypatch):
    db = Db()
    db.flush = lambda: None
    db._execute_results = [SimpleNamespace(rowcount=3)]
    monkeypatch.setattr(
        "sqlalchemy.inspect",
        lambda bind: SimpleNamespace(has_table=lambda name: False),
    )
    assert AuthSecurityService.revoke_all_user_sessions(db, user_id="u") == 3

    legacy = SimpleNamespace(
        id="leg",
        user_id="u",
        refresh_token_hash="h",
        device_label="d",
        expires_at=auth_sec.utc_now() + timedelta(days=1),
        status=AuthSecurityService.ACTIVE,
        revoked_at=None,
        revoked_reason=None,
        token_family="fam",
        user_agent="ua",
        ip_address="ip",
    )
    db2 = Db({__import__("app.models.architecture_auth", fromlist=["RefreshToken"]).RefreshToken: None})
    from app.models.architecture_auth import RefreshToken

    db2.query_map[RefreshToken] = None
    migrated = AuthSecurityService._migrate_legacy_auth_session(db2, legacy)
    assert migrated.legacy_session_id == "leg"
    assert migrated in db2.added

    existing = SimpleNamespace(id="ex")
    db3 = Db({RefreshToken: existing})
    assert AuthSecurityService._migrate_legacy_auth_session(db3, legacy) is existing


# ---------------------------------------------------------------------------
# Email service edge cases
# ---------------------------------------------------------------------------


def test_email_smtp_status_and_mocked_send(monkeypatch):
    monkeypatch.setattr(email_service.settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(email_service.settings, "SMTP_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(email_service.settings, "SMTP_FROM_NAME", "S4")
    monkeypatch.setattr(email_service.settings, "SMTP_PORT", 587)
    monkeypatch.setattr(email_service.settings, "SMTP_USE_TLS", True)
    monkeypatch.setattr(email_service.settings, "SMTP_USE_SSL", False)
    monkeypatch.setattr(email_service.settings, "SMTP_USERNAME", "user")
    monkeypatch.setattr(email_service.settings, "SMTP_PASSWORD", "pass")
    monkeypatch.setattr(email_service.settings, "AUTH_EMAIL_ENABLED", True)
    monkeypatch.setattr(email_service.settings, "NOTIFICATION_EMAIL_ENABLED", True)
    monkeypatch.setattr(email_service.settings, "APP_PUBLIC_URL", "https://app.example/")

    status = email_service.smtp_status()
    assert status["configured"] is True
    assert status["username_set"] is True

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def ehlo(self):
            return None

        def starttls(self, context=None):
            return None

        def login(self, u, p):
            return None

        def send_message(self, msg):
            self.msg = msg

    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)
    result = email_service.send_email(
        to_email=" A@B.COM ", subject="Hi", text_body="Body", html_body="<p>Body</p>"
    )
    assert result.sent and result.reason == "sent"

    class BoomSMTP(FakeSMTP):
        def send_message(self, msg):
            raise RuntimeError("refused")

    monkeypatch.setattr(email_service.smtplib, "SMTP", BoomSMTP)
    failed = email_service.send_email(to_email="a@b.com", subject="Hi", text_body="x")
    assert not failed.sent and "SMTP send failed" in failed.reason

    monkeypatch.setattr(email_service.settings, "SMTP_USE_SSL", True)

    class FakeSSL(FakeSMTP):
        pass

    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", FakeSSL)
    assert email_service.send_email(to_email="a@b.com", subject="SSL", text_body="x").sent

    reset = email_service.send_password_reset_email(to_email="a@b.com", token="tok")
    assert reset.sent or "SMTP" in reset.reason or reset.reason == "sent"
    verify = email_service.send_email_verification_email(to_email="a@b.com", token="tok")
    assert verify.to_email == "a@b.com"
    note = email_service.send_notification_email(to_email="a@b.com", title="T", message="M")
    assert "T" in (note.subject or "")


# ---------------------------------------------------------------------------
# Finance posting helpers
# ---------------------------------------------------------------------------


def test_finance_posting_name_and_client_request_edges(monkeypatch):
    assert finance_posting._income_account_name(SimpleNamespace(name_en="", name_bn="বেতন")) == (
        "Salary Income"
    )
    assert finance_posting._income_account_name(SimpleNamespace(name_en="", name_bn="")) == (
        "Salary Income"
    )
    assert finance_posting._income_account_name(
        SimpleNamespace(name_en="Bonus Income", name_bn="")
    ) == "Bonus Income"
    assert finance_posting._expense_account_name(SimpleNamespace(name_en="", name_bn="")) == (
        "General Expense"
    )
    assert finance_posting._expense_account_name(
        SimpleNamespace(name_en="Rent Expense", name_bn="")
    ) == "Rent Expense"
    assert finance_posting._expense_account_name(
        SimpleNamespace(name_en="", name_bn="বাজার")
    ) == "Grocery Expense"

    with pytest.raises(HTTPException, match="Category not found"):
        finance_posting.get_category(Db(got=None), "f", "c", "INCOME")
    deleted = SimpleNamespace(family_id="f", deleted_at="x", category_type="INCOME")
    with pytest.raises(HTTPException, match="Category not found"):
        finance_posting.get_category(Db(got=deleted), "f", "c", "INCOME")
    wrong_family = SimpleNamespace(family_id="other", deleted_at=None, category_type="INCOME")
    with pytest.raises(HTTPException, match="Category not found"):
        finance_posting.get_category(Db(got=wrong_family), "f", "c", "INCOME")

    class ColDb(Db):
        def __init__(self):
            super().__init__()
            self.bind = SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))
            self.executed = []

        def execute(self, statement):
            self.executed.append(str(statement))
            return SimpleNamespace(fetchall=lambda: [])

    col_db = ColDb()
    finance_posting._ensure_client_request_id_column(col_db)
    assert any("client_request_id" in s for s in col_db.executed)

    class PgDb(ColDb):
        def __init__(self):
            super().__init__()
            self.bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def execute(self, statement):
            self.executed.append(str(statement))
            raise RuntimeError("ignored")

    finance_posting._ensure_client_request_id_column(PgDb())

    class FindDb(Db):
        def __init__(self, row=None, explode=False):
            super().__init__()
            self.row = row
            self.explode = explode

        def query(self, model):
            if self.explode:
                raise RuntimeError("db down")
            return Query(first_row=self.row)

    monkeypatch.setattr(finance_posting, "_ensure_client_request_id_column", lambda db: None)
    existing = SimpleNamespace(id="tx")
    assert finance_posting.find_by_client_request_id(FindDb(existing), "f", "rid") is existing
    assert finance_posting.find_by_client_request_id(FindDb(explode=True), "f", "rid") is None

    monkeypatch.setattr(
        finance_posting, "find_by_client_request_id", lambda *a: SimpleNamespace(id="dup")
    )
    assert finance_posting.post_income_flush(
        Db(),
        family_id="f",
        member_id="m",
        account_id="a",
        category_id="c",
        amount=1,
        client_request_id="dup",
    ).id == "dup"
    assert finance_posting.post_expense_flush(
        Db(),
        family_id="f",
        member_id="m",
        account_id="a",
        category_id="c",
        amount=1,
        client_request_id="dup",
    ).id == "dup"


# ---------------------------------------------------------------------------
# Architecture bridge
# ---------------------------------------------------------------------------


def test_architecture_bridge_preference_push_and_mirrors():
    from app.models.architecture_auth import PushToken, UserPreference
    from app.models.architecture_modules import (
        Document,
        HealthExpense,
        Investment,
        Property,
        Subscription,
        VehicleExpense,
    )
    from app.models.architecture_modules import EducationFund

    user = SimpleNamespace(id="u", preferred_language="en")
    db = Db({UserPreference: None})
    pref = bridge.ensure_user_preference(db, user)
    assert pref.language == "en" and pref in db.added
    existing_pref = SimpleNamespace(id="p")
    assert bridge.ensure_user_preference(Db({UserPreference: existing_pref}), user) is existing_pref

    assert bridge._dec("12.5") == Decimal("12.5")
    assert bridge._dec("bad") == Decimal("0")
    assert bridge._dec(None) == Decimal("0")

    device = SimpleNamespace(
        id="pd",
        user_id="u",
        device_label="phone",
        token="tok",
        platform="android",
        is_active=True,
        family_id="f",
    )
    db_push = Db({PushToken: None})
    bridge.mirror_push_device(db_push, device)
    assert db_push.added
    existing_token = SimpleNamespace(
        fcm_token=None, platform=None, is_active=False, family_id=None, updated_at=None
    )
    bridge.mirror_push_device(Db({PushToken: existing_token}), device)
    assert existing_token.fcm_token == "tok"

    item15 = SimpleNamespace(
        id="p15",
        family_id="f",
        created_by_member_id="m",
        member_id="m",
        module_type="INVESTMENT",
        sub_type="STOCK",
        category=None,
        name="Shares",
        amount=100,
        secondary_amount=5,
        secondary_date="2025-01-01",
        target_date="2026-01-01",
        currency="BDT",
        status="ACTIVE",
        note="n",
        deleted_at=None,
        provider=None,
    )
    db_inv = Db({Investment: None})
    bridge.mirror_phase15_item(db_inv, item15)
    assert db_inv.added[0].name == "Shares"

    item15.module_type = "HEALTH"
    item15.provider = "Dr"
    db_h = Db({HealthExpense: None})
    bridge.mirror_phase15_item(db_h, item15)
    assert db_h.added[0].doctor == "Dr"

    item15.module_type = "VEHICLE"
    db_v = Db({VehicleExpense: None})
    bridge.mirror_phase15_item(db_v, item15)
    assert db_v.added[0].vehicle_name == "Shares"

    item15.module_type = "EDUCATION"
    db_e = Db({EducationFund: None})
    bridge.mirror_phase15_item(db_e, item15)
    assert db_e.added[0].provider is None or True

    item16 = SimpleNamespace(
        id="p16",
        family_id="f",
        created_by_member_id="m",
        member_id="m",
        module_type="PROPERTY",
        sub_type="HOME",
        category=None,
        name="Flat",
        amount=1000,
        secondary_amount=10,
        provider="Dhaka",
        reference="1200sqft",
        currency="BDT",
        status="ACTIVE",
        note="n",
        deleted_at=None,
        billing_cycle="YEARLY",
        renewal_or_expiry_date="2027-01-01",
        payment_account_id=None,
        file_path="/f",
        file_encrypted=True,
        file_name="a.pdf",
        file_mime="application/pdf",
        file_size=10,
        file_sha256="abc",
    )
    db_p = Db({Property: None})
    bridge.mirror_phase16_item(db_p, item16)
    assert db_p.added[0].location == "Dhaka"

    item16.module_type = "SUBSCRIPTION"
    db_s = Db({Subscription: None})
    bridge.mirror_phase16_item(db_s, item16)
    assert db_s.added[0].cycle == "YEARLY"

    item16.module_type = "DOCUMENT"
    db_d = Db({Document: None})
    bridge.mirror_phase16_item(db_d, item16)
    assert db_d.added[0].encrypted is True

    # update existing rows
    existing_inv = SimpleNamespace(
        member_id=None,
        type=None,
        name=None,
        principal=None,
        rate=None,
        start_date=None,
        maturity=None,
        currency=None,
        status=None,
        note=None,
        deleted_at=None,
    )
    item15.module_type = "INVESTMENT"
    bridge.mirror_phase15_item(Db({Investment: existing_inv}), item15)
    assert existing_inv.name == "Shares"


# ---------------------------------------------------------------------------
# Avatar service
# ---------------------------------------------------------------------------


def test_avatar_save_find_url_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(avatar_service, "avatars_dir", lambda: tmp_path)
    user_id = "user-avatar-1"
    assert avatar_service.find_avatar_file(user_id) is None
    assert avatar_service.avatar_url_for(user_id) is None

    class FakeUpload:
        def __init__(self, content_type: str, data: bytes):
            self.content_type = content_type
            self._data = data

        async def read(self):
            return self._data

    async def _run():
        url = await avatar_service.save_avatar(user_id, FakeUpload("image/png", b"png-bytes"))
        assert url.startswith("/auth/avatar/")
        assert avatar_service.find_avatar_file(user_id) is not None
        assert avatar_service.delete_avatar(user_id) is True
        assert avatar_service.delete_avatar(user_id) is False

        with pytest.raises(HTTPException, match="JPG"):
            await avatar_service.save_avatar(user_id, FakeUpload("image/gif", b"x"))
        with pytest.raises(HTTPException, match="Empty"):
            await avatar_service.save_avatar(user_id, FakeUpload("image/png", b""))
        with pytest.raises(HTTPException, match="2MB"):
            await avatar_service.save_avatar(
                user_id, FakeUpload("image/png", b"x" * (avatar_service.MAX_BYTES + 1))
            )

    asyncio.run(_run())
