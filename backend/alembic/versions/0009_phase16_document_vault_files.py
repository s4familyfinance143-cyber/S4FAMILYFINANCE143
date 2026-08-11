"""phase16 document vault file fields

Revision ID: 0009_phase16_document_vault_files
Revises: 0008_phase15_phase16_module_fields
Create Date: 2026-07-27

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "0009_phase16_document_vault_files"
down_revision: Union[str, None] = "0008_phase15_phase16_module_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


COLUMNS = [
    ("file_name", sa.String(length=255), True),
    ("file_path", sa.String(length=500), True),
    ("file_mime", sa.String(length=120), True),
    ("file_size", sa.Integer(), True),
    ("file_sha256", sa.String(length=64), True),
    ("file_encrypted", sa.Boolean(), False),
]


def _existing_columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    existing = _existing_columns("phase16_items")
    missing = [(name, col_type, nullable) for name, col_type, nullable in COLUMNS if name not in existing]
    if not missing:
        return
    with op.batch_alter_table("phase16_items") as batch_op:
        for name, col_type, nullable in missing:
            if name == "file_encrypted":
                batch_op.add_column(sa.Column(name, col_type, server_default=sa.false(), nullable=False))
            else:
                batch_op.add_column(sa.Column(name, col_type, nullable=nullable))


def downgrade() -> None:
    existing = _existing_columns("phase16_items")
    drop_list = [name for name, _, _ in reversed(COLUMNS) if name in existing]
    if not drop_list:
        return
    with op.batch_alter_table("phase16_items") as batch_op:
        for name in drop_list:
            batch_op.drop_column(name)
