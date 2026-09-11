"""Add users.is_phone_verified for OTP mobile verification.

Revision ID: 0024_users_phone_verified
Revises: 0023_users_phone_encrypted_width
Create Date: 2026-09-11
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_users_phone_verified"
down_revision: Union[str, Sequence[str], None] = "0023_users_phone_encrypted_width"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if _has_column("users", "is_phone_verified"):
        return
    op.add_column(
        "users",
        sa.Column("is_phone_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Existing email-verified users treated as phone-verified for cutover continuity.
    op.execute(
        sa.text(
            "UPDATE users SET is_phone_verified = TRUE WHERE is_email_verified = TRUE"
        )
    )


def downgrade() -> None:
    if _has_column("users", "is_phone_verified"):
        op.drop_column("users", "is_phone_verified")
