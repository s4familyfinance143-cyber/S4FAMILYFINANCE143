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
from app.core.timeutil import utc_now
from app.services.sync_apply import (
    ALLOWED_ENTITY_TYPES,
    apply_conflict_resolution,
    process_pending_outbox,
)

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
    return utc_now().isoformat(timespec="microseconds") + "Z"


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
        payload["created_at"] = utc_now()
    if "updated_at" in cols:
        payload["updated_at"] = utc_now()

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

    conflicted_outbox = db.execute(
        text(
            "SELECT COUNT(*) FROM sync_outbox "
            "WHERE family_id = :family_id AND status = 'CONFLICT'"
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
        "auto_conflict_detection": True,
        "pending_outbox": int(pending_outbox or 0),
        "conflicted_outbox": int(conflicted_outbox or 0),
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
        if entity_type not in ALLOWED_ENTITY_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"entity_type must be one of: {', '.join(sorted(ALLOWED_ENTITY_TYPES))}",
            )
        if operation not in {
            "CREATE",
            "UPDATE",
            "DELETE",
            "UPSERT",
            "DEPOSIT",
            "WITHDRAW",
            "PAYMENT",
            "CONTRIBUTE",
            "PAUSE",
            "RESUME",
            "CLOSE",
        }:
            raise HTTPException(
                status_code=422,
                detail="operation must be CREATE/UPDATE/DELETE/UPSERT/DEPOSIT/WITHDRAW/PAYMENT/CONTRIBUTE/PAUSE/RESUME/CLOSE",
            )

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
        try:
            from app.services.architecture_system_hooks import enqueue_architecture_sync_queue

            enqueue_architecture_sync_queue(
                db,
                device_id=device_id,
                family_id=family_id,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                action=operation,
                payload=payload,
                legacy_outbox_id=outbox_id,
                status="PENDING",
            )
        except Exception:
            pass
        accepted_ids.append(outbox_id)

        # Client-flagged conflict still recorded; auto conflicts also created during apply.
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

    member_id = _phase10b_get_current_member_id(db, family_id, current_user)
    apply_result = process_pending_outbox(
        db,
        family_id=family_id,
        device_id=device_id,
        member_id=member_id,
        outbox_ids=accepted_ids,
    )
    conflict_ids.extend(apply_result.get("conflict_ids") or [])

    # Mirror final statuses onto architecture sync_queue
    try:
        from app.services.architecture_system_hooks import finalize_architecture_sync_queue

        for oid in apply_result.get("synced") or []:
            finalize_architecture_sync_queue(db, legacy_outbox_id=str(oid), status="DONE")
        for fail in apply_result.get("failed") or []:
            finalize_architecture_sync_queue(
                db,
                legacy_outbox_id=str(fail.get("outbox_id") or ""),
                status="FAILED",
                last_error=str(fail.get("error") or "apply failed"),
            )
        for oid in apply_result.get("conflicted_outbox_ids") or []:
            finalize_architecture_sync_queue(db, legacy_outbox_id=str(oid), status="CONFLICT")
    except Exception:
        pass

    # de-dupe while preserving order
    seen: set[str] = set()
    unique_conflicts: list[str] = []
    for cid in conflict_ids:
        if cid not in seen:
            seen.add(cid)
            unique_conflicts.append(cid)
    conflict_ids = unique_conflicts

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

    try:
        from app.services.architecture_system_hooks import record_sync_log, upsert_device_registry

        failed_n = int(apply_result.get("failed_count") or 0)
        conflict_n = int(apply_result.get("conflict_count") or len(conflict_ids) or 0)
        success = failed_n == 0
        err = None
        if not success:
            err = f"failed={failed_n}; conflicts={conflict_n}"
        elif conflict_n:
            err = f"partial_conflicts={conflict_n}"

        record_sync_log(
            db,
            device_id=device_id,
            family_id=family_id,
            items_synced=int(apply_result.get("synced_count") or len(accepted_ids) or 0),
            success=success,
            error_msg=err,
        )
        upsert_device_registry(
            db,
            user_id=current_user.id,
            device_fingerprint=device_id,
            family_id=family_id,
        )
        db.commit()
    except Exception:
        db.rollback()
        try:
            from app.services.architecture_system_hooks import record_sync_log

            record_sync_log(
                db,
                device_id=device_id,
                family_id=family_id,
                items_synced=0,
                success=False,
                error_msg="sync_log_commit_failed",
            )
            db.commit()
        except Exception:
            db.rollback()

    _phase10b_insert_audit(
        db,
        family_id,
        current_user,
        "SYNC_PUSH",
        "Offline Sync Push",
        f"Accepted {len(accepted_ids)} changes; synced {apply_result.get('synced_count', 0)}; "
        f"conflicts {len(conflict_ids)}",
        "SYNC",
        device_id,
    )

    return {
        "status": "accepted",
        "family_id": family_id,
        "device_id": device_id,
        "accepted_count": len(accepted_ids),
        "accepted_outbox_ids": accepted_ids,
        "applied": apply_result,
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
        "financial_goals": _phase10b_family_rows(db, "financial_goals", family_id, since_token, limit),
        "recurring_transactions": _phase10b_family_rows(db, "recurring_transactions", family_id, since_token, limit),
        "budgets": _phase10b_family_rows(db, "budgets", family_id, since_token, limit),
        "savings_goals": _phase10b_family_rows(db, "savings_goals", family_id, since_token, limit),
        "loans": _phase10b_family_rows(db, "loans", family_id, since_token, limit),
        "audit_logs": _phase10b_family_rows(db, "audit_logs", family_id, since_token, limit),
        "grocery_lists": _phase10b_family_rows(db, "grocery_lists", family_id, since_token, limit),
        "grocery_items": _phase10b_family_rows(db, "grocery_items", family_id, since_token, limit),
        "grocery_vendors": _phase10b_family_rows(db, "grocery_vendors", family_id, since_token, limit),
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

    if str(existing.get("status") or "").upper() == "RESOLVED":
        return {
            "status": "already_resolved",
            "family_id": family_id,
            "conflict_id": conflict_id,
        }

    member_id = _phase10b_get_current_member_id(db, family_id, current_user)
    device_id = str(body.get("device_id") or existing.get("device_id") or "default-device")

    apply_info = apply_conflict_resolution(
        db,
        family_id=family_id,
        device_id=device_id,
        conflict_row=dict(existing),
        body=body if isinstance(body, dict) else {},
        member_id=member_id,
    )

    resolution_body = dict(body) if isinstance(body, dict) else {"raw": body}
    resolution_body["apply"] = apply_info

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
            "resolution_payload": _phase10b_json_text(resolution_body),
            "resolved_by_member_id": member_id,
        },
    )

    # Mark related CONFLICT outbox rows as resolved/synced for this entity
    if existing.get("entity_id"):
        db.execute(
            text(
                "UPDATE sync_outbox SET status = 'SYNCED', error_message = NULL, "
                "synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
                "WHERE family_id = :family_id AND entity_id = :entity_id AND status = 'CONFLICT'"
            ),
            {"family_id": family_id, "entity_id": str(existing["entity_id"])},
        )

    db.commit()

    _phase10b_insert_audit(
        db,
        family_id,
        current_user,
        "SYNC_CONFLICT_RESOLVE",
        "Offline Sync Conflict Resolved",
        f"Sync conflict {conflict_id} resolved via {apply_info.get('strategy')}",
        "SYNC_CONFLICT",
        conflict_id,
    )

    return {
        "status": "resolved",
        "family_id": family_id,
        "conflict_id": conflict_id,
        "apply": apply_info,
    }
