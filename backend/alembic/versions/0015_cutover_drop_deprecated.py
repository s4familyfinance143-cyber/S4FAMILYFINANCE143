"""Cutover: expand refresh_tokens, final backfill, DROP auth_sessions + push_devices.

Revision ID: 0015_cutover_drop_deprecated
Revises: 0014_education_funds

NOTE: phase15_items / phase16_items are NOT dropped here — PC/mobile may still
hit legacy phase routes for rare paths; dedicated tables are primary writers.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "0015_cutover_drop_deprecated"
down_revision: Union[str, None] = "0014_education_funds"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_postgres(bind) -> bool:
    return bind.dialect.name == "postgresql"


def _ts_type(bind) -> str:
    return "TIMESTAMPTZ" if _is_postgres(bind) else "DATETIME"


def _add_column_if_missing(bind, table: str, column: str, ddl: str) -> None:
    insp = inspect(bind)
    if not insp.has_table(table):
        return
    cols = {c["name"] for c in insp.get_columns(table)}
    if column in cols:
        return
    bind.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    ts = _ts_type(bind)

    # --- expand refresh_tokens ---
    if insp.has_table("refresh_tokens"):
        _add_column_if_missing(bind, "refresh_tokens", "token_family", "token_family VARCHAR(80)")
        _add_column_if_missing(bind, "refresh_tokens", "status", "status VARCHAR(30) DEFAULT 'ACTIVE'")
        _add_column_if_missing(bind, "refresh_tokens", "revoked_at", f"revoked_at {ts}")
        _add_column_if_missing(bind, "refresh_tokens", "revoked_reason", "revoked_reason VARCHAR(120)")
        _add_column_if_missing(bind, "refresh_tokens", "replaced_by_token_id", "replaced_by_token_id VARCHAR(36)")
        _add_column_if_missing(bind, "refresh_tokens", "user_agent", "user_agent VARCHAR(255)")
        _add_column_if_missing(bind, "refresh_tokens", "ip_address", "ip_address VARCHAR(64)")
        _add_column_if_missing(bind, "refresh_tokens", "device_label", "device_label VARCHAR(120)")

    # --- final backfill auth_sessions → refresh_tokens / device_sessions ---
    insp = inspect(bind)
    if insp.has_table("auth_sessions") and insp.has_table("refresh_tokens"):
        bind.execute(
            text(
                """
                INSERT INTO refresh_tokens (
                    id, user_id, token_hash, device_id, expires_at, revoked,
                    legacy_session_id, token_family, status, revoked_at, revoked_reason,
                    user_agent, ip_address, device_label, created_at, updated_at, deleted_at
                )
                SELECT
                    a.id || '-rt2',
                    a.user_id,
                    a.refresh_token_hash,
                    a.device_label,
                    a.expires_at,
                    CASE WHEN a.status = 'ACTIVE' AND a.revoked_at IS NULL THEN FALSE ELSE TRUE END,
                    a.id,
                    a.token_family,
                    a.status,
                    a.revoked_at,
                    a.revoked_reason,
                    a.user_agent,
                    a.ip_address,
                    a.device_label,
                    a.created_at,
                    a.updated_at,
                    a.deleted_at
                FROM auth_sessions a
                WHERE NOT EXISTS (
                    SELECT 1 FROM refresh_tokens r
                    WHERE r.token_hash = a.refresh_token_hash
                       OR r.legacy_session_id = a.id
                )
                """
            )
        )
        if insp.has_table("device_sessions"):
            bind.execute(
                text(
                    """
                    INSERT INTO device_sessions (
                        id, user_id, device_name, platform, fcm_token, last_active,
                        ip_address, user_agent, legacy_session_id, created_at, updated_at, deleted_at
                    )
                    SELECT
                        a.id || '-ds2',
                        a.user_id,
                        a.device_label,
                        NULL,
                        NULL,
                        a.updated_at,
                        a.ip_address,
                        a.user_agent,
                        a.id,
                        a.created_at,
                        a.updated_at,
                        a.deleted_at
                    FROM auth_sessions a
                    WHERE NOT EXISTS (
                        SELECT 1 FROM device_sessions d WHERE d.legacy_session_id = a.id
                    )
                    """
                )
            )

    # --- final backfill push_devices → push_tokens ---
    insp = inspect(bind)
    if insp.has_table("push_devices") and insp.has_table("push_tokens"):
        bind.execute(
            text(
                """
                INSERT INTO push_tokens (
                    id, user_id, device_id, fcm_token, platform, is_active,
                    family_id, legacy_push_device_id, created_at, updated_at, deleted_at
                )
                SELECT
                    p.id || '-pt2',
                    p.user_id,
                    p.device_label,
                    p.token,
                    COALESCE(p.platform, 'UNKNOWN'),
                    CASE WHEN p.is_active THEN TRUE ELSE FALSE END,
                    p.family_id,
                    p.id,
                    p.created_at,
                    p.updated_at,
                    p.deleted_at
                FROM push_devices p
                WHERE NOT EXISTS (
                    SELECT 1 FROM push_tokens t
                    WHERE t.legacy_push_device_id = p.id
                       OR (t.user_id = p.user_id AND t.fcm_token = p.token)
                )
                """
            )
        )

    # --- device_registry backfill from sync_devices if present ---
    insp = inspect(bind)
    if insp.has_table("sync_devices") and insp.has_table("device_registry"):
        id_expr = "gen_random_uuid()::text" if _is_postgres(bind) else "lower(hex(randomblob(16)))"
        # Use SAVEPOINT so Postgres soft-fail does not abort the whole migration txn
        bind.execute(text("SAVEPOINT device_registry_backfill"))
        try:
            bind.execute(
                text(
                    f"""
                    INSERT INTO device_registry (
                        id, user_id, device_fingerprint, platform, app_version,
                        registered_at, family_id, legacy_sync_device_id, created_at, updated_at, deleted_at
                    )
                    SELECT
                        {id_expr},
                        s.user_id,
                        COALESCE(s.device_id, s.id),
                        s.platform,
                        s.app_version,
                        s.created_at,
                        s.family_id,
                        s.id,
                        s.created_at,
                        s.updated_at,
                        s.deleted_at
                    FROM sync_devices s
                    WHERE s.user_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM device_registry d
                        WHERE d.legacy_sync_device_id = s.id
                           OR (d.user_id = s.user_id AND d.device_fingerprint = COALESCE(s.device_id, s.id))
                      )
                    """
                )
            )
            bind.execute(text("RELEASE SAVEPOINT device_registry_backfill"))
        except Exception:
            bind.execute(text("ROLLBACK TO SAVEPOINT device_registry_backfill"))

    # --- DROP deprecated aliases ---
    insp = inspect(bind)
    if insp.has_table("auth_sessions"):
        op.drop_table("auth_sessions")
    insp = inspect(bind)
    if insp.has_table("push_devices"):
        op.drop_table("push_devices")


def downgrade() -> None:
    bind = op.get_bind()
    ts = _ts_type(bind)
    # Best-effort recreate empty shells (not full schema restore).
    bind.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id VARCHAR PRIMARY KEY,
                created_at {ts} NOT NULL,
                updated_at {ts} NOT NULL,
                deleted_at {ts},
                user_id VARCHAR NOT NULL,
                refresh_token_hash VARCHAR(255) NOT NULL,
                token_family VARCHAR(80) NOT NULL,
                status VARCHAR(30) NOT NULL,
                issued_at {ts} NOT NULL,
                expires_at {ts} NOT NULL,
                revoked_at {ts},
                revoked_reason VARCHAR(120),
                replaced_by_session_id VARCHAR,
                user_agent VARCHAR(255),
                ip_address VARCHAR(64),
                device_label VARCHAR(120)
            )
            """
        )
    )
    bind.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS push_devices (
                id VARCHAR PRIMARY KEY,
                created_at {ts} NOT NULL,
                updated_at {ts} NOT NULL,
                deleted_at {ts},
                family_id VARCHAR NOT NULL,
                user_id VARCHAR NOT NULL,
                member_id VARCHAR,
                token VARCHAR(512) NOT NULL,
                platform VARCHAR(40) NOT NULL,
                provider VARCHAR(40) NOT NULL,
                device_label VARCHAR(120),
                is_active BOOLEAN NOT NULL
            )
            """
        )
    )
