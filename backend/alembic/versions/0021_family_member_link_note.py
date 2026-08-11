"""family_members linked_member_id + relationship_note

Revision ID: 0021_family_member_link_note
Revises: 0020_push_outbox_readiness
Create Date: 2026-08-11
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_family_member_link_note"
down_revision: Union[str, Sequence[str], None] = "0020_push_outbox_readiness"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_column("family_members", "linked_member_id"):
        op.add_column(
            "family_members",
            sa.Column("linked_member_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_family_members_linked_member_id",
            "family_members",
            "family_members",
            ["linked_member_id"],
            ["id"],
        )
    if not _has_column("family_members", "relationship_note"):
        op.add_column(
            "family_members",
            sa.Column("relationship_note", sa.String(length=500), nullable=True),
        )

    if not _has_column("join_requests", "requested_linked_member_id"):
        op.add_column(
            "join_requests",
            sa.Column("requested_linked_member_id", sa.String(length=36), nullable=True),
        )
    if not _has_column("join_requests", "requested_relationship_note"):
        op.add_column(
            "join_requests",
            sa.Column("requested_relationship_note", sa.String(length=500), nullable=True),
        )
    if not _has_column("join_requests", "requested_serial_label"):
        op.add_column(
            "join_requests",
            sa.Column("requested_serial_label", sa.String(length=40), nullable=True),
        )


def downgrade() -> None:
    # Keep additive columns on downgrade for safety in production.
    pass
