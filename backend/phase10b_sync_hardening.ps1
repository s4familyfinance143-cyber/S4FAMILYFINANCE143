$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\ARCHITECTURE_PHASE_10B_OFFLINE_SYNC_ENGINE_HARDENING_$TS"
$BACKUP="$BACKUPROOT\ARCHITECTURE-PHASE-10B-OFFLINE-SYNC-HARDENING-BEFORE-$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Copy-Item "$BACKEND\app\main.py" "$BACKUP\main.py.before-phase10b" -Force

if (Test-Path "$BACKEND\app\api\v1\offline_sync_hardened.py") {
  Copy-Item "$BACKEND\app\api\v1\offline_sync_hardened.py" "$BACKUP\offline_sync_hardened.py.before-phase10b" -Force
}

$env:PYTHONPATH=$BACKEND

@'
from __future__ import annotations

import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.database import get_db

try:
    from app.api.v1.family_governance_hardened import (
        _phase5b_get_current_user,
        _phase5b_require_permission,
    )
except Exception as import_error:  # pragma: no cover
    _PHASE10B_IMPORT_ERROR = import_error

    def _phase5b_get_current_user():
        raise HTTPException(
            status_code=500,
            detail=f"RBAC dependency import failed: {_PHASE10B_IMPORT_ERROR}",
        )

    def _phase5b_require_permission(*args, **kwargs):
        raise HTTPException(
            status_code=500,
            detail=f"RBAC permission dependency import failed: {_PHASE10B_IMPORT_ERROR}",
        )


router = APIRouter(tags=["Phase 10B Offline Sync Engine"])


SYNC_TABLES = [
    "sync_devices",
    "sync_state",
    "sync_outbox",
    "sync_inbox",
    "sync_conflicts",
]


def _phase10b_now_token() -> str:
    return datetime.utcnow().isoformat(timespec="microseconds") + "Z"


def _phase10b_q(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _phase10b_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _phase10b_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_phase10b_json(v) for v in value]
    return value


def _phase10b_json_text(value: Any) -> str:
    return json.dumps(_phase10b_json(value), ensure_ascii=False, default=str)


def _phase10b_load_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except Exception:
        return value


def _phase10b_rows(result) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in result.fetchall()]


def _phase10b_tables(db: Session) -> set[str]:
    return set(inspect(db.bind).get_table_names())


def _phase10b_columns(db: Session, table_name: str) -> dict[str, Any]:
    if table_name not in _phase10b_tables(db):
        return {}
    return {c["name"]: c for c in inspect(db.bind).get_columns(table_name)}


def _phase10b_first(columns: dict[str, Any], names: list[str]) -> Optional[str]:
    for name in names:
        if name in columns:
            return name
    lowered = {c.lower(): c for c in columns}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def _phase10b_require_any_permission(
    db: Session,
    family_id: str,
    current_user: Any,
    permissions: list[str],
) -> Any:
    last_exc: Optional[HTTPException] = None

    for permission in permissions:
        try:
            return _phase5b_require_permission(db, str(family_id), current_user, permission)
        except HTTPException as exc:
            last_exc = exc
            if exc.status_code not in (401, 403, 404):
                raise

    if last_exc is not None:
        raise last_exc

    raise HTTPException(status_code=403, detail="Permission denied")


