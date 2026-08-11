"""Align grocery_lists/notifications/export_jobs column names to architecture checklist.

Revision ID: 0016_column_name_align
Revises: 0015_cutover_drop_deprecated

Changes:
- grocery_lists.title → name
- export_jobs.requested_by_user_id → user_id
- notifications: add user_id (+ backfill from family_members)
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0016_column_name_align"
down_revision: Union[str, None] = "0015_cutover_drop_deprecated"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table: str) -> set[str]:
    insp = inspect(bind)
    if not insp.has_table(table):
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()

    # grocery_lists.title → name
    cols = _cols(bind, "grocery_lists")
    if "title" in cols and "name" not in cols:
        bind.execute(text("ALTER TABLE grocery_lists RENAME COLUMN title TO name"))
    elif "title" in cols and "name" in cols:
        bind.execute(text("UPDATE grocery_lists SET name = COALESCE(name, title) WHERE name IS NULL OR name = ''"))
        # keep title for safety on sqlite if both exist; ignore drop if unsupported

    # export_jobs.requested_by_user_id → user_id
    cols = _cols(bind, "export_jobs")
    if "requested_by_user_id" in cols and "user_id" not in cols:
        bind.execute(text("ALTER TABLE export_jobs RENAME COLUMN requested_by_user_id TO user_id"))
    elif "requested_by_user_id" in cols and "user_id" in cols:
        bind.execute(
            text(
                "UPDATE export_jobs SET user_id = COALESCE(user_id, requested_by_user_id) "
                "WHERE user_id IS NULL"
            )
        )

    # notifications.user_id
    cols = _cols(bind, "notifications")
    if "user_id" not in cols:
        bind.execute(text("ALTER TABLE notifications ADD COLUMN user_id VARCHAR"))
        try:
            bind.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id)"))
        except Exception:
            pass
    # backfill from member → user
    cols = _cols(bind, "notifications")
    if "user_id" in cols and "member_id" in cols and inspect(bind).has_table("family_members"):
        bind.execute(
            text(
                """
                UPDATE notifications
                SET user_id = (
                    SELECT fm.user_id FROM family_members fm
                    WHERE fm.id = notifications.member_id
                )
                WHERE user_id IS NULL AND member_id IS NOT NULL
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    cols = _cols(bind, "grocery_lists")
    if "name" in cols and "title" not in cols:
        bind.execute(text("ALTER TABLE grocery_lists RENAME COLUMN name TO title"))

    cols = _cols(bind, "export_jobs")
    if "user_id" in cols and "requested_by_user_id" not in cols:
        bind.execute(text("ALTER TABLE export_jobs RENAME COLUMN user_id TO requested_by_user_id"))
