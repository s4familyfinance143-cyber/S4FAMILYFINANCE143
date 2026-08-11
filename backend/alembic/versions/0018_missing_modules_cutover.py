"""Architecture missing-feature cutover tables & columns.

Revision ID: 0018_missing_modules_cutover
Revises: 0017_double_entry_coa_exact
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0018_missing_modules_cutover"
down_revision: Union[str, None] = "0017_double_entry_coa_exact"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table: str) -> set[str]:
    insp = inspect(bind)
    if not insp.has_table(table):
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def _add_col(bind, table: str, ddl: str) -> None:
    cols = _cols(bind, table)
    name = ddl.split()[0]
    if name in cols:
        return
    dialect = bind.dialect.name
    if dialect == "sqlite":
        bind.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    else:
        bind.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {ddl}"))


def upgrade() -> None:
    bind = op.get_bind()

    # --- loans: interest + schedule fields ---
    if _has_table(bind, "loans"):
        _add_col(bind, "loans", "interest_rate NUMERIC(10, 4) DEFAULT 0")
        _add_col(bind, "loans", "interest_type VARCHAR(20) DEFAULT 'NONE'")
        _add_col(bind, "loans", "installment_count INTEGER")
        _add_col(bind, "loans", "installment_amount NUMERIC(18, 4)")
        _add_col(bind, "loans", "start_date VARCHAR(30)")
        _add_col(bind, "loans", "next_due_date VARCHAR(30)")
        _add_col(bind, "loans", "end_date VARCHAR(30)")

    # --- transactions: attachment ---
    if _has_table(bind, "transactions"):
        _add_col(bind, "transactions", "attachment_url VARCHAR(500)")
        _add_col(bind, "transactions", "attachment_name VARCHAR(255)")
        _add_col(bind, "transactions", "attachment_mime VARCHAR(120)")
        _add_col(bind, "transactions", "is_split BOOLEAN DEFAULT FALSE")

    # --- health annual budget ---
    if _has_table(bind, "health_expenses"):
        _add_col(bind, "health_expenses", "year VARCHAR(10)")

    # --- vehicle master link ---
    if _has_table(bind, "vehicle_expenses"):
        _add_col(bind, "vehicle_expenses", "vehicle_id VARCHAR(36)")

    # --- property repair ---
    if _has_table(bind, "properties"):
        _add_col(bind, "properties", "repair_cost NUMERIC(18, 4) DEFAULT 0")

    # --- education annual/monthly targets ---
    if _has_table(bind, "education_funds"):
        _add_col(bind, "education_funds", "monthly_target NUMERIC(18, 4)")
        _add_col(bind, "education_funds", "annual_target NUMERIC(18, 4)")
        _add_col(bind, "education_funds", "year VARCHAR(10)")

    dialect = bind.dialect.name

    def create(sql_pg: str, sql_sqlite: str) -> None:
        bind.execute(text(sql_sqlite if dialect == "sqlite" else sql_pg))

    if not _has_table(bind, "expense_splits"):
        create(
            """
            CREATE TABLE IF NOT EXISTS expense_splits (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                transaction_id VARCHAR(36) NOT NULL,
                member_id VARCHAR(36) NOT NULL,
                share_amount NUMERIC(18, 4) NOT NULL,
                share_percent NUMERIC(10, 4),
                is_paid BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE,
                deleted_at TIMESTAMP WITH TIME ZONE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS expense_splits (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                transaction_id VARCHAR(36) NOT NULL,
                member_id VARCHAR(36) NOT NULL,
                share_amount NUMERIC(18, 4) NOT NULL,
                share_percent NUMERIC(10, 4),
                is_paid BOOLEAN DEFAULT 0,
                created_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )
            """,
        )

    if not _has_table(bind, "loan_installments"):
        create(
            """
            CREATE TABLE IF NOT EXISTS loan_installments (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                loan_id VARCHAR(36) NOT NULL,
                installment_no INTEGER NOT NULL,
                due_date VARCHAR(30) NOT NULL,
                principal_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
                interest_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
                total_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
                paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                paid_at VARCHAR(30),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE,
                deleted_at TIMESTAMP WITH TIME ZONE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS loan_installments (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                loan_id VARCHAR(36) NOT NULL,
                installment_no INTEGER NOT NULL,
                due_date VARCHAR(30) NOT NULL,
                principal_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
                interest_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
                total_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
                paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                paid_at VARCHAR(30),
                created_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )
            """,
        )

    if not _has_table(bind, "metal_rates"):
        create(
            """
            CREATE TABLE IF NOT EXISTS metal_rates (
                id VARCHAR(36) PRIMARY KEY,
                metal VARCHAR(20) NOT NULL,
                unit VARCHAR(20) NOT NULL DEFAULT 'GRAM',
                rate_bdt NUMERIC(18, 4) NOT NULL,
                effective_date VARCHAR(30) NOT NULL,
                source VARCHAR(80),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE,
                deleted_at TIMESTAMP WITH TIME ZONE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS metal_rates (
                id VARCHAR(36) PRIMARY KEY,
                metal VARCHAR(20) NOT NULL,
                unit VARCHAR(20) NOT NULL DEFAULT 'GRAM',
                rate_bdt NUMERIC(18, 4) NOT NULL,
                effective_date VARCHAR(30) NOT NULL,
                source VARCHAR(80),
                created_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )
            """,
        )

    if not _has_table(bind, "vehicles"):
        create(
            """
            CREATE TABLE IF NOT EXISTS vehicles (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                created_by_member_id VARCHAR(36) NOT NULL,
                name VARCHAR(150) NOT NULL,
                vehicle_type VARCHAR(80) DEFAULT 'CAR',
                registration_no VARCHAR(80),
                current_km NUMERIC(18, 2) DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'BDT',
                status VARCHAR(30) DEFAULT 'ACTIVE',
                notes VARCHAR(500),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE,
                deleted_at TIMESTAMP WITH TIME ZONE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS vehicles (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                created_by_member_id VARCHAR(36) NOT NULL,
                name VARCHAR(150) NOT NULL,
                vehicle_type VARCHAR(80) DEFAULT 'CAR',
                registration_no VARCHAR(80),
                current_km NUMERIC(18, 2) DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'BDT',
                status VARCHAR(30) DEFAULT 'ACTIVE',
                notes VARCHAR(500),
                created_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )
            """,
        )

    if not _has_table(bind, "health_annual_budgets"):
        create(
            """
            CREATE TABLE IF NOT EXISTS health_annual_budgets (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                member_id VARCHAR(36),
                year VARCHAR(10) NOT NULL,
                budget_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                spent_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'BDT',
                notes VARCHAR(500),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE,
                deleted_at TIMESTAMP WITH TIME ZONE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS health_annual_budgets (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                member_id VARCHAR(36),
                year VARCHAR(10) NOT NULL,
                budget_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                spent_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'BDT',
                notes VARCHAR(500),
                created_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )
            """,
        )

    if not _has_table(bind, "property_repairs"):
        create(
            """
            CREATE TABLE IF NOT EXISTS property_repairs (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                property_id VARCHAR(36) NOT NULL,
                created_by_member_id VARCHAR(36) NOT NULL,
                title VARCHAR(200) NOT NULL,
                amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                repair_date VARCHAR(30),
                currency VARCHAR(10) DEFAULT 'BDT',
                notes VARCHAR(500),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE,
                deleted_at TIMESTAMP WITH TIME ZONE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS property_repairs (
                id VARCHAR(36) PRIMARY KEY,
                family_id VARCHAR(36) NOT NULL,
                property_id VARCHAR(36) NOT NULL,
                created_by_member_id VARCHAR(36) NOT NULL,
                title VARCHAR(200) NOT NULL,
                amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
                repair_date VARCHAR(30),
                currency VARCHAR(10) DEFAULT 'BDT',
                notes VARCHAR(500),
                created_at DATETIME,
                updated_at DATETIME,
                deleted_at DATETIME
            )
            """,
        )


def downgrade() -> None:
    pass
