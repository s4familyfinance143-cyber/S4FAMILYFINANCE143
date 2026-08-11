"""phase15 phase16 module fields

Revision ID: 0008_phase15_phase16_module_fields
Revises: 0007_grocery_sync_conflict_fields
Create Date: 2026-07-27

Creates phase15/phase16 base tables when missing (fresh PostgreSQL cutover),
then ensures module expansion columns exist.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "0008_phase15_phase16_module_fields"
down_revision: Union[str, None] = "0007_grocery_sync_conflict_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PHASE15_COLUMNS = [
    ("member_id", sa.String(length=36), True),
    ("sub_type", sa.String(length=80), True),
    ("provider", sa.String(length=200), True),
    ("secondary_date", sa.String(length=30), True),
    ("secondary_amount", sa.Numeric(18, 4), True),
]

PHASE16_COLUMNS = [
    ("member_id", sa.String(length=36), True),
    ("sub_type", sa.String(length=80), True),
    ("provider", sa.String(length=200), True),
    ("secondary_date", sa.String(length=30), True),
    ("secondary_amount", sa.Numeric(18, 4), True),
    ("billing_cycle", sa.String(length=20), True),
    ("payment_account_id", sa.String(length=36), True),
]


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _existing_columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {col["name"] for col in inspect(bind).get_columns(table)}


def _ensure_phase15_table() -> None:
    if _table_exists("phase15_items"):
        return
    op.create_table(
        "phase15_items",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("family_id", sa.String(), sa.ForeignKey("families.id"), nullable=False, index=True),
        sa.Column("created_by_member_id", sa.String(), sa.ForeignKey("family_members.id"), nullable=False, index=True),
        sa.Column("member_id", sa.String(length=36), sa.ForeignKey("family_members.id"), nullable=True, index=True),
        sa.Column("module_type", sa.String(length=30), nullable=False, index=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="GENERAL", index=True),
        sa.Column("sub_type", sa.String(length=80), nullable=True),
        sa.Column("provider", sa.String(length=200), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("secondary_amount", sa.Numeric(18, 4), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="BDT"),
        sa.Column("target_date", sa.String(length=30), nullable=True),
        sa.Column("secondary_date", sa.String(length=30), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="ACTIVE", index=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def _ensure_phase16_table() -> None:
    if _table_exists("phase16_items"):
        return
    op.create_table(
        "phase16_items",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("family_id", sa.String(), sa.ForeignKey("families.id"), nullable=False, index=True),
        sa.Column("created_by_member_id", sa.String(), sa.ForeignKey("family_members.id"), nullable=False, index=True),
        sa.Column("member_id", sa.String(length=36), sa.ForeignKey("family_members.id"), nullable=True, index=True),
        sa.Column("module_type", sa.String(length=30), nullable=False, index=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="GENERAL", index=True),
        sa.Column("sub_type", sa.String(length=80), nullable=True),
        sa.Column("provider", sa.String(length=200), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("secondary_amount", sa.Numeric(18, 4), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="BDT"),
        sa.Column("renewal_or_expiry_date", sa.String(length=30), nullable=True),
        sa.Column("secondary_date", sa.String(length=30), nullable=True),
        sa.Column("billing_cycle", sa.String(length=20), nullable=True),
        sa.Column("payment_account_id", sa.String(length=36), nullable=True),
        sa.Column("reference", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="ACTIVE", index=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def _add_missing_columns(table: str, columns: list) -> None:
    existing = _existing_columns(table)
    missing = [(name, col_type, nullable) for name, col_type, nullable in columns if name not in existing]
    if not missing:
        return
    with op.batch_alter_table(table) as batch_op:
        for name, col_type, nullable in missing:
            batch_op.add_column(sa.Column(name, col_type, nullable=nullable))


def upgrade() -> None:
    _ensure_phase15_table()
    _ensure_phase16_table()
    _add_missing_columns("phase15_items", PHASE15_COLUMNS)
    _add_missing_columns("phase16_items", PHASE16_COLUMNS)


def downgrade() -> None:
    # Keep tables on downgrade for safety; only drop expansion columns if present.
    for table, columns in (("phase16_items", PHASE16_COLUMNS), ("phase15_items", PHASE15_COLUMNS)):
        if not _table_exists(table):
            continue
        existing = _existing_columns(table)
        drop_list = [name for name, _, _ in reversed(columns) if name in existing]
        if not drop_list:
            continue
        with op.batch_alter_table(table) as batch_op:
            for name in drop_list:
                batch_op.drop_column(name)
