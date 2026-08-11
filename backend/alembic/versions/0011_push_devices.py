"""push_devices table for FCM/Expo token registration

Revision ID: 0011_push_devices
Revises: 0010_zakat_records_table
Create Date: 2026-07-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "0011_push_devices"
down_revision: Union[str, None] = "0010_zakat_records_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table("push_devices"):
        return
    op.create_table(
        "push_devices",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("family_id", sa.String(), sa.ForeignKey("families.id"), nullable=False, index=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("member_id", sa.String(), sa.ForeignKey("family_members.id"), nullable=True, index=True),
        sa.Column("token", sa.String(length=512), nullable=False, index=True),
        sa.Column("platform", sa.String(length=40), nullable=False, server_default="UNKNOWN"),
        sa.Column("provider", sa.String(length=40), nullable=False, server_default="FCM"),
        sa.Column("device_label", sa.String(length=120), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("family_id", "token", name="uq_push_devices_family_token"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table("push_devices"):
        op.drop_table("push_devices")
