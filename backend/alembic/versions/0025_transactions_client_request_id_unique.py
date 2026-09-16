"""Add unique constraint on transactions(family_id, client_request_id).

The idempotency-key dedup in finance_posting.find_by_client_request_id was
application-layer only (check-then-insert): two concurrent requests with the
same client_request_id (an offline-sync retry, or a double-tap submit before
the button disables) could both pass the "not found yet" check and both
insert, creating a duplicate money posting. This constraint makes the
database the real guard; accounting_service.create_transaction already
handles the resulting IntegrityError by returning the existing sibling row.

If any duplicate (family_id, client_request_id) pairs already exist on this
database from the pre-fix race, the constraint add is skipped rather than
failing the migration — those rows need manual reconciliation first.

Revision ID: 0025_transactions_client_request_id_unique
Revises: 0024_users_phone_verified
Create Date: 2026-09-16
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_transactions_client_request_id_unique"
down_revision: Union[str, Sequence[str], None] = "0024_users_phone_verified"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT_NAME = "uq_transactions_family_client_request_id"


def _has_constraint(table: str, name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    existing = {c.get("name") for c in insp.get_unique_constraints(table)}
    return name in existing


def upgrade() -> None:
    if _has_constraint("transactions", CONSTRAINT_NAME):
        return
    bind = op.get_bind()
    dupes = bind.execute(
        sa.text(
            "SELECT family_id, client_request_id, COUNT(*) c FROM transactions "
            "WHERE client_request_id IS NOT NULL "
            "GROUP BY family_id, client_request_id HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if dupes:
        # Pre-existing duplicates from the race this migration closes —
        # needs manual reconciliation before the constraint can be added.
        return
    op.create_unique_constraint(CONSTRAINT_NAME, "transactions", ["family_id", "client_request_id"])


def downgrade() -> None:
    if _has_constraint("transactions", CONSTRAINT_NAME):
        op.drop_constraint(CONSTRAINT_NAME, "transactions", type_="unique")
