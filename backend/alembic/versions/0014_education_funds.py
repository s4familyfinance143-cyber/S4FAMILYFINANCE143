"""Add education_funds + migrate phase15 EDUCATION rows.

Revision ID: 0014_education_funds
Revises: 0013_architecture_42_harden
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0014_education_funds"
down_revision: Union[str, None] = "0013_architecture_42_harden"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    import app.models  # noqa: F401
    from app.models.base import Base

    if not insp.has_table("education_funds"):
        table = Base.metadata.tables.get("education_funds")
        if table is not None:
            table.create(bind=bind, checkfirst=True)

    insp = inspect(bind)
    if insp.has_table("phase15_items") and insp.has_table("education_funds"):
        bind.execute(
            text(
                """
                INSERT INTO education_funds (
                    id, family_id, created_by_member_id, member_id, name, type, provider, amount,
                    target_date, currency, status, notes, legacy_phase15_id, created_at, updated_at, deleted_at
                )
                SELECT p.id || '-ed', p.family_id, p.created_by_member_id, p.member_id, p.name,
                       COALESCE(p.sub_type, p.category, 'GENERAL'), p.provider, p.amount, p.target_date,
                       p.currency, p.status, p.note, p.id, p.created_at, p.updated_at, p.deleted_at
                FROM phase15_items p
                WHERE UPPER(p.module_type) = 'EDUCATION'
                  AND NOT EXISTS (SELECT 1 FROM education_funds e WHERE e.legacy_phase15_id = p.id)
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if inspect(bind).has_table("education_funds"):
        op.drop_table("education_funds")
