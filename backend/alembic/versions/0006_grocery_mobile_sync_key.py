"""grocery mobile sync key

Revision ID: 0006_grocery_mobile_sync_key
Revises: 0005_grocery_posted_expense
Create Date: 2026-07-23

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_grocery_mobile_sync_key"
down_revision: Union[str, None] = "0005_grocery_posted_expense"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("grocery_lists") as batch_op:
        batch_op.add_column(sa.Column("mobile_sync_key", sa.String(length=120), nullable=True))
        batch_op.create_index("ix_grocery_lists_mobile_sync_key", ["mobile_sync_key"], unique=False)
        batch_op.create_unique_constraint(
            "uq_grocery_lists_family_mobile_sync_key",
            ["family_id", "mobile_sync_key"],
        )

    with op.batch_alter_table("grocery_items") as batch_op:
        batch_op.add_column(sa.Column("mobile_sync_key", sa.String(length=120), nullable=True))
        batch_op.create_index("ix_grocery_items_mobile_sync_key", ["mobile_sync_key"], unique=False)
        batch_op.create_unique_constraint(
            "uq_grocery_items_family_mobile_sync_key",
            ["family_id", "mobile_sync_key"],
        )


def downgrade() -> None:
    with op.batch_alter_table("grocery_items") as batch_op:
        batch_op.drop_constraint("uq_grocery_items_family_mobile_sync_key", type_="unique")
        batch_op.drop_index("ix_grocery_items_mobile_sync_key")
        batch_op.drop_column("mobile_sync_key")

    with op.batch_alter_table("grocery_lists") as batch_op:
        batch_op.drop_constraint("uq_grocery_lists_family_mobile_sync_key", type_="unique")
        batch_op.drop_index("ix_grocery_lists_mobile_sync_key")
        batch_op.drop_column("mobile_sync_key")
