"""Invite email/link fields cutover.

Revision ID: 0019_invite_email_link
Revises: 0018_missing_modules_cutover
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0019_invite_email_link"
down_revision: Union[str, None] = "0018_missing_modules_cutover"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table: str) -> set[str]:
    insp = inspect(bind)
    if not insp.has_table(table):
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _add_col(bind, table: str, ddl: str) -> None:
    cols = _cols(bind, table)
    name = ddl.split()[0]
    if name in cols:
        return
    dialect = bind.dialect.name
    if dialect == "sqlite":
        bind.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    else:
        bind.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {ddl}"))


def upgrade() -> None:
    bind = op.get_bind()
    if "invite_codes" in inspect(bind).get_table_names():
        _add_col(bind, "invite_codes", "invitee_email VARCHAR(255)")
        _add_col(bind, "invite_codes", "invite_link_token VARCHAR(120)")
        _add_col(bind, "invite_codes", "invite_channel VARCHAR(40) DEFAULT 'CODE'")
        _add_col(bind, "invite_codes", "raw_code_hint VARCHAR(80)")


def downgrade() -> None:
    pass
