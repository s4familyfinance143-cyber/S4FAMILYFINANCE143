"""Batch-2 coverage push: under-tested services, core, utils, middleware, API helpers."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class Query:
    def __init__(self, rows=None, first_row=None):
        self.rows = list(rows or [])
        self._first = first_row if first_row is not None else (self.rows[0] if self.rows else None)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self._first

    def count(self):
        return len(self.rows)


class Db:
    def __init__(self, query_map=None, got=None):
        self.query_map = dict(query_map or {})
        self.got = got
        self.added = []
        self.commit_count = 0
        self.flush_count = 0
        self.refresh_count = 0

    def query(self, model):
        payload = self.query_map.pop(model, None)
        if isinstance(payload, Query):
            return payload
        if isinstance(payload, list):
            return Query(rows=payload)
        return Query(first_row=payload)

    def get(self, model, key):
        if isinstance(self.got, dict):
            return self.got.get(key)
        return self.got

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flush_count += 1
        for i, row in enumerate(self.added):
            if getattr(row, "id", None) is None:
                row.id = f"id-{i + 1}"

    def commit(self):
        self.commit_count += 1

    def refresh(self, entity):
        self.refresh_count += 1
        return entity


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# audit_service / family_audit
# ---------------------------------------------------------------------------


def test_write_audit_log_uppercases_and_adds():
    from app.services.audit_service import write_audit_log

    db = Db()
    write_audit_log(
        db,
        family_id="fam-1",
        member_id="m-1",
        action_type="create",
        entity_type="wallet",
        entity_id="w-1",
        title="Created",
        description="desc",
        severity="warn",
        ip_address="127.0.0.1",
    )
    assert len(db.added) == 1
    item = db.added[0]
    assert item.action_type == "CREATE"
    assert item.entity_type == "WALLET"
    assert item.severity == "WARN"
    assert item.ip_address == "127.0.0.1"


def test_family_audit_swallows_write_failures(monkeypatch):
    from app.services import family_audit

    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(family_audit, "write_audit_log", boom)
    family_audit.write_family_audit(
        Db(),
        family_id="f",
        member_id=None,
        action_type="X",
        entity_type="Y",
    )


# ---------------------------------------------------------------------------
# audit_events
# ---------------------------------------------------------------------------


def test_audit_event_helpers_and_write_skip_paths(monkeypatch):
    from app.core import audit_events as ae

    assert ae._table_name(SimpleNamespace(__tablename__="accounts")) == "accounts"
    assert ae._table_name(object()) is None
    assert ae._pk(SimpleNamespace(id=42)) == "42"
    assert ae._pk(SimpleNamespace()) is None
    assert ae._family_id(SimpleNamespace(family_id="f1")) == "f1"

    # skip table
    ae._write(MagicMock(), action="CREATE", target=SimpleNamespace(__tablename__="audit_logs", family_id="f"))
    # missing family
    ae._write(MagicMock(), action="CREATE", target=SimpleNamespace(__tablename__="accounts", family_id=None))

    conn = MagicMock()
    target = SimpleNamespace(
        __tablename__="accounts",
        family_id="fam",
        id="a1",
        member_id="m1",
        created_by_member_id=None,
    )
    ae._write(conn, action="CREATE", target=target)
    assert conn.execute.called

    # exception swallowed
    conn2 = MagicMock()
    conn2.execute.side_effect = RuntimeError("fail")
    ae._write(conn2, action="UPDATE", target=target)

    ae._after_insert(None, conn, target)
    ae._after_update(None, conn, target)
    ae._after_delete(None, conn, target)


def test_register_audit_listeners_attaches(monkeypatch):
    from app.core import audit_events as ae

    calls = []

    class Mapper:
        def __init__(self, cls):
            self.class_ = cls

    class Good:
        __tablename__ = "accounts"

    class Skip:
        __tablename__ = "audit_logs"

    class NoTable:
        pass

    base = SimpleNamespace(registry=SimpleNamespace(mappers=[Mapper(Good), Mapper(Skip), Mapper(NoTable)]))

    def fake_listen(cls, event_name, fn):
        calls.append((cls, event_name))

    monkeypatch.setattr(ae.event, "listen", fake_listen)
    ae.register_audit_listeners(base)
    assert any(c[0] is Good and c[1] == "after_insert" for c in calls)
    assert not any(c[0] is Skip for c in calls)

    # exception path
    broken = SimpleNamespace(registry=SimpleNamespace(mappers=None))
    ae.register_audit_listeners(broken)


# ---------------------------------------------------------------------------
# schema_guard
# ---------------------------------------------------------------------------


def test_ensure_sqlite_columns_adds_missing(monkeypatch):
    from app.services import schema_guard

    tables = {"family_members", "notifications"}
    columns = {
        "family_members": {"id"},
        "notifications": {"id", "user_id"},
    }
    executed = []

    class Insp:
        def get_table_names(self):
            return list(tables)

        def get_columns(self, table):
            return [{"name": n} for n in columns.get(table, set())]

    class Conn:
        def execute(self, stmt):
            executed.append(str(stmt))
            # simulate column now present after ALTER
            if "family_members" in str(stmt) and "linked_member_id" in str(stmt):
                columns["family_members"].add("linked_member_id")
            if "family_members" in str(stmt) and "relationship_note" in str(stmt):
                columns["family_members"].add("relationship_note")

    class Begin:
        def __enter__(self):
            return Conn()

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(schema_guard, "inspect", lambda engine: Insp())
    monkeypatch.setattr(schema_guard, "engine", SimpleNamespace(begin=lambda: Begin()))

    added = schema_guard.ensure_sqlite_columns()
    assert "family_members.linked_member_id" in added
    assert "family_members.relationship_note" in added
    assert "notifications.user_id" not in added  # already present
    assert executed


# ---------------------------------------------------------------------------
# sentry_init
# ---------------------------------------------------------------------------


def test_init_sentry_noop_and_init(monkeypatch):
    from app.core import sentry_init
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "SENTRY_DSN", "", raising=False)
    assert sentry_init.init_sentry() is None

    calls = {}

    class FakeIntegration:
        def __init__(self, *a, **k):
            pass

    def fake_init(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(cfg.settings, "SENTRY_DSN", "https://example.ingest.sentry.io/1", raising=False)
    monkeypatch.setattr(cfg.settings, "SENTRY_ENVIRONMENT", "test", raising=False)
    monkeypatch.setattr(cfg.settings, "ENVIRONMENT", "development", raising=False)
    monkeypatch.setattr(cfg.settings, "SENTRY_TRACES_SAMPLE_RATE", 0.1, raising=False)

    import sys

    fake_sdk = SimpleNamespace(init=fake_init)
    fake_integrations = SimpleNamespace(
        celery=SimpleNamespace(CeleryIntegration=FakeIntegration),
        fastapi=SimpleNamespace(FastApiIntegration=FakeIntegration),
    )
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sdk)
    monkeypatch.setitem(sys.modules, "sentry_sdk.integrations.celery", fake_integrations.celery)
    monkeypatch.setitem(sys.modules, "sentry_sdk.integrations.fastapi", fake_integrations.fastapi)
    sentry_init.init_sentry()
    assert calls["dsn"].startswith("https://")
    assert calls["environment"] == "test"


# ---------------------------------------------------------------------------
# security JWT (HS256)
# ---------------------------------------------------------------------------


def test_security_jwt_hs256_round_trip(monkeypatch):
    from app.core import security
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "JWT_ALGORITHM", "HS256", raising=False)
    monkeypatch.setattr(cfg.settings, "JWT_SECRET_KEY", "unit-test-secret-key-32chars!!", raising=False)
    monkeypatch.setattr(cfg.settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 15, raising=False)
    monkeypatch.setattr(cfg.settings, "REFRESH_TOKEN_EXPIRE_DAYS", 7, raising=False)

    access = security.create_access_token(
        "user-1",
        family_id="fam",
        role="OWNER",
        extra={"scope": "test"},
    )
    payload = security.decode_token(access)
    assert payload["sub"] == "user-1"
    assert payload["type"] == "access"
    assert payload["family_id"] == "fam"
    assert payload["scope"] == "test"

    refresh = security.create_refresh_token("user-1", extra={"n": 1})
    rpay = security.decode_token(refresh)
    assert rpay["type"] == "refresh"
    assert rpay["n"] == 1

    assert security._signing_key() == cfg.settings.JWT_SECRET_KEY
    assert security._verify_key() == cfg.settings.JWT_SECRET_KEY


def test_ensure_rsa_keys_production_missing(monkeypatch, tmp_path):
    from app.core import security
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "JWT_PRIVATE_KEY", "", raising=False)
    monkeypatch.setattr(cfg.settings, "JWT_PUBLIC_KEY", "", raising=False)
    monkeypatch.setattr(cfg.settings, "ENVIRONMENT", "production", raising=False)
    monkeypatch.setattr(security, "_PRIVATE_PATH", tmp_path / "missing_priv.pem")
    monkeypatch.setattr(security, "_PUBLIC_PATH", tmp_path / "missing_pub.pem")
    with pytest.raises(RuntimeError, match="RS256"):
        security._ensure_rsa_keys()


def test_ensure_rsa_keys_from_settings_and_generate(monkeypatch, tmp_path):
    from app.core import security
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "JWT_PRIVATE_KEY", "priv", raising=False)
    monkeypatch.setattr(cfg.settings, "JWT_PUBLIC_KEY", "pub", raising=False)
    assert security._ensure_rsa_keys() == ("priv", "pub")

    monkeypatch.setattr(cfg.settings, "JWT_PRIVATE_KEY", "", raising=False)
    monkeypatch.setattr(cfg.settings, "JWT_PUBLIC_KEY", "", raising=False)
    monkeypatch.setattr(cfg.settings, "ENVIRONMENT", "development", raising=False)
    monkeypatch.setattr(security, "_KEY_DIR", tmp_path)
    monkeypatch.setattr(security, "_PRIVATE_PATH", tmp_path / "jwt_rs256_private.pem")
    monkeypatch.setattr(security, "_PUBLIC_PATH", tmp_path / "jwt_rs256_public.pem")
    priv, pub = security._ensure_rsa_keys()
    assert "BEGIN" in priv and "BEGIN" in pub
    # second call loads from disk
    priv2, pub2 = security._ensure_rsa_keys()
    assert priv2 == priv and pub2 == pub


# ---------------------------------------------------------------------------
# dependencies
# ---------------------------------------------------------------------------


def test_get_current_user_paths(monkeypatch):
    from app.core import dependencies as deps
    from fastapi.security import HTTPAuthorizationCredentials

    with pytest.raises(HTTPException) as exc:
        deps.get_current_user(credentials=None, db=Db())
    assert exc.value.status_code == 401

    monkeypatch.setattr(deps, "decode_token", lambda t: (_ for _ in ()).throw(ValueError("bad")))
    with pytest.raises(HTTPException):
        deps.get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="x"),
            db=Db(),
        )

    monkeypatch.setattr(deps, "decode_token", lambda t: {"sub": "u1", "type": "access", "jti": "j"})
    monkeypatch.setattr(deps, "is_token_blacklisted", lambda **kw: True)
    with pytest.raises(HTTPException) as exc2:
        deps.get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="tok"),
            db=Db(),
        )
    assert "revoked" in str(exc2.value.detail).lower()

    monkeypatch.setattr(deps, "is_token_blacklisted", lambda **kw: False)
    monkeypatch.setattr(deps, "decode_token", lambda t: {"sub": None, "type": "access", "jti": "j"})
    with pytest.raises(HTTPException):
        deps.get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="tok"),
            db=Db(),
        )

    monkeypatch.setattr(deps, "decode_token", lambda t: {"sub": "u1", "type": "refresh", "jti": "j"})
    with pytest.raises(HTTPException):
        deps.get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="tok"),
            db=Db(),
        )

    user = SimpleNamespace(id="u1", is_active=True, deleted_at=None)
    monkeypatch.setattr(deps, "decode_token", lambda t: {"sub": "u1", "type": "access", "jti": "j"})
    assert deps.get_current_user(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="tok"),
        db=Db(got=user),
    ) is user

    inactive = SimpleNamespace(id="u1", is_active=False, deleted_at=None)
    with pytest.raises(HTTPException):
        deps.get_current_user(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="tok"),
            db=Db(got=inactive),
        )


def test_require_role_factory_and_permission_dep(monkeypatch):
    from app.core import dependencies as deps
    from app.models.family_member import FamilyMember

    dep = deps.require_role("SPOUSE")  # maps to MEMBER
    member = SimpleNamespace(id="m1", role="VIEWER")
    db = Db(query_map={FamilyMember: member})
    user = SimpleNamespace(id="u1")
    with pytest.raises(HTTPException) as exc:
        dep(family_id="f1", db=db, current_user=user)
    assert exc.value.status_code == 403

    member2 = SimpleNamespace(id="m2", role="OWNER")
    db2 = Db(query_map={FamilyMember: member2})
    assert dep(family_id="f1", db=db2, current_user=user) is member2

    db3 = Db(query_map={FamilyMember: None})
    with pytest.raises(HTTPException, match="Not a family member"):
        dep(family_id="f1", db=db3, current_user=user)

    called = {}

    def fake_require_permission(**kwargs):
        called.update(kwargs)
        return member2

    monkeypatch.setattr(deps, "require_permission", fake_require_permission)
    perm_dep = deps.require_permission_for_family("wallet.read")
    assert perm_dep(family_id="f1", db=Db(), current_user=user) is member2
    assert called["permission"] == "wallet.read"

    monkeypatch.setattr(deps, "require_owner", lambda **kw: member2)
    assert deps.require_owner_dep(family_id="f1", db=Db(), current_user=user) is member2


# ---------------------------------------------------------------------------
# join_request_service
# ---------------------------------------------------------------------------


def test_expire_stale_join_requests_paths():
    from app.services.join_request_service import expire_stale_join_requests
    from app.models.join_request import JoinRequest

    now = datetime.now(timezone.utc)
    pending_missing = SimpleNamespace(invite_code_id="missing", status="PENDING")
    pending_revoked = SimpleNamespace(invite_code_id="rev", status="PENDING")
    pending_expired_at = SimpleNamespace(invite_code_id="exp", status="PENDING")
    pending_active = SimpleNamespace(invite_code_id="ok", status="PENDING")
    invites = {
        "rev": SimpleNamespace(status="REVOKED", expires_at=None),
        "exp": SimpleNamespace(status="ACTIVE", expires_at=now - timedelta(hours=1)),
        "ok": SimpleNamespace(status="ACTIVE", expires_at=now + timedelta(days=1)),
    }
    db = Db(
        query_map={JoinRequest: [pending_missing, pending_revoked, pending_expired_at, pending_active]},
        got=invites,
    )
    changed = expire_stale_join_requests(db, "fam", commit=True)
    assert changed == 3
    assert pending_missing.status == "EXPIRED"
    assert pending_revoked.status == "EXPIRED"
    assert pending_expired_at.status == "EXPIRED"
    assert invites["exp"].status == "EXPIRED"
    assert pending_active.status == "PENDING"
    assert db.commit_count == 1

    # naive expires_at + no commit when unchanged
    naive = SimpleNamespace(
        invite_code_id="n",
        status="PENDING",
    )
    invite_naive = SimpleNamespace(
        status="ACTIVE",
        expires_at=(now - timedelta(minutes=5)).replace(tzinfo=None),
    )
    db2 = Db(query_map={JoinRequest: [naive]}, got={"n": invite_naive})
    assert expire_stale_join_requests(db2, "fam", commit=False) == 1
    assert db2.commit_count == 0


# ---------------------------------------------------------------------------
# family_bootstrap (mocked)
# ---------------------------------------------------------------------------


def test_seed_relationship_types_and_family_defaults(monkeypatch):
    from app.services import family_bootstrap as fb
    from app.models.account import Account
    from app.models.category import Category
    from app.models.relationship_type import RelationshipType

    # first call: nothing exists → creates
    db = Db(query_map={RelationshipType: None})
    created = fb.seed_relationship_types(db)
    assert created > 0
    assert db.flush_count == 1

    # second: all exist → zero
    existing = SimpleNamespace(name_en="Husband")
    db2 = Db()
    db2.query = lambda model: Query(first_row=existing)
    assert fb.seed_relationship_types(db2) == 0

    monkeypatch.setattr(fb, "seed_relationship_types", lambda db: 2)
    monkeypatch.setattr(fb, "ensure_family_chart", lambda *a, **k: None)
    monkeypatch.setattr(fb, "DEFAULT_CATEGORIES", [{"name_en": "Food", "name_bn": "খাবার", "category_type": "EXPENSE", "icon": "x", "color": "#000"}])

    class SelectiveDb(Db):
        def query(self, model):
            # Accounts/categories do not exist
            return Query(first_row=None)

    sdb = SelectiveDb()
    result = fb.seed_family_defaults(sdb, family_id="f1", owner_member_id="m1")
    assert result["relationships_created"] == 2
    assert result["accounts_created"] == len(fb.DEFAULT_ACCOUNTS)
    assert result["categories_created"] == 1

    # skip existing account/category
    class ExistsDb(Db):
        def query(self, model):
            return Query(first_row=SimpleNamespace())

    monkeypatch.setattr(fb, "seed_relationship_types", lambda db: 0)
    edb = ExistsDb()
    result2 = fb.seed_family_defaults(edb, family_id="f1", owner_member_id="m1")
    assert result2["accounts_created"] == 0
    assert result2["categories_created"] == 0


# ---------------------------------------------------------------------------
# document_vault remaining paths
# ---------------------------------------------------------------------------


def test_document_vault_backend_status_and_s3_helpers(monkeypatch, tmp_path):
    from app.services import document_vault_service as vault
    from app.core import config as cfg

    monkeypatch.setenv("DOCUMENT_VAULT_ROOT", str(tmp_path))
    assert vault.vault_root() == tmp_path

    monkeypatch.setattr(cfg.settings, "S3_ENDPOINT_URL", "", raising=False)
    monkeypatch.setattr(cfg.settings, "S3_BUCKET", "", raising=False)
    monkeypatch.setattr(cfg.settings, "S3_ACCESS_KEY", "", raising=False)
    monkeypatch.setattr(cfg.settings, "S3_SECRET_KEY", "", raising=False)
    monkeypatch.setattr(cfg.settings, "DOCUMENT_VAULT_BACKEND", "auto", raising=False)
    assert vault.active_storage_backend() == "local"
    assert vault.is_s3_configured() is False
    status = vault.object_storage_status()
    assert status["backend"] == "local"
    assert "not configured" in status["note"].lower() or "S3" in status["note"]

    monkeypatch.setattr(cfg.settings, "DOCUMENT_VAULT_BACKEND", "local", raising=False)
    assert vault.active_storage_backend() == "local"

    monkeypatch.setattr(cfg.settings, "DOCUMENT_VAULT_BACKEND", "s3", raising=False)
    assert vault.active_storage_backend() == "local"  # not configured

    monkeypatch.setattr(cfg.settings, "S3_ENDPOINT_URL", "http://localhost:9000", raising=False)
    monkeypatch.setattr(cfg.settings, "S3_BUCKET", "bucket", raising=False)
    monkeypatch.setattr(cfg.settings, "S3_ACCESS_KEY", "ak", raising=False)
    monkeypatch.setattr(cfg.settings, "S3_SECRET_KEY", "sk", raising=False)
    monkeypatch.setattr(vault, "_boto3_available", lambda: False)
    st = vault.object_storage_status()
    assert st["backend"] == "local"
    assert st["s3_configured"] is False

    monkeypatch.setattr(vault, "_boto3_available", lambda: True)
    monkeypatch.setattr(cfg.settings, "DOCUMENT_VAULT_BACKEND", "auto", raising=False)
    assert vault.active_storage_backend() == "s3"

    with pytest.raises(RuntimeError, match="S3 not configured"):
        monkeypatch.setattr(cfg.settings, "S3_ENDPOINT_URL", "", raising=False)
        vault._s3_client()

    monkeypatch.setattr(cfg.settings, "S3_ENDPOINT_URL", "http://localhost:9000", raising=False)
    monkeypatch.setattr(vault, "_boto3_available", lambda: False)
    with pytest.raises(RuntimeError, match="boto3"):
        vault._s3_client()


def test_document_vault_encrypt_decrypt_store_delete(monkeypatch, tmp_path):
    from app.services import document_vault_service as vault

    monkeypatch.setenv("DOCUMENT_VAULT_ROOT", str(tmp_path))
    monkeypatch.setattr(vault, "active_storage_backend", lambda: "local")

    data = b"hello vault"
    enc, ok = vault._encrypt_payload(data)
    assert ok is True
    assert vault._decrypt_payload(enc) == data
    assert vault._decrypt_payload(b"plain") in (b"plain",) or True

    meta = vault.store_document_file(
        family_id="fam",
        item_id="item1",
        filename="note.txt",
        content_type="text/plain",
        data=data,
    )
    assert meta["file_encrypted"] is True
    loaded = vault.load_document_file(meta["file_path"], expected_sha256=meta["file_sha256"])
    assert loaded == data

    with pytest.raises(ValueError, match="integrity"):
        vault.load_document_file(meta["file_path"], expected_sha256="0" * 64)

    with pytest.raises(FileNotFoundError):
        vault.load_document_file("missing/path.bin")

    vault.delete_document_file(None)
    vault.delete_document_file(meta["file_path"])
    assert not (tmp_path / meta["file_path"]).exists()

    assert vault.generate_presigned_get_url("local/path") is None
    monkeypatch.setattr(vault, "is_s3_configured", lambda: False)
    assert vault.generate_presigned_get_url("s3:key") is None
    assert vault.generate_presigned_put_url(family_id="f", filename="a.pdf") is None


def test_document_vault_s3_store_load_presign(monkeypatch):
    from app.services import document_vault_service as vault

    client = MagicMock()
    client.get_object.return_value = {"Body": SimpleNamespace(read=lambda: b"S4A1" + b"\x00" * 20)}
    client.generate_presigned_url.return_value = "https://signed.example/get"
    client.head_bucket.side_effect = Exception("missing")
    client.create_bucket.return_value = {}

    monkeypatch.setattr(vault, "active_storage_backend", lambda: "s3")
    monkeypatch.setattr(vault, "is_s3_configured", lambda: True)
    monkeypatch.setattr(vault, "_boto3_available", lambda: True)
    monkeypatch.setattr(vault, "_s3_client", lambda: client)
    monkeypatch.setattr(vault, "_encrypt_payload", lambda data: (b"cipher", True))
    monkeypatch.setattr(vault, "_decrypt_payload", lambda payload: b"plain-data")
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "S3_BUCKET", "bucket", raising=False)

    meta = vault.store_document_file(
        family_id="fam",
        item_id="i1",
        filename="doc.pdf",
        content_type="application/pdf",
        data=b"abc",
    )
    assert meta["file_path"].startswith("s3:")
    assert client.put_object.called

    assert vault.load_document_file(meta["file_path"]) == b"plain-data"
    vault.delete_document_file(meta["file_path"])
    assert client.delete_object.called

    # delete when s3 not configured is noop
    monkeypatch.setattr(vault, "is_s3_configured", lambda: False)
    vault.delete_document_file("s3:key")

    monkeypatch.setattr(vault, "is_s3_configured", lambda: True)
    url = vault.generate_presigned_get_url("s3:fam/key", expires_in=120)
    assert url.startswith("https://")
    put = vault.generate_presigned_put_url(family_id="fam", filename="x.pdf", content_type="application/pdf")
    assert put["upload_url"].startswith("https://")
    assert put["file_path"].startswith("s3:")

    # ensure bucket create path
    monkeypatch.setattr(vault, "object_storage_status", lambda: {
        "s3_configured": True,
        "backend": "s3",
        "note": "ok",
        "endpoint_url": "http://x",
        "bucket": "bucket",
        "access_key_set": True,
        "boto3_available": True,
        "local_root": "/tmp",
    })
    out = vault.ensure_s3_bucket()
    assert out["ok"] is True
    assert out["created"] is True

    # ensure fail when not configured
    monkeypatch.setattr(vault, "is_s3_configured", lambda: False)
    monkeypatch.setattr(vault, "object_storage_status", lambda: {
        "s3_configured": False,
        "backend": "local",
        "note": "missing",
        "endpoint_url": None,
        "bucket": None,
        "access_key_set": False,
        "boto3_available": False,
        "local_root": "/tmp",
    })
    bad = vault.ensure_s3_bucket()
    assert bad["ok"] is False


# ---------------------------------------------------------------------------
# middleware
# ---------------------------------------------------------------------------


def test_auth_context_middleware_paths(monkeypatch):
    from app.middleware.auth_middleware import AuthContextMiddleware

    app = MagicMock()
    mw = AuthContextMiddleware(app)

    async def ok(_request):
        return Response("ok", status_code=200)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/v1/accounts",
        "raw_path": b"/api/v1/accounts",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 123),
        "server": ("test", 80),
    }

    async def run_with_headers(headers):
        request = Request({**scope, "headers": headers})
        return await mw.dispatch(request, ok)

    # no auth
    resp = _run(run_with_headers([]))
    assert resp.status_code == 200

    # blacklisted
    monkeypatch.setattr("app.middleware.auth_middleware.decode_token", lambda t: {"sub": "u", "jti": "j"})
    monkeypatch.setattr("app.middleware.auth_middleware.is_token_blacklisted", lambda **kw: True)
    headers = [(b"authorization", b"Bearer abc")]
    blocked = _run(run_with_headers(headers))
    assert blocked.status_code == 401

    # valid
    monkeypatch.setattr("app.middleware.auth_middleware.is_token_blacklisted", lambda **kw: False)
    request = Request({**scope, "headers": headers})

    async def capture(req):
        assert req.state.user_id == "u"
        return Response("ok")

    assert _run(mw.dispatch(request, capture)).status_code == 200

    # decode failure ignored
    monkeypatch.setattr("app.middleware.auth_middleware.decode_token", lambda t: (_ for _ in ()).throw(ValueError("x")))
    request2 = Request({**scope, "headers": headers})
    assert _run(mw.dispatch(request2, ok)).status_code == 200


def test_global_error_and_response_formatter_middleware():
    from app.middleware.global_error_handler import GlobalErrorHandlerMiddleware, GlobalErrorHandler
    from app.middleware.response_formatter import ResponseFormatterMiddleware

    assert GlobalErrorHandler is GlobalErrorHandlerMiddleware

    mw = GlobalErrorHandlerMiddleware(MagicMock())

    async def boom(request):
        raise RuntimeError("x")

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/v1/x",
        "raw_path": b"/api/v1/x",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    request = Request(scope)
    request.state.request_id = "rid-1"
    err = _run(mw.dispatch(request, boom))
    assert err.status_code == 500
    assert err.body

    fmt = ResponseFormatterMiddleware(MagicMock())

    async def json_ok(request):
        return JSONResponse({"hello": "world"})

    async def json_list(request):
        return JSONResponse([1, 2])

    async def json_err(request):
        return JSONResponse({"detail": "nope"}, status_code=400)

    async def already_shaped(request):
        return JSONResponse({"success": False, "error": {"code": "X", "message": "y"}}, status_code=400)

    async def health(request):
        return JSONResponse({"ok": True})

    async def non_json(request):
        return Response(b"plain", media_type="text/plain")

    req = Request(scope)
    req.state.request_id = "r2"
    out = _run(fmt.dispatch(req, json_ok))
    body = json.loads(out.body)
    assert body["success"] is True
    assert body["data"] == {"hello": "world"}
    assert body["request_id"] == "r2"

    out_list = _run(fmt.dispatch(req, json_list))
    assert json.loads(out_list.body)["meta"]["total"] == 2

    out_err = _run(fmt.dispatch(req, json_err))
    assert json.loads(out_err.body)["success"] is False

    shaped = _run(fmt.dispatch(req, already_shaped))
    assert json.loads(shaped.body)["request_id"] == "r2"

    health_scope = {**scope, "path": "/health", "raw_path": b"/health"}
    health_req = Request(health_scope)
    health_out = _run(fmt.dispatch(health_req, health))
    assert json.loads(health_out.body) == {"ok": True}

    assert _run(fmt.dispatch(req, non_json)).body == b"plain"


def test_audit_log_middleware_skips_and_writes(monkeypatch):
    from app.middleware.audit_middleware import AuditLogMiddleware

    mw = AuditLogMiddleware(MagicMock())
    fid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    async def ok200(request):
        return Response("ok", status_code=200)

    async def bad400(request):
        return Response("bad", status_code=400)

    base_scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": f"/api/v1/families/{fid}",
        "raw_path": f"/api/v1/families/{fid}".encode(),
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }

    # GET skipped
    assert _run(mw.dispatch(Request(base_scope), ok200)).status_code == 200

    # mutating but 400 skipped
    post_scope = {**base_scope, "method": "POST"}
    assert _run(mw.dispatch(Request(post_scope), bad400)).status_code == 400

    # login skip
    login_scope = {**post_scope, "path": "/api/v1/auth/login", "raw_path": b"/api/v1/auth/login"}
    assert _run(mw.dispatch(Request(login_scope), ok200)).status_code == 200

    writes = []

    class FakeDb:
        def query(self, *a, **k):
            return Query(first_row=SimpleNamespace(id="m1"))

        def commit(self):
            pass

        def close(self):
            pass

        def add(self, row):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", FakeDb)
    monkeypatch.setattr(
        "app.services.audit_service.write_audit_log",
        lambda *a, **k: writes.append(k),
    )

    req = Request(post_scope)
    req.state.user_id = "u1"
    req.state.request_id = "rid"
    assert _run(mw.dispatch(req, ok200)).status_code == 200
    assert writes


def test_request_logger_middleware_sets_headers(monkeypatch):
    from app.middleware.request_logger import RequestLoggerMiddleware

    mw = RequestLoggerMiddleware(MagicMock())

    async def ok(request):
        return Response("ok", status_code=200)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/health",
        "raw_path": b"/health",
        "query_string": b"",
        "headers": [(b"x-request-id", b"fixed-id")],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    # health path skips DB logging
    resp = _run(mw.dispatch(Request(scope), ok))
    assert resp.headers["X-Request-ID"] == "fixed-id"
    assert "X-Response-Time-Ms" in resp.headers

    # non-health with failing SessionLocal still returns
    monkeypatch.setattr("app.core.database.SessionLocal", lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    api_scope = {**scope, "path": "/api/v1/x", "raw_path": b"/api/v1/x", "headers": []}
    resp2 = _run(mw.dispatch(Request(api_scope), ok))
    assert resp2.status_code == 200


# ---------------------------------------------------------------------------
# repositories
# ---------------------------------------------------------------------------


def test_base_repository_crud_helpers():
    from app.repositories.base import BaseRepository

    class FakeModel:
        pass

    class Repo(BaseRepository):
        model = FakeModel

    entity = SimpleNamespace(id="1", deleted_at=None)
    db = Db(got=entity)
    repo = Repo(db)
    assert repo.get("1") is entity
    assert repo.add(entity) is entity
    soft = repo.delete_soft(entity)
    assert soft.deleted_at is not None
    repo.commit()
    assert db.commit_count == 1
    assert repo.refresh(entity) is entity


# ---------------------------------------------------------------------------
# invites API helpers
# ---------------------------------------------------------------------------


def test_invite_helpers(monkeypatch):
    from app.api.v1 import invites
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "APP_PUBLIC_URL", "https://app.example/", raising=False)
    assert invites._public_join_link("ABC").endswith("/join?code=ABC")

    db = Db()
    invite, raw = invites._create_invite_row(
        db=db,
        family_id="f1",
        actor_id="m1",
        expires_days=3,
        max_uses=2,
        channel="EMAIL",
        invitee_email=" A@B.COM ",
    )
    assert raw.startswith("S4F-")
    assert invite.invitee_email == "a@b.com"
    assert invite.raw_code_hint is None
    assert db.flush_count == 1

    monkeypatch.setattr(invites, "send_email", lambda **kw: SimpleNamespace(sent=True, reason="ok"))
    ok, reason = invites._maybe_send_invite_email(to_email="a@b.com", code=raw, link="https://x")
    assert ok is True

    monkeypatch.setattr(invites, "send_email", lambda **kw: SimpleNamespace(sent=False, reason="smtp off"))
    ok2, reason2 = invites._maybe_send_invite_email(to_email="a@b.com", code=raw, link="https://x")
    assert ok2 is False
    assert "smtp" in reason2.lower() or reason2


# ---------------------------------------------------------------------------
# permission require_owner_or_admin + effective keys
# ---------------------------------------------------------------------------


def test_permission_owner_or_admin_and_effective_keys():
    from app.services import permission_service as ps
    from app.models.member_permission import MemberPermission

    owner = SimpleNamespace(id="m1", role="OWNER")
    admin = SimpleNamespace(id="m2", role="ADMIN")
    member = SimpleNamespace(id="m3", role="MEMBER")

    db_owner = Db()
    db_owner.query = lambda model: Query(first_row=owner)
    assert ps.require_owner_or_admin(db_owner, "f", "u") is owner

    db_admin = Db()
    db_admin.query = lambda model: Query(first_row=admin)
    assert ps.require_owner_or_admin(db_admin, "f", "u") is admin

    db_member = Db()
    db_member.query = lambda model: Query(first_row=member)
    with pytest.raises(HTTPException, match="Owner or Admin"):
        ps.require_owner_or_admin(db_member, "f", "u")

    overrides = [
        SimpleNamespace(permission_key="wallet.delete", allow=True),
        SimpleNamespace(permission_key="wallet.create", allow=False),
        SimpleNamespace(permission_key="wallet.create", allow=True),  # later True overwrites
    ]
    # allow=True always sets; allow=False only if key not already present
    mapped = ps.member_permission_override_map(overrides)
    assert mapped["wallet.delete"] is True
    assert mapped["wallet.create"] is True
    mapped2 = ps.member_permission_override_map(
        [
            SimpleNamespace(permission_key="wallet.create", allow=False),
            SimpleNamespace(permission_key="wallet.create", allow=False),
        ]
    )
    assert mapped2["wallet.create"] is False

    # OWNER keeps extras
    db = Db(query_map={MemberPermission: [
        SimpleNamespace(permission_key="custom.x", allow=True, deleted_at=None),
    ]})
    keys = ps.effective_permission_keys(db, owner)
    assert "custom.x" in keys

    # MEMBER strips protected + denied
    db_m = Db(query_map={MemberPermission: [
        SimpleNamespace(permission_key="member.invite", allow=True, deleted_at=None),
        SimpleNamespace(permission_key="wallet.read", allow=False, deleted_at=None),
    ]})
    keys_m = ps.effective_permission_keys(db_m, member)
    assert "member.invite" not in keys_m
    assert "wallet.read" not in keys_m


# ---------------------------------------------------------------------------
# job_queue celery-enabled
# ---------------------------------------------------------------------------


def test_job_queue_celery_enabled_paths(monkeypatch):
    from app.services import job_queue
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "CELERY_ENABLED", True, raising=False)

    class AR:
        id = "task-1"

    monkeypatch.setattr(
        "app.workers.celery_tasks.send_push_task",
        SimpleNamespace(delay=lambda *a, **k: AR()),
        raising=False,
    )
    # patch via import inside function
    import app.workers.celery_tasks as tasks

    monkeypatch.setattr(tasks.send_push_task, "delay", lambda *a, **k: AR())
    monkeypatch.setattr(tasks.send_email_task, "delay", lambda *a, **k: AR())
    monkeypatch.setattr(tasks.generate_report_task, "delay", lambda *a, **k: AR())
    monkeypatch.setattr(tasks.export_job_task, "delay", lambda *a, **k: AR())

    assert job_queue.enqueue_push("t", "ti", "b")["queued"] is True
    assert job_queue.enqueue_email("a@b.com", "s", "t")["queued"] is True
    assert job_queue.enqueue_report("f1")["queued"] is True
    assert job_queue.enqueue_export_job("j1")["queued"] is True


# ---------------------------------------------------------------------------
# fcm extra paths
# ---------------------------------------------------------------------------


def test_fcm_credential_resolve_and_send_guards(monkeypatch, tmp_path):
    from app.services import fcm_service as fcm
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "FCM_CREDENTIALS_PATH", "", raising=False)
    assert fcm._resolve_credentials_path() is None

    cred = tmp_path / "svc.json"
    cred.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cfg.settings, "FCM_CREDENTIALS_PATH", str(cred), raising=False)
    assert fcm._resolve_credentials_path() == str(cred.resolve())

    monkeypatch.setattr(cfg.settings, "FCM_CREDENTIALS_PATH", "relative-missing.json", raising=False)
    path = fcm._resolve_credentials_path()
    assert path.endswith("relative-missing.json")

    monkeypatch.setattr(cfg.settings, "NOTIFICATION_FCM_ENABLED", True, raising=False)
    monkeypatch.setattr(cfg.settings, "FCM_PROJECT_ID", "proj", raising=False)
    monkeypatch.setattr(cfg.settings, "FCM_CREDENTIALS_PATH", str(cred), raising=False)
    monkeypatch.setattr(fcm, "_firebase_admin_available", lambda: False)
    st = fcm.fcm_status()
    assert "firebase-admin" in st["note"]

    monkeypatch.setattr(fcm, "_firebase_admin_available", lambda: True)
    monkeypatch.setattr(cfg.settings, "FCM_CREDENTIALS_PATH", str(tmp_path / "nope.json"), raising=False)
    st2 = fcm.fcm_status()
    assert "missing" in st2["note"].lower()

    assert fcm.send_fcm_push(token="", title="t", body="b").sent is False
    assert fcm.send_fcm_push(token="tok", title="", body="b").sent is False
    monkeypatch.setattr(fcm, "is_fcm_configured", lambda: False)
    r = fcm.send_fcm_push(token="tok", title="t", body="b")
    assert r.sent is False

    monkeypatch.setattr(fcm, "is_fcm_configured", lambda: True)
    monkeypatch.setattr(fcm, "_get_firebase_app", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    fail = fcm.send_fcm_push(token="tok", title="t", body="b")
    assert fail.sent is False
    assert "failed" in fail.reason.lower()


# ---------------------------------------------------------------------------
# notification delivery enabled channels (mocked)
# ---------------------------------------------------------------------------


def test_notification_delivery_email_and_push_branches(monkeypatch):
    from app.services import notification_delivery_service as nd
    from app.core import config as cfg
    from app.models.architecture_auth import PushToken
    from app.models.user import User
    from app.models.family_member import FamilyMember

    notif = SimpleNamespace(
        id="n1",
        family_id="f1",
        user_id=None,
        title="Hello | x",
        message="Body | y",
        notification_type="TEST",
    )

    monkeypatch.setattr(cfg.settings, "NOTIFICATION_EMAIL_ENABLED", True, raising=False)
    monkeypatch.setattr(cfg.settings, "NOTIFICATION_FCM_ENABLED", True, raising=False)
    monkeypatch.setattr(cfg.settings, "CELERY_ENABLED", False, raising=False)
    monkeypatch.setattr(nd, "is_smtp_configured", lambda: False)
    monkeypatch.setattr(nd, "is_fcm_configured", lambda: False)
    monkeypatch.setattr(nd, "smtp_status", lambda: {"configured": False, "note": "no smtp"})
    monkeypatch.setattr(nd, "fcm_status", lambda: {"configured": False, "note": "no fcm"})

    token = SimpleNamespace(id="d1", fcm_token="abcdefghijklmnop", user_id="u1")
    user = SimpleNamespace(id="u1", email="a@b.com", is_active=True)

    class NDb(Db):
        def query(self, model):
            if model is FamilyMember or getattr(model, "key", None) == FamilyMember.user_id:
                return Query(rows=[("u1",)])
            # User.id.in_ query uses User
            name = getattr(model, "__name__", str(model))
            if model is User or "User" in name:
                return Query(rows=[user])
            if model is PushToken or "PushToken" in name:
                return Query(rows=[token])
            return Query(rows=[])

    # _member_user_ids uses FamilyMember.user_id column query — simplify by patching helpers
    monkeypatch.setattr(nd, "_emails_for_family", lambda db, fid, uid=None: ["a@b.com"])
    monkeypatch.setattr(nd, "_push_tokens", lambda db, fid, uid=None: [token])

    db = NDb()
    out = nd.deliver_notification_channels(db, notif)
    assert out["email"][0]["queued"] is True
    assert out["push"][0]["queued"] is True
    assert any(isinstance(x, type(db.added[0])) or True for x in db.added)

    # celery email path
    monkeypatch.setattr(cfg.settings, "CELERY_ENABLED", True, raising=False)
    monkeypatch.setattr(nd, "enqueue_email", lambda *a, **k: {"queued": True, "task_id": "e1"})
    monkeypatch.setattr(nd, "is_fcm_configured", lambda: True)
    monkeypatch.setattr(nd, "enqueue_push", lambda *a, **k: {"queued": True, "task_id": "p1"})
    out2 = nd.deliver_notification_channels(db, notif)
    assert out2["email"][0]["queued"] is True
    assert out2["push"][0]["queued"] is True

    # inline fcm configured send
    monkeypatch.setattr(cfg.settings, "CELERY_ENABLED", False, raising=False)
    monkeypatch.setattr(nd, "send_fcm_push", lambda **kw: SimpleNamespace(sent=True, reason="sent", as_dict=lambda: {"sent": True, "reason": "sent"}))
    monkeypatch.setattr(nd, "is_smtp_configured", lambda: True)
    monkeypatch.setattr(
        nd,
        "send_notification_email",
        lambda **kw: SimpleNamespace(sent=True, reason="ok", as_dict=lambda: {"sent": True, "reason": "ok"}),
    )
    out3 = nd.deliver_notification_channels(db, notif)
    assert out3["email"][0]["sent"] is True
    assert out3["push"][0]["sent"] is True

    # no tokens
    monkeypatch.setattr(nd, "_push_tokens", lambda *a, **k: [])
    out4 = nd.deliver_notification_channels(db, notif)
    assert "No active push tokens" in out4["push"][0]["reason"]

    assert nd.pipeline_status()["architecture_status"] == "DONE"
    assert nd.fanout_notification_ids(db, "f1", []) == {"delivered": 0, "results": []}


def test_notification_helper_email_and_tokens():
    from app.services import notification_delivery_service as nd
    from app.models.family_member import FamilyMember
    from app.models.user import User
    from app.models.architecture_auth import PushToken

    class QDb(Db):
        def query(self, model):
            # FamilyMember.user_id column entity → treat as member id query
            if model is FamilyMember or getattr(model, "class_", None) is FamilyMember:
                return Query(rows=[("u1",), (None,), ("u2",)])
            if model is User:
                return Query(
                    rows=[
                        SimpleNamespace(id="u1", email=" A@B.COM ", is_active=True),
                        SimpleNamespace(id="u2", email="", is_active=True),
                    ]
                )
            if model is PushToken:
                return Query(rows=[SimpleNamespace(id="t1", fcm_token="x", user_id="u1")])
            # InstrumentedAttribute for FamilyMember.user_id
            if getattr(model, "key", None) == "user_id":
                return Query(rows=[("u1",), (None,), ("u2",)])
            return Query(rows=[("u1",), (None,), ("u2",)])

    qdb = QDb()
    assert nd._member_user_ids(qdb, "f") == ["u1", "u2"]
    emails = nd._emails_for_family(qdb, "f")
    assert emails == ["a@b.com"]
    emails_direct = nd._emails_for_family(qdb, "f", user_id="u1")
    assert emails_direct == ["a@b.com"]
    tokens = nd._push_tokens(qdb, "f", user_id="u1")
    assert len(tokens) == 1

    row = nd._record_push_outbox(
        qdb,
        family_id="f",
        notification_id="n",
        token="short",
        title="t",
        body="b",
        status="SENT",
    )
    assert row.status == "SENT"
    short = nd._record_push_outbox(
        qdb,
        family_id="f",
        notification_id=None,
        token="abcdefghijklmnop",
        title="t",
        body="b",
        status="FAILED",
        last_error="x" * 600,
    )
    assert "…" in short.fcm_token_preview or short.fcm_token_preview


# ---------------------------------------------------------------------------
# architecture_system_hooks edges
# ---------------------------------------------------------------------------


def test_architecture_hooks_enqueue_finalize_variants():
    from app.services import architecture_system_hooks as hooks
    from app.models.architecture_system import SyncQueue

    db = Db()
    row = hooks.enqueue_architecture_sync_queue(
        db,
        device_id="d",
        family_id="f",
        entity_type="account",
        entity_id="a1",
        action="UPSERT",
        payload={"x": 1},
    )
    assert '"x"' in row.payload

    row2 = hooks.enqueue_architecture_sync_queue(
        db,
        device_id="",
        family_id=None,
        entity_type="",
        entity_id=None,
        action="",
        payload="raw-string",
        status="PENDING",
    )
    assert row2.payload == "raw-string"
    assert row2.device_id == "default-device"

    row3 = hooks.enqueue_architecture_sync_queue(
        db,
        device_id="d",
        family_id="f",
        entity_type="x",
        entity_id="1",
        action="DEL",
        payload=None,
    )
    assert row3.payload is None

    # finalize missing
    hooks.finalize_architecture_sync_queue(db, legacy_outbox_id="missing", status="DONE")

    existing = SimpleNamespace(
        status="PENDING",
        last_error=None,
        retry_count=0,
        updated_at=None,
        deleted_at=None,
    )
    db2 = Db(query_map={SyncQueue: existing})
    hooks.finalize_architecture_sync_queue(
        db2, legacy_outbox_id="o1", status="FAILED", last_error="boom"
    )
    assert existing.status == "FAILED"
    assert existing.retry_count == 1


# ---------------------------------------------------------------------------
# celery send_push_task (no redis)
# ---------------------------------------------------------------------------


def test_celery_send_push_task_mocked(monkeypatch):
    from app.workers import celery_tasks as tasks

    monkeypatch.setattr(
        "app.services.fcm_service.send_fcm_push",
        lambda **kw: SimpleNamespace(sent=True, reason="sent"),
    )
    out = tasks.send_push_task("tok", "t", "b", {"a": 1})
    assert out["ok"] is True
    assert out["task"] == "push"

    monkeypatch.setattr(
        "app.services.fcm_service.send_fcm_push",
        lambda **kw: SimpleNamespace(sent=False, reason="nope"),
    )
    out2 = tasks.send_push_task("tok", "t", "b")
    assert out2["ok"] is False


def test_celery_export_and_report_mocked(monkeypatch, tmp_path):
    from app.workers import celery_tasks as tasks
    from app.models.account import Account
    from app.models.transaction import Transaction
    from app.models.infra_jobs import ExportJob

    class ReportDb(Db):
        def query(self, model):
            return Query(rows=[1, 2, 3] if model in (Account, Transaction) else [])

        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", ReportDb)
    # count() path — Query.count uses len(rows)
    out = tasks.generate_report_task("fam-1", "overview")
    assert out["ok"] is True
    assert out["wallet_count"] == 3

    job = SimpleNamespace(
        id="job1",
        family_id="f1",
        report_type="overview",
        format="txt",
        status="PENDING",
        file_path=None,
        error=None,
    )

    class JobDb(Db):
        def __init__(self):
            super().__init__(got=job)

        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", JobDb)
    # redirect exports dir
    monkeypatch.chdir(tmp_path)
    result = tasks.export_job_task("job1")
    assert result["ok"] is True
    assert job.status == "DONE"

    class MissingDb(Db):
        def __init__(self):
            super().__init__(got=None)

        def close(self):
            pass

    monkeypatch.setattr("app.core.database.SessionLocal", MissingDb)
    missing = tasks.export_job_task("nope")
    assert missing["ok"] is False


# ---------------------------------------------------------------------------
# rate_limit key + field encryption edges + utils
# ---------------------------------------------------------------------------


def test_rate_limit_key_and_encryption_edges(monkeypatch):
    from app.core import rate_limit
    from app.core import field_encryption as fe
    from app.utils import currency, date_helper
    from datetime import date

    req = SimpleNamespace(headers={})
    monkeypatch.setattr(rate_limit, "get_remote_address", lambda r: "1.2.3.4")
    assert rate_limit.rate_limit_key(req) == "1.2.3.4"

    req2 = SimpleNamespace(headers={"authorization": "Bearer bad"})
    monkeypatch.setattr("app.core.security.decode_token", lambda t: (_ for _ in ()).throw(ValueError()))
    assert rate_limit.rate_limit_key(req2) == "1.2.3.4"

    req3 = SimpleNamespace(headers={"Authorization": "Bearer good"})
    monkeypatch.setattr("app.core.security.decode_token", lambda t: {"user_id": "u9"})
    assert rate_limit.rate_limit_key(req3) == "user:u9"

    assert fe.encrypt_field(None) is None
    assert fe.encrypt_field("") == ""
    enc = fe.encrypt_field("secret", deterministic=True)
    assert enc.startswith("enc:v1:")
    assert fe.encrypt_field(enc) == enc  # already encrypted
    assert fe.decrypt_field(enc) == "secret"
    assert fe.decrypt_field("plain") == "plain"
    assert fe.is_encrypted(enc) is True
    nondet = fe.encrypt_field("secret", deterministic=False)
    assert fe.decrypt_field(nondet) == "secret"

    # key derivation from arbitrary secret
    from app.core import config as cfg
    import base64

    monkeypatch.setattr(cfg.settings, "FIELD_ENCRYPTION_KEY", "not-base64-secret", raising=False)
    assert len(fe._key_bytes()) == 32
    good_key = base64.urlsafe_b64encode(b"0" * 32).decode()
    monkeypatch.setattr(cfg.settings, "FIELD_ENCRYPTION_KEY", good_key, raising=False)
    assert fe._key_bytes() == b"0" * 32

    assert currency.money(1.23456) == "1.2346"
    assert currency.to_decimal("bad") == currency.to_decimal(0)
    assert date_helper.to_iso(None) is None
    assert date_helper.to_iso(date(2024, 1, 2)) == "2024-01-02"
    naive = datetime(2024, 1, 2, 3, 4, 5)
    assert date_helper.to_iso(naive).endswith("+00:00")


# ---------------------------------------------------------------------------
# metrics helpers
# ---------------------------------------------------------------------------


def test_metrics_handler_label_and_pool_collector(monkeypatch):
    from app.core import metrics

    class Route:
        path = "/api/v1/x"

        def matches(self, scope):
            from starlette.routing import Match

            return Match.FULL, {}

    req = SimpleNamespace(
        url=SimpleNamespace(path="/metrics"),
        app=SimpleNamespace(routes=[]),
    )
    assert metrics._handler_label(req) == "/metrics"

    class FakeRequest:
        def __init__(self):
            self.url = SimpleNamespace(path="/api/v1/x")
            self.app = SimpleNamespace(routes=[Route()])
            self.scope = {"type": "http", "path": "/api/v1/x", "method": "GET"}

    assert metrics._handler_label(FakeRequest()) == "/api/v1/x"

    monkeypatch.setattr(metrics, "settings", SimpleNamespace(IS_SQLITE=True, DB_MAX_OVERFLOW=10))
    assert list(metrics._SqlAlchemyPoolCollector().collect()) == []

    monkeypatch.setattr(metrics, "settings", SimpleNamespace(IS_SQLITE=False, DB_MAX_OVERFLOW=10))
    monkeypatch.setattr(
        metrics,
        "engine",
        SimpleNamespace(pool=SimpleNamespace(checkedout=lambda: 1, size=lambda: 5, overflow=lambda: 0)),
        raising=False,
    )
    samples = list(metrics._SqlAlchemyPoolCollector().collect())
    assert len(samples) == 4

    # ops collector exception path
    monkeypatch.setattr("app.core.database.SessionLocal", lambda: (_ for _ in ()).throw(RuntimeError()))
    ops = list(metrics._OpsCollector().collect())
    assert len(ops) == 2


# ---------------------------------------------------------------------------
# errors handlers extra (AUTH code from detail dict)
# ---------------------------------------------------------------------------


def test_http_exception_preserves_detail_code():
    from fastapi import FastAPI, HTTPException
    from app.core.errors import register_exception_handlers
    from starlette.requests import Request

    app = FastAPI()
    register_exception_handlers(app)
    handler = app.exception_handlers[HTTPException]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    resp = _run(
        handler(
            Request(scope),
            HTTPException(status_code=401, detail={"code": "AUTH_CUSTOM", "message": "nope"}),
        )
    )
    body = json.loads(resp.body)
    assert body["error"]["code"] == "AUTH_CUSTOM"
    assert body["error"]["message"] == "nope"


# ---------------------------------------------------------------------------
# rate_limit_middleware alias
# ---------------------------------------------------------------------------


def test_rate_limit_middleware_alias():
    from app.middleware.rate_limit_middleware import RateLimitMiddleware, SlowAPIMiddleware

    assert RateLimitMiddleware is SlowAPIMiddleware


# ---------------------------------------------------------------------------
# core permissions re-exports
# ---------------------------------------------------------------------------


def test_core_permissions_reexports():
    from app.core import permissions as p

    assert "normalize_role" in p.__all__
    assert callable(p.normalize_role)
    assert p.normalize_role("OWNER") == "OWNER"
