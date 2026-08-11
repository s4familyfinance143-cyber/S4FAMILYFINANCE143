"""zakat records table for fresh PostgreSQL cutover

Revision ID: 0010_zakat_records_table
Revises: 0009_phase16_document_vault_files
Create Date: 2026-07-27

Creates zakat_records when missing (was previously only via AUTO_CREATE_TABLES on sqlite).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "0010_zakat_records_table"
down_revision: Union[str, None] = "0009_phase16_document_vault_files"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table("zakat_records"):
        return
    op.create_table(
        "zakat_records",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("family_id", sa.String(), sa.ForeignKey("families.id"), nullable=False, index=True),
        sa.Column("created_by_member_id", sa.String(), sa.ForeignKey("family_members.id"), nullable=False, index=True),
        sa.Column("calculation_year", sa.String(length=20), nullable=False, index=True),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="BDT"),
        sa.Column("cash_amount", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("gold_value", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("silver_value", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("investment_value", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("business_assets", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("receivables", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("deductible_debts", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("nisab_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("zakatable_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("zakat_due", sa.Numeric(18, 4), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="CALCULATED", index=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table("zakat_records"):
        op.drop_table("zakat_records")
