"""Push outbox for FCM delivery audit trail.

Revision ID: 0020_push_outbox_readiness
Revises: 0019_invite_email_link
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0020_push_outbox_readiness"
down_revision: Union[str, None] = "0019_invite_email_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("push_outbox"):
        return
    dialect = bind.dialect.name
    if dialect == "sqlite":
        bind.execute(
            text(
                """
                CREATE TABLE push_outbox (
                    id VARCHAR(36) NOT NULL PRIMARY KEY,
                    created_at DATETIME,
                    updated_at DATETIME,
                    family_id VARCHAR(36),
                    notification_id VARCHAR(36),
                    fcm_token_preview VARCHAR(40),
                    title VARCHAR(200) NOT NULL,
                    body TEXT,
                    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error VARCHAR(500),
                    sent_at DATETIME,
                    FOREIGN KEY(family_id) REFERENCES families(id),
                    FOREIGN KEY(notification_id) REFERENCES notifications(id)
                )
                """
            )
        )
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_push_outbox_family_id ON push_outbox (family_id)"))
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_push_outbox_notification_id ON push_outbox (notification_id)"))
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_push_outbox_status ON push_outbox (status)"))
    else:
        bind.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS push_outbox (
                    id VARCHAR(36) NOT NULL PRIMARY KEY,
                    created_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ,
                    family_id VARCHAR(36) REFERENCES families(id),
                    notification_id VARCHAR(36) REFERENCES notifications(id),
                    fcm_token_preview VARCHAR(40),
                    title VARCHAR(200) NOT NULL,
                    body TEXT,
                    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error VARCHAR(500),
                    sent_at TIMESTAMPTZ
                )
                """
            )
        )
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_push_outbox_family_id ON push_outbox (family_id)"))
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_push_outbox_notification_id ON push_outbox (notification_id)"))
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_push_outbox_status ON push_outbox (status)"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("push_outbox"):
        bind.execute(text("DROP TABLE push_outbox"))
