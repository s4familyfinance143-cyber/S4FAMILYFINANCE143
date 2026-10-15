"""Migration 0026: duplicate outbox keys are renamed (never deleted), then the
partial unique index blocks a second insert of the same change."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIG = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0026_sync_outbox_change_unique.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("mig_0026", _MIG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(mod, engine, fn: str):
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(mod, fn)()


def test_0026_renames_duplicates_and_enforces_unique(tmp_path):
    engine = sa.create_engine(f"sqlite:///{(tmp_path / 'm.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, "
            "device_id TEXT NOT NULL, client_change_id TEXT, entity_type TEXT NOT NULL, "
            "entity_id TEXT, operation TEXT NOT NULL, payload TEXT, status TEXT NOT NULL)"
        ))
        rows = [("a1", "k1"), ("a2", "k1"), ("a3", ""), ("a4", ""), ("a5", None), ("a6", "k2")]
        for rid, key in rows:
            conn.execute(
                sa.text("INSERT INTO sync_outbox VALUES (:i, 'f', 'd', :k, 'budgets', NULL, 'CREATE', '{}', 'SYNCED')"),
                {"i": rid, "k": key},
            )

    mod = _load_migration()
    _run(mod, engine, "upgrade")

    with engine.begin() as conn:
        got = dict(conn.execute(sa.text("SELECT id, client_change_id FROM sync_outbox")).fetchall())
    assert len(got) == 6  # nothing deleted
    assert got["a1"] == "k1"
    assert got["a2"] == "dup#a2"
    assert got["a3"] is None and got["a4"] is None
    assert got["a6"] == "k2"

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as conn:
            conn.execute(sa.text(
                "INSERT INTO sync_outbox VALUES ('a7', 'f', 'd', 'k1', 'budgets', NULL, 'CREATE', '{}', 'PENDING')"
            ))
    # NULL keys stay unconstrained
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO sync_outbox VALUES ('a8', 'f', 'd', NULL, 'budgets', NULL, 'CREATE', '{}', 'FAILED')"
        ))

    _run(mod, engine, "downgrade")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO sync_outbox VALUES ('a9', 'f', 'd', 'k1', 'budgets', NULL, 'CREATE', '{}', 'PENDING')"
        ))
