"""SQLite-safe additive column guard for local/dev (create_all does not ALTER)."""

from __future__ import annotations

from sqlalchemy import inspect, text

from app.core.database import engine


REQUIRED_COLUMNS: list[tuple[str, str, str]] = [
    ("ownership_transfer_requests", "admin_approved_by_member_id", "VARCHAR(36)"),
    ("family_members", "linked_member_id", "VARCHAR(36)"),
    ("family_members", "relationship_note", "VARCHAR(500)"),
    ("join_requests", "requested_linked_member_id", "VARCHAR(36)"),
    ("join_requests", "requested_relationship_note", "VARCHAR(500)"),
    ("join_requests", "requested_serial_label", "VARCHAR(40)"),
    ("refresh_tokens", "token_family", "VARCHAR(80)"),
    ("refresh_tokens", "status", "VARCHAR(30) DEFAULT 'ACTIVE'"),
    ("refresh_tokens", "revoked_at", "DATETIME"),
    ("refresh_tokens", "revoked_reason", "VARCHAR(120)"),
    ("refresh_tokens", "replaced_by_token_id", "VARCHAR"),
    ("refresh_tokens", "user_agent", "VARCHAR(255)"),
    ("refresh_tokens", "ip_address", "VARCHAR(64)"),
    ("refresh_tokens", "device_label", "VARCHAR(120)"),
    ("notifications", "user_id", "VARCHAR"),
]


def ensure_sqlite_columns() -> list[str]:
    added: list[str] = []
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, col, typ in REQUIRED_COLUMNS:
            if table not in tables:
                continue
            cols = {c["name"] for c in insp.get_columns(table)}
            if col in cols:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))
            added.append(f"{table}.{col}")
            # refresh insp cache for subsequent cols on same table
            insp = inspect(engine)
            tables = set(insp.get_table_names())
    return added
