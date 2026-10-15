from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import DateTime, bindparam, inspect, text
from sqlalchemy.exc import IntegrityError
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
        _phase5b_has_permission,
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

    def _phase5b_has_permission(*args, **kwargs):
        return False


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
    # Money columns are Numeric(18, 4): serialize as exact strings, never float.
    if isinstance(value, Decimal):
        return str(value)
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


def _phase10b_numeric_columns(table_name: str) -> set[str]:
    from sqlalchemy import Numeric

    from app.models.base import Base

    table = Base.metadata.tables.get(table_name)
    if table is None:
        return set()
    return {c.name for c in table.columns if isinstance(c.type, Numeric)}


def _phase10b_money_as_text(table_name: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Raw text() SELECTs skip ORM type processing: SQLite hands Numeric(18, 4)
    money back as float. Return those columns as exact decimal strings."""
    numeric = _phase10b_numeric_columns(table_name)
    if not numeric:
        return rows
    for row in rows:
        for col in numeric:
            value = row.get(col)
            if value is not None and not isinstance(value, str):
                row[col] = str(Decimal(str(value)))
    return rows


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


def _phase10b_parse_since(since_token: Optional[str]) -> Optional[datetime]:
    """Parse a pull cursor into a naive-UTC datetime.

    The cursor used to be compared as text: CAST(updated_at AS TEXT) gives
    "2026-10-15 06:30:00" (space) while the token is "2026-10-15T06:29:59Z"
    ("T"), and " " < "T", so every row changed later on the same calendar day
    as the token was skipped -- and never pulled afterwards either.
    """
    if not since_token:
        return None
    raw = str(since_token).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="since_token must be an ISO-8601 timestamp")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _phase10b_token_from(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = _phase10b_parse_since(str(value))
        except HTTPException:
            return None
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat(timespec="microseconds") + "Z"


def _phase10b_truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes"}
    return bool(value)


def _phase10b_hidden_wallet_ids(member: Any, account_rows: list[dict[str, Any]]) -> set[str]:
    """Account ids this member may not see (other members' private wallets).

    Same rule as GET /accounts/coa/{family_id}: accounts.can_view_wallet, plus
    system chart-of-accounts rows stay visible.
    """
    from app.api.v1.accounts import can_view_wallet

    if not isinstance(member, dict):
        return set()
    viewer = SimpleNamespace(id=member.get("id"), role=member.get("role") or member.get("member_role"))
    hidden: set[str] = set()
    for row in account_rows:
        if _phase10b_truthy(row.get("is_system")):
            continue
        acc = SimpleNamespace(
            owner_member_id=row.get("owner_member_id"),
            is_shared_family=_phase10b_truthy(row.get("is_shared_family")),
            is_owner_wallet=_phase10b_truthy(row.get("is_owner_wallet")),
        )
        if not can_view_wallet(viewer, acc):
            hidden.add(str(row.get("id")))
    return hidden


# Wallet references a pushed payload may carry (money moves of every entity type).
_PHASE10B_WALLET_REF_KEYS = (
    "account_id",
    "from_account_id",
    "to_account_id",
    "source_account_id",
    "target_account_id",
    "wallet_account_id",
    "payment_account_id",
    "wallet_id",
    "from_wallet_id",
    "to_wallet_id",
    "source_wallet_id",
    "target_wallet_id",
)


def _phase10b_required_permission(entity_type: str, operation: str, payload: Any) -> str:
    """REST permission key that guards the same write (sync must not be a bypass)."""
    op = str(operation or "").upper()
    data = payload if isinstance(payload, dict) else {}
    if entity_type == "transactions":
        if op == "DELETE":
            return "transaction.delete"
        tx_type = str(data.get("transaction_type") or data.get("type") or "").strip().upper()
        return {
            "INCOME": "income.create",
            "EXPENSE": "expense.create",
            "TRANSFER": "transfer.create",
        }.get(tx_type, "transaction.create")
    if entity_type == "accounts":
        if op in {"CREATE", "UPSERT"}:
            return "wallet.create"
        if op == "DELETE":
            return "wallet.delete"
        return "wallet.update"
    if entity_type == "savings_goals":
        return {"DEPOSIT": "savings.deposit", "WITHDRAW": "savings.withdraw"}.get(op, "savings.create")
    if entity_type == "loans":
        return "loan.payment" if op == "PAYMENT" else "loan.create"
    if entity_type == "loan_payments":
        return "loan.payment"
    if entity_type == "financial_goals":
        return {
            "CONTRIBUTE": "goal.contribute",
            "DEPOSIT": "goal.contribute",
            "WITHDRAW": "goal.withdraw",
        }.get(op, "goal.create")
    if entity_type == "recurring_transactions":
        return "recurring.create"
    if entity_type in {"budgets", "zakat_records"}:
        return "budget.create"
    # grocery_*, architecture tables (investments, documents, ...) and
    # phase15/16 items are guarded by transaction.create on their REST routes.
    return "transaction.create"


def _phase10b_reject_reason(
    db: Session,
    family_id: str,
    member: Any,
    entity_type: str,
    operation: str,
    entity_id: Any,
    payload: Any,
) -> Optional[str]:
    """None when the caller may apply this change, else the rejection message."""
    required = _phase10b_required_permission(entity_type, operation, payload)
    if not _phase5b_has_permission(db, family_id, member, required):
        return f"Permission denied: {required}"

    from app.api.v1.transactions import can_use_wallet
    from app.models.account import Account
    from app.models.family_member import FamilyMember

    if entity_type == "accounts" and entity_id and str(operation).upper() not in {"CREATE", "UPSERT"}:
        target = (
            db.query(Account)
            .filter(Account.id == str(entity_id), Account.family_id == family_id)
            .first()
        )
        if target is not None and target.is_system:
            return "System accounts cannot be edited"

    data = payload if isinstance(payload, dict) else {}
    wallet_ids = {str(data[k]) for k in _PHASE10B_WALLET_REF_KEYS if data.get(k)}
    if not wallet_ids:
        return None
    member_row = db.get(FamilyMember, str(member.get("id"))) if isinstance(member, dict) else None
    if member_row is None:
        return "Not a member of this family"
    wallets = (
        db.query(Account)
        .filter(Account.family_id == family_id, Account.id.in_(sorted(wallet_ids)))
        .all()
    )
    for wallet in wallets:
        if wallet.is_system:
            continue
        if not can_use_wallet(member_row, wallet):
            return "You do not have permission to use this wallet"
    return None


def _phase10b_device_key(current_user: Any, device_id: Any) -> str:
    """Server-side device key: "<user_id>:<client device id>".

    Clients send one fixed id per app ("mobile-expo", "web-dashboard"), so
    every member of a family used to share one sync_state row, one outbox
    namespace and one conflict device -- one member's push/pull bookkeeping
    overwrote another's. Scoping by the authenticated user keeps each
    member's sync state their own without any client change.
    """
    raw = str(device_id or "default-device").strip()[:80] or "default-device"
    user_id = str(getattr(current_user, "id", "") or "")
    return f"{user_id}:{raw}" if user_id else raw


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

    since = _phase10b_parse_since(since_token)
    if since is not None and updated_col:
        filters.append(f"{_phase10b_q(updated_col)} >= :since_token")
        params["since_token"] = since

    order_col = updated_col or id_col or family_col
    order_sql = _phase10b_q(order_col)
    if id_col and id_col != order_col:
        order_sql += f", {_phase10b_q(id_col)}"

    stmt = text(
        f"SELECT * FROM {_phase10b_q(table_name)} "
        f"WHERE {' AND '.join(filters)} "
        f"ORDER BY {order_sql} ASC "
        f"LIMIT :limit"
    )
    if "since_token" in params:
        stmt = stmt.bindparams(bindparam("since_token", type_=DateTime()))
    return _phase10b_money_as_text(table_name, _phase10b_rows(db.execute(stmt, params)))


def _phase10b_tombstones(
    db: Session,
    table_name: str,
    family_id: str,
    since_token: Optional[str],
    limit: int,
) -> list[str]:
    """Ids soft-deleted since the cursor, so other devices can drop them."""
    since = _phase10b_parse_since(since_token)
    if since is None or table_name not in _phase10b_tables(db):
        return []
    cols = _phase10b_columns(db, table_name)
    family_col = _phase10b_first(cols, ["family_id"])
    deleted_col = _phase10b_first(cols, ["deleted_at"])
    id_col = _phase10b_first(cols, ["id"])
    if not family_col or not deleted_col or not id_col:
        return []
    stmt = text(
        f"SELECT {_phase10b_q(id_col)} FROM {_phase10b_q(table_name)} "
        f"WHERE {_phase10b_q(family_col)} = :family_id "
        f"AND {_phase10b_q(deleted_col)} IS NOT NULL "
        f"AND {_phase10b_q(deleted_col)} >= :since_token "
        f"ORDER BY {_phase10b_q(deleted_col)} ASC "
        f"LIMIT :limit"
    ).bindparams(bindparam("since_token", type_=DateTime()))
    return [
        str(r[0])
        for r in db.execute(stmt, {"family_id": family_id, "since_token": since, "limit": limit}).fetchall()
    ]


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

    since = _phase10b_parse_since(since_token)
    if since is not None and updated_col:
        filters.append(f"tl.{_phase10b_q(updated_col)} >= :since_token")
        params["since_token"] = since

    order_col = f"tl.{_phase10b_q(updated_col)}" if updated_col else f"tl.{_phase10b_q(line_tx)}"

    stmt = text(
        f"SELECT tl.* FROM transaction_lines tl "
        f"JOIN transactions t ON t.{_phase10b_q(tx_id)} = tl.{_phase10b_q(line_tx)} "
        f"WHERE {' AND '.join(filters)} "
        f"ORDER BY {order_col} ASC "
        f"LIMIT :limit"
    )
    if "since_token" in params:
        stmt = stmt.bindparams(bindparam("since_token", type_=DateTime()))
    return _phase10b_money_as_text("transaction_lines", _phase10b_rows(db.execute(stmt, params)))


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

    client_device_id = device_id
    device_id = _phase10b_device_key(current_user, client_device_id)
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
        "device_id": client_device_id,
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
    member = _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.push", "sync.manage", "transactions.create", "accounts.update"],
    )

    _phase10b_ensure_sync_tables(db)

    client_device_id = str(body.get("device_id") or "default-device")
    device_id = _phase10b_device_key(current_user, client_device_id)
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
    accepted_changes: list[tuple[str, str, Any]] = []
    conflict_ids: list[str] = []
    rejected: list[dict[str, Any]] = []

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

        entity_id = change.get("entity_id")
        payload = change.get("payload", change)
        client_change_id = str(change.get("client_change_id") or "")

        # client_change_id was captured but never checked before inserting a
        # fresh outbox row every time — so a client retry after a dropped
        # response (network drop, app killed mid-request) re-submitted the
        # same batch and created a second outbox row for it. Most entity
        # applicators only dedupe via an entity-level client_request_id (and
        # only for money-move types that always post a Transaction); plain
        # CREATE of budgets/savings_goals/financial_goals/investments/etc.
        # had no protection at all, so a retried push created a genuine
        # duplicate row. Reusing the existing outbox row for a repeated
        # client_change_id makes this idempotent: process_pending_outbox
        # only reprocesses PENDING rows, so an already-SYNCED repeat is a
        # correct no-op, and a still-PENDING one is retried as normal.
        existing_id = None
        if client_change_id:
            existing_id = db.execute(
                text(
                    "SELECT id FROM sync_outbox "
                    "WHERE family_id = :family_id AND device_id = :device_id "
                    "AND client_change_id = :client_change_id LIMIT 1"
                ),
                {"family_id": family_id, "device_id": device_id, "client_change_id": client_change_id},
            ).scalar()

        # The gate above only proves the caller may sync at all. Each change
        # must also pass the permission (and wallet-access rule) of the REST
        # route that performs the same write -- otherwise a MEMBER could push
        # e.g. accounts DELETE on the owner's wallet, loans CREATE, or an
        # EXPENSE from another member's private wallet.
        if not existing_id:
            reason = _phase10b_reject_reason(
                db, family_id, member, entity_type, operation, entity_id, payload
            )
            if reason:
                rejected_id = str(uuid.uuid4())
                db.execute(
                    text(
                        "INSERT INTO sync_outbox "
                        "(id, family_id, device_id, client_change_id, entity_type, entity_id, operation, payload, status, error_message, created_at, updated_at) "
                        "VALUES (:id, :family_id, :device_id, :client_change_id, :entity_type, :entity_id, :operation, :payload, 'FAILED', :error, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ),
                    {
                        "id": rejected_id,
                        "family_id": family_id,
                        "device_id": device_id,
                        # Rejected rows never claim the idempotency key: a
                        # later push of the same change (e.g. after the owner
                        # grants the permission) must still be able to apply.
                        "client_change_id": None,
                        "entity_type": entity_type,
                        "entity_id": str(entity_id) if entity_id is not None else None,
                        "operation": operation,
                        "payload": _phase10b_json_text(payload),
                        "error": reason,
                    },
                )
                rejected.append({"outbox_id": rejected_id, "error": reason})
                continue

        if existing_id:
            outbox_id = str(existing_id)
        else:
            outbox_id = str(uuid.uuid4())
            # Two pushes of the same change can race past the lookup above;
            # the unique index uq_sync_outbox_change (migration 0026) then
            # rejects the second insert -- reuse the winner's row instead.
            savepoint = db.begin_nested()
            try:
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
                        "client_change_id": client_change_id or None,
                        "entity_type": entity_type,
                        "entity_id": str(entity_id) if entity_id is not None else None,
                        "operation": operation,
                        "payload": _phase10b_json_text(payload),
                    },
                )
                savepoint.commit()
            except IntegrityError:
                savepoint.rollback()
                winner = db.execute(
                    text(
                        "SELECT id FROM sync_outbox "
                        "WHERE family_id = :family_id AND device_id = :device_id "
                        "AND client_change_id = :client_change_id LIMIT 1"
                    ),
                    {"family_id": family_id, "device_id": device_id, "client_change_id": client_change_id},
                ).scalar()
                if not winner:
                    raise
                outbox_id = str(winner)
        accepted_ids.append(outbox_id)
        accepted_changes.append((entity_type, operation, entity_id))

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

    # The gate returned the caller's ACTIVE member row; the generic lookup can
    # pick an older removed row for a user who left and re-joined.
    member_id = (
        str(member["id"])
        if isinstance(member, dict) and member.get("id")
        else _phase10b_get_current_member_id(db, family_id, current_user)
    )
    if accepted_ids:
        apply_result = process_pending_outbox(
            db,
            family_id=family_id,
            device_id=device_id,
            member_id=member_id,
            outbox_ids=accepted_ids,
        )
    else:
        # process_pending_outbox treats an empty id list as "every PENDING row
        # of this device" -- device_id is client-supplied (often the shared
        # "default-device"), so that would apply other members' queued changes
        # as if this caller had made them.
        apply_result = {
            "processed": 0,
            "synced": [],
            "synced_count": 0,
            "failed": [],
            "failed_count": 0,
            "conflict_ids": [],
            "conflict_count": 0,
            "conflicted_outbox_ids": [],
        }
    conflict_ids.extend(apply_result.get("conflict_ids") or [])
    if apply_result.get("synced_count") or apply_result.get("conflict_count"):
        # Live update for the rest of the family (sent after the commit below).
        from app.services.family_realtime import queue_family_event

        for changed_type, changed_op, changed_id in accepted_changes:
            queue_family_event(
                db,
                family_id,
                entity_type=changed_type,
                action=f"SYNC_{changed_op}",
                entity_id=str(changed_id) if changed_id else None,
                actor_member_id=member_id,
            )
    if rejected:
        apply_result["failed"] = list(apply_result.get("failed") or []) + rejected
        apply_result["failed_count"] = int(apply_result.get("failed_count") or 0) + len(rejected)

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
            device_fingerprint=client_device_id,
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
        "device_id": client_device_id,
        "accepted_count": len(accepted_ids),
        "accepted_outbox_ids": accepted_ids,
        "rejected_count": len(rejected),
        "rejected": rejected,
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
    member = _phase10b_require_any_permission(
        db,
        family_id,
        current_user,
        ["sync.pull", "sync.manage", "reports.view", "accounts.view_all"],
    )

    client_device_id = device_id
    device_id = _phase10b_device_key(current_user, client_device_id)
    _phase10b_register_device(db, family_id, device_id)

    # Taken before reading, so a row committed while this pull runs is
    # returned by the next pull instead of falling between two cursors.
    pull_started_token = _phase10b_now_token()
    _phase10b_parse_since(since_token)  # 422 on a malformed cursor

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
        "grocery_lists": _phase10b_family_rows(db, "grocery_lists", family_id, since_token, limit),
        "grocery_items": _phase10b_family_rows(db, "grocery_items", family_id, since_token, limit),
        "grocery_vendors": _phase10b_family_rows(db, "grocery_vendors", family_id, since_token, limit),
        # The gate above accepts "reports.view"/"accounts.view_all" (i.e.
        # report.read, held even by VIEWER) or "sync.pull" (aliased to
        # dashboard.read, also VIEWER-held) -- but audit_logs specifically
        # requires audit.read, which is in
        # permission_service.PROTECTED_OWNER_PERMISSIONS (Owner/Admin only,
        # non-overridable by design). Dumping it unconditionally here let
        # any VIEWER pull the family's full audit trail through this
        # generic multi-table sync payload, bypassing that restriction
        # entirely (same bug class fixed in audit_trail_hardened.py and
        # reports_audit_integration_hardened.py, but via data exposure
        # rather than the permission-list check itself).
        "audit_logs": (
            _phase10b_family_rows(db, "audit_logs", family_id, since_token, limit)
            if _phase5b_has_permission(db, family_id, member, "audit.read")
            else []
        ),
        # These entity_types were pushable (sync_apply.ALLOWED_ENTITY_TYPES)
        # but missing here entirely, so a change made on one device could
        # push successfully yet never appear on any other device pulling —
        # multi-device sync was silently one-way for all of them.
        # transaction_tags is intentionally still excluded: it has no
        # family_id column of its own (only transaction_id + tag_id), so it
        # needs a join like transaction_lines gets, not the generic helper.
        "zakat_records": _phase10b_family_rows(db, "zakat_records", family_id, since_token, limit),
        "phase15_items": _phase10b_family_rows(db, "phase15_items", family_id, since_token, limit),
        "phase16_items": _phase10b_family_rows(db, "phase16_items", family_id, since_token, limit),
        "investments": _phase10b_family_rows(db, "investments", family_id, since_token, limit),
        "health_expenses": _phase10b_family_rows(db, "health_expenses", family_id, since_token, limit),
        "vehicle_expenses": _phase10b_family_rows(db, "vehicle_expenses", family_id, since_token, limit),
        "education_funds": _phase10b_family_rows(db, "education_funds", family_id, since_token, limit),
        "properties": _phase10b_family_rows(db, "properties", family_id, since_token, limit),
        "subscriptions": _phase10b_family_rows(db, "subscriptions", family_id, since_token, limit),
        "documents": _phase10b_family_rows(db, "documents", family_id, since_token, limit),
        "tags": _phase10b_family_rows(db, "tags", family_id, since_token, limit),
        "loan_payments": _phase10b_family_rows(db, "loan_payments", family_id, since_token, limit),
    }

    # Other members' private wallets (and their journal lines) are hidden
    # from non-owners on every REST list; sync must not be the side door.
    hidden_wallets = _phase10b_hidden_wallet_ids(member, server_changes["accounts"])
    if hidden_wallets:
        server_changes["accounts"] = [
            r for r in server_changes["accounts"] if str(r.get("id")) not in hidden_wallets
        ]
        server_changes["transaction_lines"] = [
            r for r in server_changes["transaction_lines"] if str(r.get("account_id")) not in hidden_wallets
        ]

    tombstones: dict[str, list[str]] = {}
    if since_token:
        for table_name in server_changes:
            if table_name in {"transaction_lines", "audit_logs"}:
                continue
            ids = _phase10b_tombstones(db, table_name, family_id, since_token, limit)
            if table_name == "accounts":
                ids = [i for i in ids if i not in hidden_wallets]
            if ids:
                tombstones[table_name] = ids

    # A table that filled `limit` rows has more after its last row: hand back
    # that row's timestamp as the cursor so the rest is pulled next time
    # (clients upsert by id, so the overlap is harmless). Otherwise the cursor
    # is the moment this pull started.
    sync_token = pull_started_token
    has_more = False
    for rows in server_changes.values():
        if len(rows) < limit or not rows:
            continue
        last = rows[-1].get("updated_at") or rows[-1].get("created_at")
        last_token = _phase10b_token_from(last)
        if last_token and last_token != since_token:
            has_more = True
            if _phase10b_parse_since(last_token) < _phase10b_parse_since(sync_token):
                sync_token = last_token

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
        "device_id": client_device_id,
        "since_token": since_token,
        "sync_token": sync_token,
        "change_counts": counts,
        "has_more": has_more,
        "tombstones": tombstones,
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
    device_id = (
        _phase10b_device_key(current_user, body.get("device_id"))
        if body.get("device_id")
        else str(existing.get("device_id") or "default-device")
    )

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
