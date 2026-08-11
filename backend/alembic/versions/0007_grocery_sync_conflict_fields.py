"""grocery sync conflict fields

Revision ID: 0007_grocery_sync_conflict_fields
Revises: 0006_grocery_mobile_sync_key
Create Date: 2026-07-23

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_grocery_sync_conflict_fields"
down_revision: Union[str, None] = "0006_grocery_mobile_sync_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("grocery_lists") as batch_op:
        batch_op.add_column(sa.Column("sync_version", sa.Integer(), server_default="1", nullable=False))
        batch_op.add_column(sa.Column("last_client_updated_at", sa.String(length=40), nullable=True))

    with op.batch_alter_table("grocery_items") as batch_op:
        batch_op.add_column(sa.Column("sync_version", sa.Integer(), server_default="1", nullable=False))
        batch_op.add_column(sa.Column("last_client_updated_at", sa.String(length=40), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("grocery_items") as batch_op:
        batch_op.drop_column("last_client_updated_at")
        batch_op.drop_column("sync_version")

    with op.batch_alter_table("grocery_lists") as batch_op:
        batch_op.drop_column("last_client_updated_at")
        batch_op.drop_column("sync_version")
