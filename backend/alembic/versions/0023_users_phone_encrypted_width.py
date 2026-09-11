"""Widen users.phone for encrypted phone storage.

Revision ID: 0023_users_phone_encrypted_width
Revises: 0022_clear_invite_raw_code_hint
Create Date: 2026-09-11
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_users_phone_encrypted_width"
down_revision: Union[str, Sequence[str], None] = "0022_clear_invite_raw_code_hint"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "phone",
        existing_type=sa.String(length=40),
        type_=sa.String(length=255),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "phone",
        existing_type=sa.String(length=255),
        type_=sa.String(length=40),
        existing_nullable=True,
    )
