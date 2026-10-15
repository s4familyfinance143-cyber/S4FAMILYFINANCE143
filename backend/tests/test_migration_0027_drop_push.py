"""Migration 0027 drops the push (FCM) tables/column; downgrade recreates them empty."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIG = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0027_drop_push_firebase_tables.py"


def _load():
    spec = importlib.util.spec_from_file_location("mig_0027", _MIG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(mod, engine, fn):
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(mod, fn)()


def test_0027_drops_push_tables_and_column_then_restores(tmp_path):
    engine = sa.create_engine(f"sqlite:///{(tmp_path / 'p.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE users (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE families (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE notifications (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("CREATE TABLE device_sessions (id TEXT PRIMARY KEY, user_id TEXT, fcm_token TEXT, platform TEXT)"))
        conn.execute(sa.text("CREATE TABLE push_tokens (id TEXT PRIMARY KEY, fcm_token TEXT)"))
        conn.execute(sa.text("CREATE TABLE push_outbox (id TEXT PRIMARY KEY, title TEXT)"))
        conn.execute(sa.text("INSERT INTO device_sessions VALUES ('d1', 'u1', 'tok', 'android')"))

    mod = _load()
    _run(mod, engine, "upgrade")
    insp = sa.inspect(engine)
    assert "push_tokens" not in insp.get_table_names()
    assert "push_outbox" not in insp.get_table_names()
    cols = {c["name"] for c in insp.get_columns("device_sessions")}
    assert "fcm_token" not in cols and "platform" in cols
    with engine.begin() as conn:  # other device_sessions data kept
        assert conn.execute(sa.text("SELECT platform FROM device_sessions WHERE id='d1'")).scalar() == "android"

    _run(mod, engine, "upgrade")  # idempotent

    _run(mod, engine, "downgrade")
    insp = sa.inspect(engine)
    assert {"push_tokens", "push_outbox"} <= set(insp.get_table_names())
    assert "fcm_token" in {c["name"] for c in insp.get_columns("device_sessions")}
