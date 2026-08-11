"""grocery posted expense link

Revision ID: 0005_grocery_posted_expense
Revises: 0004_grocery_vendor_master
Create Date: 2026-07-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_grocery_posted_expense"
down_revision: Union[str, None] = "0004_grocery_vendor_master"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("grocery_items") as batch_op:
        batch_op.add_column(sa.Column("posted_transaction_id", sa.String(), nullable=True))
        batch_op.create_foreign_key("fk_grocery_items_posted_transaction_id", "transactions", ["posted_transaction_id"], ["id"])
        batch_op.create_index("ix_grocery_items_posted_transaction_id", ["posted_transaction_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("grocery_items") as batch_op:
        batch_op.drop_index("ix_grocery_items_posted_transaction_id")
        batch_op.drop_constraint("fk_grocery_items_posted_transaction_id", type_="foreignkey")
        batch_op.drop_column("posted_transaction_id")