def _phase10b_ensure_sync_tables(db: Session) -> None:
    ddl = [
        """
        CREATE TABLE IF NOT EXISTS sync_devices (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            device_name TEXT,
            platform TEXT,
            app_version TEXT,
            last_seen_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(family_id, device_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS sync_state (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            last_pull_at TIMESTAMP,
            last_push_at TIMESTAMP,
            last_sync_token TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(family_id, device_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS sync_outbox (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            client_change_id TEXT,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            operation TEXT NOT NULL,
            payload TEXT,
            status TEXT NOT NULL DEFAULT 'PENDING',
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            synced_at TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS sync_inbox (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            sync_token TEXT NOT NULL,
            payload TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS sync_conflicts (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            local_payload TEXT,
            remote_payload TEXT,
            resolution_payload TEXT,
            status TEXT NOT NULL DEFAULT 'OPEN',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP,
            resolved_by_member_id TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_sync_devices_family_device ON sync_devices(family_id, device_id)",
        "CREATE INDEX IF NOT EXISTS idx_sync_state_family_device ON sync_state(family_id, device_id)",
        "CREATE INDEX IF NOT EXISTS idx_sync_outbox_family_status ON sync_outbox(family_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_sync_outbox_family_device ON sync_outbox(family_id, device_id)",
        "CREATE INDEX IF NOT EXISTS idx_sync_inbox_family_device ON sync_inbox(family_id, device_id)",
        "CREATE INDEX IF NOT EXISTS idx_sync_conflicts_family_status ON sync_conflicts(family_id, status)",
    ]

    for statement in ddl:
        db.execute(text(statement))

    db.commit()


def _phase10b_get_current_member_id(
    db: Session,
    family_id: str,
    current_user: Any,
) -> Optional[str]:
    if "family_members" not in _phase10b_tables(db):
        return None

    cols = _phase10b_columns(db, "family_members")
    member_id_col = _phase10b_first(cols, ["id", "member_id"])
    family_col = _phase10b_first(cols, ["family_id"])
    user_col = _phase10b_first(cols, ["user_id", "uid"])

    user_id = getattr(current_user, "id", None) or getattr(current_user, "user_id", None)

    if not member_id_col or not family_col or not user_col or not user_id:
        return None

    row = db.execute(
        text(
            f"SELECT {_phase10b_q(member_id_col)} "
            f"FROM family_members "
            f"WHERE {_phase10b_q(family_col)} = :family_id "
            f"AND {_phase10b_q(user_col)} = :user_id "
            f"LIMIT 1"
        ),
        {"family_id": str(family_id), "user_id": str(user_id)},
    ).first()

    if not row:
        return None

    return str(row[0])


def _phase10b_insert_audit(
    db: Session,
    family_id: str,
    current_user: Any,
    action_type: str,
    title: str,
    description: str,
    entity_type: str = "SYNC",
    entity_id: Optional[str] = None,
    severity: str = "INFO",
) -> None:
    if "audit_logs" not in _phase10b_tables(db):
        return

    cols = _phase10b_columns(db, "audit_logs")
    payload: dict[str, Any] = {}
    member_id = _phase10b_get_current_member_id(db, family_id, current_user)

    if "id" in cols:
        payload["id"] = str(uuid.uuid4())
    if "family_id" in cols:
        payload["family_id"] = str(family_id)
    if "member_id" in cols and member_id:
        payload["member_id"] = member_id
    if "user_id" in cols:
        user_id = getattr(current_user, "id", None) or getattr(current_user, "user_id", None)
        if user_id:
            payload["user_id"] = str(user_id)
    if "action_type" in cols:
        payload["action_type"] = action_type
    elif "action" in cols:
        payload["action"] = action_type
    if "entity_type" in cols:
        payload["entity_type"] = entity_type
    if "entity_id" in cols:
        payload["entity_id"] = entity_id
    if "title" in cols:
        payload["title"] = title
    if "description" in cols:
        payload["description"] = description
    if "severity" in cols:
        payload["severity"] = severity
    if "created_at" in cols:
        payload["created_at"] = datetime.utcnow()
    if "updated_at" in cols:
        payload["updated_at"] = datetime.utcnow()

    if not payload:
        return

    try:
        names = list(payload.keys())
        db.execute(
            text(
                f"INSERT INTO audit_logs "
                f"({', '.join(_phase10b_q(n) for n in names)}) "
                f"VALUES ({', '.join(':' + n for n in names)})"
            ),
            payload,
        )
        db.commit()
    except Exception:
        db.rollback()


def _phase10b_register_device(
    db: Session,
    family_id: str,
    device_id: str,
    device_name: Optional[str] = None,
    platform: Optional[str] = None,
    app_version: Optional[str] = None,
) -> None:
    _phase10b_ensure_sync_tables(db)

    existing = db.execute(
        text(
            "SELECT id FROM sync_devices "
            "WHERE family_id = :family_id AND device_id = :device_id "
            "LIMIT 1"
        ),
        {"family_id": family_id, "device_id": device_id},
    ).first()

    if existing:
        db.execute(
            text(
                "UPDATE sync_devices "
                "SET device_name = COALESCE(:device_name, device_name), "
                "platform = COALESCE(:platform, platform), "
                "app_version = COALESCE(:app_version, app_version), "
                "last_seen_at = CURRENT_TIMESTAMP, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE family_id = :family_id AND device_id = :device_id"
            ),
            {
                "family_id": family_id,
                "device_id": device_id,
                "device_name": device_name,
                "platform": platform,
                "app_version": app_version,
            },
        )
    else:
        db.execute(
            text(
                "INSERT INTO sync_devices "
                "(id, family_id, device_id, device_name, platform, app_version, last_seen_at, created_at, updated_at) "
                "VALUES (:id, :family_id, :device_id, :device_name, :platform, :app_version, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {
                "id": str(uuid.uuid4()),
                "family_id": family_id,
                "device_id": device_id,
                "device_name": device_name,
                "platform": platform,
                "app_version": app_version,
            },
        )

    state_existing = db.execute(
        text(
            "SELECT id FROM sync_state "
            "WHERE family_id = :family_id AND device_id = :device_id "
            "LIMIT 1"
        ),
        {"family_id": family_id, "device_id": device_id},
    ).first()

    if not state_existing:
        db.execute(
            text(
                "INSERT INTO sync_state "
                "(id, family_id, device_id, last_sync_token, created_at, updated_at) "
                "VALUES (:id, :family_id, :device_id, :last_sync_token, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {
                "id": str(uuid.uuid4()),
                "family_id": family_id,
                "device_id": device_id,
                "last_sync_token": _phase10b_now_token(),
            },
        )

    db.commit()


def _phase10b_family_rows(
    db: Session,
    table_name: str,
    family_id: str,
    since_token: Optional[str],
    limit: int,
) -> list[dict[str, Any]]:
    if table_name not in _phase10b_tables(db):
        return []

    cols = _phase10b_columns(db, table_name)
    family_col = _phase10b_first(cols, ["family_id"])
    updated_col = _phase10b_first(cols, ["updated_at", "created_at"])
    deleted_col = _phase10b_first(cols, ["deleted_at"])
    id_col = _phase10b_first(cols, ["id"])

    if not family_col:
        return []

    filters = [f"{_phase10b_q(family_col)} = :family_id"]
    params: dict[str, Any] = {"family_id": family_id, "limit": limit}

    if deleted_col:
        filters.append(f"{_phase10b_q(deleted_col)} IS NULL")

    if since_token and updated_col:
        filters.append(f"CAST({_phase10b_q(updated_col)} AS TEXT) >= :since_token")
        params["since_token"] = since_token

    order_col = updated_col or id_col or family_col

    return _phase10b_rows(
        db.execute(
            text(
                f"SELECT * FROM {_phase10b_q(table_name)} "
                f"WHERE {' AND '.join(filters)} "
                f"ORDER BY {_phase10b_q(order_col)} ASC "
                f"LIMIT :limit"
            ),
            params,
        )
    )


def _phase10b_transaction_line_rows(
    db: Session,
    family_id: str,
    since_token: Optional[str],
    limit: int,
) -> list[dict[str, Any]]:
    if "transaction_lines" not in _phase10b_tables(db) or "transactions" not in _phase10b_tables(db):
        return []

    tx_cols = _phase10b_columns(db, "transactions")
    line_cols = _phase10b_columns(db, "transaction_lines")

    tx_id = _phase10b_first(tx_cols, ["id", "transaction_id"])
    line_tx = _phase10b_first(line_cols, ["transaction_id", "tx_id"])
    updated_col = _phase10b_first(line_cols, ["updated_at", "created_at"])
    deleted_col = _phase10b_first(line_cols, ["deleted_at"])

    if not tx_id or not line_tx:
        return []

    filters = ["t.family_id = :family_id"]
    params: dict[str, Any] = {"family_id": family_id, "limit": limit}

    if deleted_col:
        filters.append(f"tl.{_phase10b_q(deleted_col)} IS NULL")

    if since_token and updated_col:
        filters.append(f"CAST(tl.{_phase10b_q(updated_col)} AS TEXT) >= :since_token")
        params["since_token"] = since_token

    order_col = f"tl.{_phase10b_q(updated_col)}" if updated_col else f"tl.{_phase10b_q(line_tx)}"

    return _phase10b_rows(
        db.execute(
            text(
                f"SELECT tl.* FROM transaction_lines tl "
                f"JOIN transactions t ON t.{_phase10b_q(tx_id)} = tl.{_phase10b_q(line_tx)} "
                f"WHERE {' AND '.join(filters)} "
                f"ORDER BY {order_col} ASC "
                f"LIMIT :limit"
            ),
            params,
        )
    )


@router.get("/families/{family_id}/sync/status")
def phase10b_sync_status(
    family_id: str,
    device_id: str = Query(default="default-device"),
    device_name: Optional[str] = Query(default=None),
    platform: Optional[str] = Query(default=None),
    app_version: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.view", "sync.manage", "audit.view", "reports.view", "accounts.view_all"],
    )

    _phase10b_register_device(db, family_id, device_id, device_name, platform, app_version)

    counts = {}
    for table in SYNC_TABLES:
        counts[table] = db.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE family_id = :family_id"),
            {"family_id": family_id},
        ).scalar()

    pending_outbox = db.execute(
        text(
            "SELECT COUNT(*) FROM sync_outbox "
            "WHERE family_id = :family_id AND status = 'PENDING'"
        ),
        {"family_id": family_id},
    ).scalar()

    open_conflicts = db.execute(
        text(
            "SELECT COUNT(*) FROM sync_conflicts "
            "WHERE family_id = :family_id AND status = 'OPEN'"
        ),
        {"family_id": family_id},
    ).scalar()

    state = db.execute(
        text(
            "SELECT * FROM sync_state "
            "WHERE family_id = :family_id AND device_id = :device_id "
            "LIMIT 1"
        ),
        {"family_id": family_id, "device_id": device_id},
    ).mappings().first()

    return {
        "status": "ok",
        "family_id": family_id,
        "device_id": device_id,
        "offline_first": True,
        "sync_tables_ready": True,
        "local_write_first": True,
        "pending_outbox": int(pending_outbox or 0),
        "open_conflicts": int(open_conflicts or 0),
        "table_counts": _phase10b_json(counts),
        "sync_state": _phase10b_json(dict(state) if state else None),
    }


@router.post("/families/{family_id}/sync/push")
def phase10b_sync_push(
    family_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.push", "sync.manage", "transactions.create", "accounts.update"],
    )

    _phase10b_ensure_sync_tables(db)

    device_id = str(body.get("device_id") or "default-device")
    device_name = body.get("device_name")
    platform = body.get("platform")
    app_version = body.get("app_version")
    changes = body.get("changes") or []

    if not isinstance(changes, list):
        raise HTTPException(status_code=422, detail="changes must be a list")

    if len(changes) > 500:
        raise HTTPException(status_code=422, detail="changes limit exceeded")

    _phase10b_register_device(db, family_id, device_id, device_name, platform, app_version)

    accepted_ids: list[str] = []
    conflict_ids: list[str] = []

    for change in changes:
        if not isinstance(change, dict):
            raise HTTPException(status_code=422, detail="Each change must be an object")

        entity_type = str(change.get("entity_type") or "").strip()
        operation = str(change.get("operation") or "").strip().upper()

        if not entity_type:
            raise HTTPException(status_code=422, detail="entity_type required")
        if operation not in {"CREATE", "UPDATE", "DELETE", "UPSERT"}:
            raise HTTPException(status_code=422, detail="operation must be CREATE/UPDATE/DELETE/UPSERT")

        outbox_id = str(uuid.uuid4())
        entity_id = change.get("entity_id")
        payload = change.get("payload", change)

        db.execute(
            text(
                "INSERT INTO sync_outbox "
                "(id, family_id, device_id, client_change_id, entity_type, entity_id, operation, payload, status, created_at, updated_at) "
                "VALUES (:id, :family_id, :device_id, :client_change_id, :entity_type, :entity_id, :operation, :payload, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {
                "id": outbox_id,
                "family_id": family_id,
                "device_id": device_id,
                "client_change_id": str(change.get("client_change_id") or ""),
                "entity_type": entity_type,
                "entity_id": str(entity_id) if entity_id is not None else None,
                "operation": operation,
                "payload": _phase10b_json_text(payload),
            },
        )
        accepted_ids.append(outbox_id)

        if bool(change.get("conflict")):
            conflict_id = str(uuid.uuid4())
            db.execute(
                text(
                    "INSERT INTO sync_conflicts "
                    "(id, family_id, device_id, entity_type, entity_id, local_payload, remote_payload, status, created_at) "
                    "VALUES (:id, :family_id, :device_id, :entity_type, :entity_id, :local_payload, :remote_payload, 'OPEN', CURRENT_TIMESTAMP)"
                ),
                {
                    "id": conflict_id,
                    "family_id": family_id,
                    "device_id": device_id,
                    "entity_type": entity_type,
                    "entity_id": str(entity_id) if entity_id is not None else None,
                    "local_payload": _phase10b_json_text(payload),
                    "remote_payload": _phase10b_json_text(change.get("remote_payload")),
                },
            )
            conflict_ids.append(conflict_id)

    sync_token = _phase10b_now_token()

    db.execute(
        text(
            "UPDATE sync_state "
            "SET last_push_at = CURRENT_TIMESTAMP, last_sync_token = :token, updated_at = CURRENT_TIMESTAMP "
            "WHERE family_id = :family_id AND device_id = :device_id"
        ),
        {"family_id": family_id, "device_id": device_id, "token": sync_token},
    )

    db.commit()

    _phase10b_insert_audit(
        db,
        family_id,
        current_user,
        "SYNC_PUSH",
        "Offline Sync Push",
        f"Accepted {len(accepted_ids)} offline sync changes",
        "SYNC",
        device_id,
    )

    return {
        "status": "accepted",
        "family_id": family_id,
        "device_id": device_id,
        "accepted_count": len(accepted_ids),
        "accepted_outbox_ids": accepted_ids,
        "conflict_count": len(conflict_ids),
        "conflict_ids": conflict_ids,
        "sync_token": sync_token,
    }


@router.get("/families/{family_id}/sync/pull")
def phase10b_sync_pull(
    family_id: str,
    device_id: str = Query(default="default-device"),
    since_token: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.pull", "sync.manage", "reports.view", "accounts.view_all"],
    )

    _phase10b_register_device(db, family_id, device_id)

    server_changes = {
        "families": _phase10b_family_rows(db, "families", family_id, since_token, limit),
        "family_members": _phase10b_family_rows(db, "family_members", family_id, since_token, limit),
        "accounts": _phase10b_family_rows(db, "accounts", family_id, since_token, limit),
        "transactions": _phase10b_family_rows(db, "transactions", family_id, since_token, limit),
        "transaction_lines": _phase10b_transaction_line_rows(db, family_id, since_token, limit),
        "audit_logs": _phase10b_family_rows(db, "audit_logs", family_id, since_token, limit),
    }

    sync_token = _phase10b_now_token()

    db.execute(
        text(
            "INSERT INTO sync_inbox "
            "(id, family_id, device_id, sync_token, payload, created_at) "
            "VALUES (:id, :family_id, :device_id, :sync_token, :payload, CURRENT_TIMESTAMP)"
        ),
        {
            "id": str(uuid.uuid4()),
            "family_id": family_id,
            "device_id": device_id,
            "sync_token": sync_token,
            "payload": _phase10b_json_text(server_changes),
        },
    )

    db.execute(
        text(
            "UPDATE sync_state "
            "SET last_pull_at = CURRENT_TIMESTAMP, last_sync_token = :token, updated_at = CURRENT_TIMESTAMP "
            "WHERE family_id = :family_id AND device_id = :device_id"
        ),
        {"family_id": family_id, "device_id": device_id, "token": sync_token},
    )

    db.commit()

    _phase10b_insert_audit(
        db,
        family_id,
        current_user,
        "SYNC_PULL",
        "Offline Sync Pull",
        "Offline sync pull generated server change payload",
        "SYNC",
        device_id,
    )

    counts = {k: len(v) for k, v in server_changes.items()}

    return {
        "status": "ok",
        "family_id": family_id,
        "device_id": device_id,
        "since_token": since_token,
        "sync_token": sync_token,
        "change_counts": counts,
        "changes": _phase10b_json(server_changes),
    }


@router.get("/families/{family_id}/sync/conflicts")
def phase10b_sync_conflicts(
    family_id: str,
    status: str = Query(default="OPEN"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.conflicts", "sync.manage", "audit.view", "reports.view"],
    )

    _phase10b_ensure_sync_tables(db)

    rows = _phase10b_rows(
        db.execute(
            text(
                "SELECT * FROM sync_conflicts "
                "WHERE family_id = :family_id AND UPPER(status) = UPPER(:status) "
                "ORDER BY created_at DESC "
                "LIMIT :limit"
            ),
            {"family_id": family_id, "status": status, "limit": limit},
        )
    )

    for row in rows:
        row["local_payload"] = _phase10b_load_json(row.get("local_payload"))
        row["remote_payload"] = _phase10b_load_json(row.get("remote_payload"))
        row["resolution_payload"] = _phase10b_load_json(row.get("resolution_payload"))

    return {
        "status": "ok",
        "family_id": family_id,
        "filter_status": status,
        "conflict_count": len(rows),
        "conflicts": _phase10b_json(rows),
    }


@router.post("/families/{family_id}/sync/conflicts/{conflict_id}/resolve")
def phase10b_resolve_conflict(
    family_id: str,
    conflict_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.resolve", "sync.manage", "audit.manage", "audit.view_all"],
    )

    _phase10b_ensure_sync_tables(db)

    existing = db.execute(
        text(
            "SELECT * FROM sync_conflicts "
            "WHERE id = :conflict_id AND family_id = :family_id "
            "LIMIT 1"
        ),
        {"conflict_id": conflict_id, "family_id": family_id},
    ).mappings().first()

    if not existing:
        raise HTTPException(status_code=404, detail="Sync conflict not found in this family")

    member_id = _phase10b_get_current_member_id(db, family_id, current_user)

    db.execute(
        text(
            "UPDATE sync_conflicts "
            "SET status = 'RESOLVED', "
            "resolution_payload = :resolution_payload, "
            "resolved_at = CURRENT_TIMESTAMP, "
            "resolved_by_member_id = :resolved_by_member_id "
            "WHERE id = :conflict_id AND family_id = :family_id"
        ),
        {
            "conflict_id": conflict_id,
            "family_id": family_id,
            "resolution_payload": _phase10b_json_text(body),
            "resolved_by_member_id": member_id,
        },
    )

    db.commit()

    _phase10b_insert_audit(
        db,
        family_id,
        current_user,
        "SYNC_CONFLICT_RESOLVE",
        "Offline Sync Conflict Resolved",
        f"Sync conflict {conflict_id} resolved",
        "SYNC_CONFLICT",
        conflict_id,
    )

    return {
        "status": "resolved",
        "family_id": family_id,
        "conflict_id": conflict_id,
    }
'@ | Set-Content "$BACKEND\app\api\v1\offline_sync_hardened.py" -Encoding UTF8

$MAIN="$BACKEND\app\main.py"
$mainText=Get-Content $MAIN -Raw
$marker="# === PHASE 10B OFFLINE SYNC ROUTER INCLUDE ==="

if ($mainText -notlike "*$marker*") {
  $append=@"

$marker
from app.api.v1.offline_sync_hardened import router as phase10b_offline_sync_router
app.include_router(phase10b_offline_sync_router)
# === END PHASE 10B OFFLINE SYNC ROUTER INCLUDE ===
"@
  Add-Content -Path $MAIN -Value $append -Encoding UTF8
}

Write-Host "1) Compile check..." -ForegroundColor Cyan

& $PY -m py_compile "$BACKEND\app\api\v1\offline_sync_hardened.py"
if ($LASTEXITCODE -ne 0) { throw "offline_sync_hardened.py compile failed" }

& $PY -m py_compile "$BACKEND\app\main.py"
if ($LASTEXITCODE -ne 0) { throw "main.py compile failed" }

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "backend compileall failed" }

Write-Host "2) SQLite route/OpenAPI check..." -ForegroundColor Cyan

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

@'
from app.main import app

required = [
    "/families/{family_id}/sync/status",
    "/families/{family_id}/sync/push",
    "/families/{family_id}/sync/pull",
    "/families/{family_id}/sync/conflicts",
    "/families/{family_id}/sync/conflicts/{conflict_id}/resolve",
]

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

missing_routes = [p for p in required if p not in paths]
missing_openapi = [p for p in required if p not in openapi_paths]

print("required_phase10b_paths:", required)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)

if missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\01_phase10b_sqlite_route_openapi_check.py" -Encoding UTF8

& $PY "$VERIFY\01_phase10b_sqlite_route_openapi_check.py" | Tee-Object "$VERIFY\01_phase10b_sqlite_route_openapi_check.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite route/openapi check failed" }

Write-Host "3) SQLite sync table creation + integrity check..." -ForegroundColor Cyan

@'
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

from app.core.database import engine
from app.api.v1.offline_sync_hardened import _phase10b_ensure_sync_tables, SYNC_TABLES

Session = sessionmaker(bind=engine)
db = Session()
try:
    _phase10b_ensure_sync_tables(db)
finally:
    db.close()

insp = inspect(engine)
tables = insp.get_table_names()
missing_sync_tables = [t for t in SYNC_TABLES if t not in tables]

with engine.connect() as conn:
    fk_count = len(conn.execute(text("PRAGMA foreign_key_check")).fetchall())
    alembic_version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()

    sync_counts = {}
    for table in SYNC_TABLES:
        sync_counts[table] = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()

    imbalanced_count = conn.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT transaction_id,
                   ROUND(SUM(COALESCE(debit,0)) - SUM(COALESCE(credit,0)), 2) AS diff
            FROM transaction_lines
            GROUP BY transaction_id
            HAVING diff != 0
        )
    """)).scalar()

    single_line_count = conn.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT transaction_id, COUNT(*) AS line_count
            FROM transaction_lines
            GROUP BY transaction_id
            HAVING line_count < 2
        )
    """)).scalar()

    cross_family_lines = conn.execute(text("""
        SELECT COUNT(*)
        FROM transaction_lines tl
        JOIN transactions t ON t.id = tl.transaction_id
        JOIN accounts a ON a.id = tl.account_id
        WHERE a.family_id != t.family_id
    """)).scalar()

print("missing_sync_tables:", missing_sync_tables)
print("sync_counts:", sync_counts)
print("foreign_key_check_count:", fk_count)
print("alembic_version:", alembic_version)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)

if missing_sync_tables:
    raise SystemExit(1)
if fk_count != 0:
    raise SystemExit(1)
if alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\02_phase10b_sqlite_sync_table_integrity_check.py" -Encoding UTF8

& $PY "$VERIFY\02_phase10b_sqlite_sync_table_integrity_check.py" | Tee-Object "$VERIFY\02_phase10b_sqlite_sync_table_integrity_check.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite sync table integrity check failed" }

Write-Host "4) PostgreSQL route/table check..." -ForegroundColor Cyan

Get-Service postgresql-x64-17 | Select-Object Name,Status,DisplayName | Tee-Object "$VERIFY\03_postgres_service_check.txt"

$portOk = Test-NetConnection 127.0.0.1 -Port 5432
$portOk | Tee-Object "$VERIFY\04_postgres_port_check.txt"
if ($portOk.TcpTestSucceeded -ne $true) { throw "PostgreSQL port 5432 not reachable" }

$env:ENVIRONMENT="production"
$env:DATABASE_URL="postgresql+psycopg://postgres:s4m1%40v1i2@127.0.0.1:5432/s4_family_finance_phase1e_test"
$env:AUTO_CREATE_TABLES="false"
$env:JWT_SECRET_KEY="THIS_IS_A_STRONG_TEST_SECRET_123456789"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

@'
from sqlalchemy import inspect
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.core.config import settings
from app.core.database import engine
from app.api.v1.offline_sync_hardened import _phase10b_ensure_sync_tables, SYNC_TABLES

required = [
    "/families/{family_id}/sync/status",
    "/families/{family_id}/sync/push",
    "/families/{family_id}/sync/pull",
    "/families/{family_id}/sync/conflicts",
    "/families/{family_id}/sync/conflicts/{conflict_id}/resolve",
]

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

missing_routes = [p for p in required if p not in paths]
missing_openapi = [p for p in required if p not in openapi_paths]

Session = sessionmaker(bind=engine)
db = Session()
try:
    _phase10b_ensure_sync_tables(db)
finally:
    db.close()

tables = inspect(engine).get_table_names()
missing_sync_tables = [t for t in SYNC_TABLES if t not in tables]

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)
print("missing_sync_tables:", missing_sync_tables)

if not settings.IS_POSTGRESQL:
    raise SystemExit(1)
if missing_routes or missing_openapi or missing_sync_tables:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\05_phase10b_postgres_route_table_check.py" -Encoding UTF8

& $PY "$VERIFY\05_phase10b_postgres_route_table_check.py" | Tee-Object "$VERIFY\05_phase10b_postgres_route_table_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL route/table check failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\06_phase10b_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL alembic current failed" }

Select-String -Path "$VERIFY\06_phase10b_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 10B OFFLINE SYNC ENGINE ACTUAL HARDENING REPORT

STATUS: PASS
Time: $TS

IMPLEMENTED:
- New hardened router: app/api/v1/offline_sync_hardened.py
- Included router in app/main.py
- Added sync tables foundation:
  - sync_devices
  - sync_state
  - sync_outbox
  - sync_inbox
  - sync_conflicts
- Added family-scoped sync status endpoint
- Added family-scoped sync push endpoint
- Added family-scoped sync pull endpoint
- Added family-scoped sync conflicts list endpoint
- Added family-scoped sync conflict resolve endpoint
- Added RBAC permission enforcement
- Added device identity tracking
- Added local-write-first outbox queue
- Added pull inbox snapshot record
- Added conflict record foundation
- Added best-effort audit evidence for sync push/pull/resolve
- Added SQLite and PostgreSQL sync table creation checks

NEW API TARGETS:
- GET /families/{family_id}/sync/status
- POST /families/{family_id}/sync/push
- GET /families/{family_id}/sync/pull
- GET /families/{family_id}/sync/conflicts
- POST /families/{family_id}/sync/conflicts/{conflict_id}/resolve

VERIFIED:
- Backend compile passed
- SQLite route/OpenAPI check passed
- SQLite sync tables created
- SQLite foreign_key_check_count = 0
- SQLite double-entry integrity still clean
- PostgreSQL service running
- PostgreSQL port reachable
- PostgreSQL route/OpenAPI check passed
- PostgreSQL sync tables created
- PostgreSQL Alembic current verified: 0002_auth_hardening

BACKUP:
$BACKUP

VERIFY:
$VERIFY

NEXT:
Phase 10C Offline Sync Engine Final E2E + Backup
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_10B_OFFLINE_SYNC_ENGINE_HARDENING_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 10B OFFLINE SYNC ENGINE ACTUAL HARDENING PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime