"""grocery bazaar module

Revision ID: 0003_grocery_bazaar
Revises: 0002_auth_hardening
Create Date: 2026-07-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_grocery_bazaar"
down_revision: Union[str, None] = "0002_auth_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "grocery_lists",
        sa.Column("family_id", sa.String(), nullable=False),
        sa.Column("created_by_member_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("budget_amount", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("vendor_name", sa.String(length=150), nullable=True),
        sa.Column("shopping_date", sa.String(length=30), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["family_members.id"]),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_grocery_lists_id", "grocery_lists", ["id"], unique=False)
    op.create_index("ix_grocery_lists_family_id", "grocery_lists", ["family_id"], unique=False)
    op.create_index("ix_grocery_lists_created_by_member_id", "grocery_lists", ["created_by_member_id"], unique=False)
    op.create_index("ix_grocery_lists_status", "grocery_lists", ["status"], unique=False)

    op.create_table(
        "grocery_items",
        sa.Column("family_id", sa.String(), nullable=False),
        sa.Column("grocery_list_id", sa.String(), nullable=False),
        sa.Column("created_by_member_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("unit", sa.String(length=30), nullable=False),
        sa.Column("estimated_price", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("actual_price", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("vendor_name", sa.String(length=150), nullable=True),
        sa.Column("barcode", sa.String(length=120), nullable=True),
        sa.Column("is_bought", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["family_members.id"]),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.ForeignKeyConstraint(["grocery_list_id"], ["grocery_lists.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_grocery_items_id", "grocery_items", ["id"], unique=False)
    op.create_index("ix_grocery_items_family_id", "grocery_items", ["family_id"], unique=False)
    op.create_index("ix_grocery_items_grocery_list_id", "grocery_items", ["grocery_list_id"], unique=False)
    op.create_index("ix_grocery_items_created_by_member_id", "grocery_items", ["created_by_member_id"], unique=False)
    op.create_index("ix_grocery_items_category", "grocery_items", ["category"], unique=False)
    op.create_index("ix_grocery_items_is_bought", "grocery_items", ["is_bought"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_grocery_items_is_bought", table_name="grocery_items")
    op.drop_index("ix_grocery_items_category", table_name="grocery_items")
    op.drop_index("ix_grocery_items_created_by_member_id", table_name="grocery_items")
    op.drop_index("ix_grocery_items_grocery_list_id", table_name="grocery_items")
    op.drop_index("ix_grocery_items_family_id", table_name="grocery_items")
    op.drop_index("ix_grocery_items_id", table_name="grocery_items")
    op.drop_table("grocery_items")

    op.drop_index("ix_grocery_lists_status", table_name="grocery_lists")
    op.drop_index("ix_grocery_lists_created_by_member_id", table_name="grocery_lists")
    op.drop_index("ix_grocery_lists_family_id", table_name="grocery_lists")
    op.drop_index("ix_grocery_lists_id", table_name="grocery_lists")
    op.drop_table("grocery_lists")
