"""Unique idempotency key on sync_outbox(family_id, device_id, client_change_id).

offline_sync_hardened.phase10b_sync_push deduplicates a re-sent change by
looking up its client_change_id before inserting (check-then-insert). Two
identical pushes arriving together (retry after a dropped response while the
first is still running) could both miss the lookup and both insert, applying
the same change twice. This partial unique index makes the database the
guard; the push endpoint catches the IntegrityError and reuses the winner.

Existing duplicates are NOT deleted: every row past the first in a duplicate
group gets client_change_id = 'dup#<row id>' (row, payload and status are
kept, so nothing is lost and the history stays auditable). Empty-string keys
(stored by older code when the client sent none) become NULL.

Revision ID: 0026_sync_outbox_change_unique
Revises: 0025_transactions_client_request_id_unique
Create Date: 2026-10-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026_sync_outbox_change_unique"
down_revision: Union[str, Sequence[str], None] = "0025_transactions_client_request_id_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = "uq_sync_outbox_change"
WHERE = "client_change_id IS NOT NULL AND client_change_id <> ''"


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table: str, name: str) -> bool:
    return any(ix.get("name") == name for ix in sa.inspect(op.get_bind()).get_indexes(table))


def upgrade() -> None:
    if not _table_exists("sync_outbox") or _has_index("sync_outbox", INDEX_NAME):
        return
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE sync_outbox SET client_change_id = NULL WHERE client_change_id = ''"))
    bind.execute(
        sa.text(
            "UPDATE sync_outbox SET client_change_id = 'dup#' || id "
            "WHERE client_change_id IS NOT NULL AND id NOT IN ("
            "  SELECT MIN(id) FROM sync_outbox WHERE client_change_id IS NOT NULL "
            "  GROUP BY family_id, device_id, client_change_id"
            ")"
        )
    )
    op.create_index(
        INDEX_NAME,
        "sync_outbox",
        ["family_id", "device_id", "client_change_id"],
        unique=True,
        sqlite_where=sa.text(WHERE),
        postgresql_where=sa.text(WHERE),
    )


def downgrade() -> None:
    # Only the index is dropped; renamed duplicate keys stay renamed (harmless).
    if _table_exists("sync_outbox") and _has_index("sync_outbox", INDEX_NAME):
        op.drop_index(INDEX_NAME, table_name="sync_outbox")
