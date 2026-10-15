"""Drop the push (Firebase Cloud Messaging) tables and column.

FCM / Firebase was removed from the product: notifications are in-app (live
over the VPS WebSocket) plus optional SMTP email. Nothing reads or writes
push_tokens, push_outbox, push_devices or device_sessions.fcm_token any more.

DESTRUCTIVE: the rows in these tables (old FCM device tokens and push
attempt logs) are deleted. Take a pg_dump before upgrading. downgrade()
recreates the tables and column empty; the old rows come back only from a
backup.

Revision ID: 0027_drop_push_firebase_tables
Revises: 0026_sync_outbox_change_unique
Create Date: 2026-10-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027_drop_push_firebase_tables"
down_revision: Union[str, Sequence[str], None] = "0026_sync_outbox_change_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _insp():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _insp().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return _has_table(table) and any(c["name"] == column for c in _insp().get_columns(table))


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    for table in ("push_outbox", "push_tokens", "push_devices"):
        if _has_table(table):
            op.drop_table(table)
    if _has_column("device_sessions", "fcm_token"):
        with op.batch_alter_table("device_sessions") as batch:
            batch.drop_column("fcm_token")


def downgrade() -> None:
    if _has_table("device_sessions") and not _has_column("device_sessions", "fcm_token"):
        with op.batch_alter_table("device_sessions") as batch:
            batch.add_column(sa.Column("fcm_token", sa.String(length=512), nullable=True))

    if not _has_table("push_tokens"):
        op.create_table(
            "push_tokens",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("device_id", sa.String(length=120), nullable=True),
            sa.Column("fcm_token", sa.String(length=512), nullable=False),
            sa.Column("platform", sa.String(length=40), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("family_id", sa.String(), sa.ForeignKey("families.id"), nullable=True),
            sa.Column("legacy_push_device_id", sa.String(), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("user_id", "fcm_token", name="uq_push_tokens_user_token"),
        )
        op.create_index("ix_push_tokens_active", "push_tokens", ["user_id", "is_active"])

    if not _has_table("push_outbox"):
        op.create_table(
            "push_outbox",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("family_id", sa.String(), sa.ForeignKey("families.id"), nullable=True),
            sa.Column("notification_id", sa.String(), sa.ForeignKey("notifications.id"), nullable=True),
            sa.Column("fcm_token_preview", sa.String(length=40), nullable=True),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("last_error", sa.String(length=500), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
        )
    # push_devices was already dropped by 0015 (deprecated alias); not recreated.
