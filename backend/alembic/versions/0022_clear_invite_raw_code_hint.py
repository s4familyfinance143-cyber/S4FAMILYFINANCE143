"""Clear invite_codes.raw_code_hint leftovers (plaintext prefix must not persist).

Revision ID: 0022_clear_invite_raw_code_hint
Revises: 0021_family_member_link_note
Create Date: 2026-08-11
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_clear_invite_raw_code_hint"
down_revision: Union[str, Sequence[str], None] = "0021_family_member_link_note"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_column("invite_codes", "raw_code_hint"):
        return
    op.execute(sa.text("UPDATE invite_codes SET raw_code_hint = NULL WHERE raw_code_hint IS NOT NULL"))


def downgrade() -> None:
    # Irreversible data wipe — column remains; values stay NULL.
    pass
