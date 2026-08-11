"""Double-Entry CoA cutover: is_system + remap legacy account types.

Revision ID: 0017_double_entry_coa_exact
Revises: 0016_column_name_align
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0017_double_entry_coa_exact"
down_revision: Union[str, None] = "0016_column_name_align"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table: str) -> set[str]:
    insp = inspect(bind)
    if not insp.has_table(table):
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _cols(bind, "accounts")
    if "is_system" not in cols:
        dialect = bind.dialect.name
        if dialect == "sqlite":
            bind.execute(text("ALTER TABLE accounts ADD COLUMN is_system BOOLEAN DEFAULT FALSE"))
        else:
            bind.execute(
                text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE")
            )

    # Remap legacy CoA types → exact architecture classes
    remaps = [
        ("LOAN_PAYABLE", "LIABILITY"),
        ("LOAN_RECEIVABLE", "ASSET"),
        ("SAVINGS_POOL", "ASSET"),
        ("GOAL_POOL", "ASSET"),
    ]
    for old, new in remaps:
        bind.execute(
            text("UPDATE accounts SET account_type = :new WHERE account_type = :old"),
            {"old": old, "new": new},
        )

    # Mark known system account names
    system_names = (
        "Opening Equity",
        "Salary Income",
        "Other Income",
        "Grocery Expense",
        "General Expense",
        "Loan Payable",
        "Loan Receivable",
        "Savings Pool",
        "Goal Pool",
    )
    for name in system_names:
        bind.execute(
            text("UPDATE accounts SET is_system = TRUE WHERE name = :name"),
            {"name": name},
        )


def downgrade() -> None:
    # Keep is_system column; reverse type remap is lossy for ASSET collisions
    pass
