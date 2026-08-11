"""Add client_request_id for offline finance idempotency."""

from alembic import op
import sqlalchemy as sa


revision = "0012_tx_client_request_id"
down_revision = "0011_push_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("client_request_id", sa.String(length=120), nullable=True),
    )
    op.create_index(
        "ix_transactions_client_request_id",
        "transactions",
        ["client_request_id"],
        unique=False,
    )
    # Partial uniqueness is DB-specific; app enforces per-family lookup.


def downgrade() -> None:
    op.drop_index("ix_transactions_client_request_id", table_name="transactions")
    op.drop_column("transactions", "client_request_id")
