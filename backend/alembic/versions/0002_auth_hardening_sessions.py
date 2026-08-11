"""auth hardening sessions

Revision ID: 0002_auth_hardening
Revises: 0001_initial_schema
Create Date: 2026-07-03

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_auth_hardening"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=255), nullable=False),
        sa.Column("token_family", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="ACTIVE"),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_reason", sa.String(length=120), nullable=True),
        sa.Column("replaced_by_session_id", sa.String(), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("device_label", sa.String(length=120), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_refresh_token_hash", "auth_sessions", ["refresh_token_hash"], unique=True)
    op.create_index("ix_auth_sessions_token_family", "auth_sessions", ["token_family"])
    op.create_index("ix_auth_sessions_status", "auth_sessions", ["status"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_index("ix_auth_sessions_user_status", "auth_sessions", ["user_id", "status"])
    op.create_index("ix_auth_sessions_family", "auth_sessions", ["token_family"])
    op.create_index("ix_auth_sessions_expires", "auth_sessions", ["expires_at"])

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("email_verification_token_hash", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("email_verification_expires_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("email_verified_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("locked_until", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_login_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_login_ip", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("password_changed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("reset_password_token_hash", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("reset_password_used_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("reset_password_used_at")
        batch_op.drop_column("reset_password_token_hash")
        batch_op.drop_column("password_changed_at")
        batch_op.drop_column("last_login_ip")
        batch_op.drop_column("last_login_at")
        batch_op.drop_column("locked_until")
        batch_op.drop_column("failed_login_count")
        batch_op.drop_column("email_verified_at")
        batch_op.drop_column("email_verification_expires_at")
        batch_op.drop_column("email_verification_token_hash")

    op.drop_index("ix_auth_sessions_expires", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_family", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_status", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_status", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_token_family", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_refresh_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
