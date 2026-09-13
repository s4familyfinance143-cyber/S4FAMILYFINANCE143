"""Additive column guard for SQLite dev and PostgreSQL production drift."""

from __future__ import annotations

from sqlalchemy import inspect, text

from app.core.database import engine


REQUIRED_COLUMNS: list[tuple[str, str, str, str]] = [
    # table, column, sqlite_type, postgres_type
    ("ownership_transfer_requests", "admin_approved_by_member_id", "VARCHAR(36)", "VARCHAR(36)"),
    ("family_members", "linked_member_id", "VARCHAR(36)", "VARCHAR(36)"),
    ("family_members", "relationship_note", "VARCHAR(500)", "VARCHAR(500)"),
    ("join_requests", "requested_linked_member_id", "VARCHAR(36)", "VARCHAR(36)"),
    ("join_requests", "requested_relationship_note", "VARCHAR(500)", "VARCHAR(500)"),
    ("join_requests", "requested_serial_label", "VARCHAR(40)", "VARCHAR(40)"),
    ("invite_codes", "invitee_email", "VARCHAR(255)", "VARCHAR(255)"),
    ("invite_codes", "invite_link_token", "VARCHAR(120)", "VARCHAR(120)"),
    ("invite_codes", "invite_channel", "VARCHAR(40) DEFAULT 'CODE'", "VARCHAR(40) DEFAULT 'CODE'"),
    ("invite_codes", "raw_code_hint", "VARCHAR(80)", "VARCHAR(80)"),
    ("users", "is_phone_verified", "BOOLEAN DEFAULT 0", "BOOLEAN DEFAULT FALSE"),
    ("refresh_tokens", "token_family", "VARCHAR(80)", "VARCHAR(80)"),
    ("refresh_tokens", "status", "VARCHAR(30) DEFAULT 'ACTIVE'", "VARCHAR(30) DEFAULT 'ACTIVE'"),
    ("refresh_tokens", "revoked_at", "DATETIME", "TIMESTAMP WITH TIME ZONE"),
    ("refresh_tokens", "revoked_reason", "VARCHAR(120)", "VARCHAR(120)"),
    ("refresh_tokens", "replaced_by_token_id", "VARCHAR", "VARCHAR"),
    ("refresh_tokens", "user_agent", "VARCHAR(255)", "VARCHAR(255)"),
    ("refresh_tokens", "ip_address", "VARCHAR(64)", "VARCHAR(64)"),
    ("refresh_tokens", "device_label", "VARCHAR(120)", "VARCHAR(120)"),
    ("notifications", "user_id", "VARCHAR", "VARCHAR"),
]


def ensure_required_columns() -> list[str]:
    added: list[str] = []
    dialect = engine.dialect.name
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, col, sqlite_typ, postgres_typ in REQUIRED_COLUMNS:
            if table not in tables:
                continue
            cols = {c["name"] for c in insp.get_columns(table)}
            if col in cols:
                continue
            typ = postgres_typ if dialect == "postgresql" else sqlite_typ
            if dialect == "postgresql":
                stmt = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {typ}"
            else:
                stmt = f"ALTER TABLE {table} ADD COLUMN {col} {typ}"
            conn.execute(text(stmt))
            added.append(f"{table}.{col}")
            insp = inspect(engine)
            tables = set(insp.get_table_names())
    return added


def ensure_sqlite_columns() -> list[str]:
    """Backward-compatible alias."""
    return ensure_required_columns()
