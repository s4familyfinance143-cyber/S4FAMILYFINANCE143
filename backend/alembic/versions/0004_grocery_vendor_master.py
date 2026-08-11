"""grocery vendor master

Revision ID: 0004_grocery_vendor_master
Revises: 0003_grocery_bazaar
Create Date: 2026-07-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_grocery_vendor_master"
down_revision: Union[str, None] = "0003_grocery_bazaar"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "grocery_vendors",
        sa.Column("family_id", sa.String(), nullable=False),
        sa.Column("created_by_member_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("phone", sa.String(length=60), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_member_id"], ["family_members.id"]),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_grocery_vendors_id", "grocery_vendors", ["id"], unique=False)
    op.create_index("ix_grocery_vendors_family_id", "grocery_vendors", ["family_id"], unique=False)
    op.create_index("ix_grocery_vendors_created_by_member_id", "grocery_vendors", ["created_by_member_id"], unique=False)
    op.create_index("ix_grocery_vendors_name", "grocery_vendors", ["name"], unique=False)
    op.create_index("ix_grocery_vendors_category", "grocery_vendors", ["category"], unique=False)
    op.create_index("ix_grocery_vendors_is_active", "grocery_vendors", ["is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_grocery_vendors_is_active", table_name="grocery_vendors")
    op.drop_index("ix_grocery_vendors_category", table_name="grocery_vendors")
    op.drop_index("ix_grocery_vendors_name", table_name="grocery_vendors")
    op.drop_index("ix_grocery_vendors_created_by_member_id", table_name="grocery_vendors")
    op.drop_index("ix_grocery_vendors_family_id", table_name="grocery_vendors")
    op.drop_index("ix_grocery_vendors_id", table_name="grocery_vendors")
    op.drop_table("grocery_vendors")
