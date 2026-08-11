from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.timeutil import utc_now
from app.models.family_member import FamilyMember

try:
    from app.api.v1.family_governance_hardened import (
        _phase5b_get_current_user,
        _phase5b_require_permission,
    )
except Exception as import_error:  # pragma: no cover
    _PHASE9B_IMPORT_ERROR = import_error

    def _phase5b_get_current_user():
        raise HTTPException(
            status_code=500,
            detail=f"RBAC dependency import failed: {_PHASE9B_IMPORT_ERROR}",
        )

    def _phase5b_require_permission(*args, **kwargs):
        raise HTTPException(
            status_code=500,
            detail=f"RBAC permission dependency import failed: {_PHASE9B_IMPORT_ERROR}",
        )


router = APIRouter(tags=["Phase 9B Audit Trail Hardened"])


def _phase9b_q(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _phase9b_tables(db: Session) -> set[str]:
    return set(inspect(db.bind).get_table_names())


def _phase9b_columns(db: Session, table_name: str) -> dict[str, Any]:
    if table_name not in _phase9b_tables(db):
        return {}
    return {c["name"]: c for c in inspect(db.bind).get_columns(table_name)}


def _phase9b_first(columns: dict[str, Any], names: list[str]) -> Optional[str]:
    for name in names:
        if name in columns:
            return name
    lowered = {c.lower(): c for c in columns}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def _phase9b_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    if isinstance(value, dict):
        return {k: _phase9b_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_phase9b_json(v) for v in value]
    return value


def _phase9b_rows(result) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in result.fetchall()]


def _phase9b_require_any_permission(
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


def _phase9b_get_current_member_id(
    db: Session,
    family_id: str,
    current_user: Any,
) -> Optional[str]:
    user_id = getattr(current_user, "id", None) or getattr(current_user, "user_id", None)
    if not user_id:
        return None

    member_id = (
        db.query(FamilyMember.id)
        .filter(
            FamilyMember.family_id == str(family_id),
            FamilyMember.user_id == str(user_id),
        )
        .scalar()
    )
    return str(member_id) if member_id else None


def _phase9b_insert_audit_evidence(
    db: Session,
    family_id: str,
    current_user: Any,
    action_type: str,
    title: str,
    description: str,
    entity_type: str = "AUDIT_TRAIL",
    entity_id: Optional[str] = None,
    severity: str = "INFO",
) -> None:
    if "audit_logs" not in _phase9b_tables(db):
        return

    cols = _phase9b_columns(db, "audit_logs")
    payload: dict[str, Any] = {}

    member_id = _phase9b_get_current_member_id(db, family_id, current_user)

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
    if "details" in cols:
        payload["details"] = description
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
                f"({', '.join(_phase9b_q(n) for n in names)}) "
                f"VALUES ({', '.join(':' + n for n in names)})"
            ),
            payload,
        )
        db.commit()
    except Exception:
        db.rollback()


def _phase9b_audit_columns_or_500(db: Session) -> dict[str, Any]:
    if "audit_logs" not in _phase9b_tables(db):
        raise HTTPException(status_code=500, detail="audit_logs table missing")

    cols = _phase9b_columns(db, "audit_logs")

    family_col = _phase9b_first(cols, ["family_id"])
    if not family_col:
        raise HTTPException(status_code=500, detail="audit_logs family_id column missing")

    return cols


def _phase9b_base_filters(
    cols: dict[str, Any],
    family_id: str,
    action_type: Optional[str] = None,
    entity_type: Optional[str] = None,
    severity: Optional[str] = None,
) -> tuple[list[str], dict[str, Any]]:
    family_col = _phase9b_first(cols, ["family_id"])
    action_col = _phase9b_first(cols, ["action_type", "action"])
    entity_type_col = _phase9b_first(cols, ["entity_type"])
    severity_col = _phase9b_first(cols, ["severity"])
    deleted_col = _phase9b_first(cols, ["deleted_at"])

    filters = [f"{_phase9b_q(family_col)} = :family_id"]
    params: dict[str, Any] = {"family_id": str(family_id)}

    if deleted_col:
        filters.append(f"{_phase9b_q(deleted_col)} IS NULL")

    if action_type and action_col:
        filters.append(f"UPPER(CAST({_phase9b_q(action_col)} AS TEXT)) = UPPER(:action_type)")
        params["action_type"] = str(action_type)

    if entity_type and entity_type_col:
        filters.append(f"UPPER(CAST({_phase9b_q(entity_type_col)} AS TEXT)) = UPPER(:entity_type)")
        params["entity_type"] = str(entity_type)

    if severity and severity_col:
        filters.append(f"UPPER(CAST({_phase9b_q(severity_col)} AS TEXT)) = UPPER(:severity)")
        params["severity"] = str(severity)

    return filters, params


def _phase9b_select_expr(cols: dict[str, Any]) -> str:
    candidates = [
        ("id", ["id"]),
        ("family_id", ["family_id"]),
        ("member_id", ["member_id", "user_id"]),
        ("action_type", ["action_type", "action"]),
        ("entity_type", ["entity_type"]),
        ("entity_id", ["entity_id"]),
        ("title", ["title"]),
        ("description", ["description", "details"]),
        ("severity", ["severity"]),
        ("ip_address", ["ip_address"]),
        ("user_agent", ["user_agent"]),
        ("created_at", ["created_at", "timestamp", "created_on"]),
    ]

    select_parts = []
    for alias, names in candidates:
        col = _phase9b_first(cols, names)
        if col:
            select_parts.append(f"{_phase9b_q(col)} AS {_phase9b_q(alias)}")
        else:
            select_parts.append(f"NULL AS {_phase9b_q(alias)}")

    return ", ".join(select_parts)


@router.get("/families/{family_id}/audit-trail/activity")
def phase9b_audit_trail_activity(
    family_id: str,
    action_type: Optional[str] = Query(default=None),
    entity_type: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase9b_require_any_permission(
        db,
        family_id,
        current_user,
        ["audit.view", "audit.view_all", "reports.view", "reports.view_all"],
    )

    cols = _phase9b_audit_columns_or_500(db)

    filters, params = _phase9b_base_filters(
        cols,
        family_id,
        action_type=action_type,
        entity_type=entity_type,
        severity=severity,
    )
    params["limit"] = limit

    created_col = _phase9b_first(cols, ["created_at", "timestamp", "created_on", "id"])
    order_sql = f"ORDER BY {_phase9b_q(created_col)} DESC" if created_col else ""

    rows = _phase9b_rows(
        db.execute(
            text(
                f"SELECT {_phase9b_select_expr(cols)} "
                f"FROM audit_logs "
                f"WHERE {' AND '.join(filters)} "
                f"{order_sql} "
                f"LIMIT :limit"
            ),
            params,
        )
    )

    _phase9b_insert_audit_evidence(
        db,
        family_id,
        current_user,
        "READ",
        "Audit Trail Activity Viewed",
        "Audit trail activity endpoint viewed",
        "AUDIT_TRAIL",
        None,
    )

    return {
        "status": "ok",
        "family_id": str(family_id),
        "filters": {
            "action_type": action_type,
            "entity_type": entity_type,
            "severity": severity,
            "limit": limit,
        },
        "immutable": True,
        "read_only": True,
        "rows": _phase9b_json(rows),
    }


@router.get("/families/{family_id}/audit-trail/summary")
def phase9b_audit_trail_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase9b_require_any_permission(
        db,
        family_id,
        current_user,
        ["audit.view", "audit.view_all", "reports.view", "reports.view_all"],
    )

    cols = _phase9b_audit_columns_or_500(db)

    family_col = _phase9b_first(cols, ["family_id"])
    action_col = _phase9b_first(cols, ["action_type", "action"])
    entity_type_col = _phase9b_first(cols, ["entity_type"])
    severity_col = _phase9b_first(cols, ["severity"])
    deleted_col = _phase9b_first(cols, ["deleted_at"])

    filters = [f"{_phase9b_q(family_col)} = :family_id"]
    if deleted_col:
        filters.append(f"{_phase9b_q(deleted_col)} IS NULL")

    where_sql = " AND ".join(filters)

    total = db.execute(
        text(f"SELECT COUNT(*) FROM audit_logs WHERE {where_sql}"),
        {"family_id": str(family_id)},
    ).scalar()

    action_summary = []
    if action_col:
        action_summary = _phase9b_rows(
            db.execute(
                text(
                    f"SELECT {_phase9b_q(action_col)} AS action_type, COUNT(*) AS count "
                    f"FROM audit_logs WHERE {where_sql} "
                    f"GROUP BY {_phase9b_q(action_col)} "
                    f"ORDER BY count DESC"
                ),
                {"family_id": str(family_id)},
            )
        )

    entity_summary = []
    if entity_type_col:
        entity_summary = _phase9b_rows(
            db.execute(
                text(
                    f"SELECT {_phase9b_q(entity_type_col)} AS entity_type, COUNT(*) AS count "
                    f"FROM audit_logs WHERE {where_sql} "
                    f"GROUP BY {_phase9b_q(entity_type_col)} "
                    f"ORDER BY count DESC"
                ),
                {"family_id": str(family_id)},
            )
        )

    severity_summary = []
    if severity_col:
        severity_summary = _phase9b_rows(
            db.execute(
                text(
                    f"SELECT {_phase9b_q(severity_col)} AS severity, COUNT(*) AS count "
                    f"FROM audit_logs WHERE {where_sql} "
                    f"GROUP BY {_phase9b_q(severity_col)} "
                    f"ORDER BY count DESC"
                ),
                {"family_id": str(family_id)},
            )
        )

    _phase9b_insert_audit_evidence(
        db,
        family_id,
        current_user,
        "READ",
        "Audit Trail Summary Viewed",
        "Audit trail summary endpoint viewed",
        "AUDIT_TRAIL",
        None,
    )

    return {
        "status": "ok",
        "family_id": str(family_id),
        "total_audit_rows": int(total or 0),
        "immutable": True,
        "read_only": True,
        "by_action_type": _phase9b_json(action_summary),
        "by_entity_type": _phase9b_json(entity_summary),
        "by_severity": _phase9b_json(severity_summary),
    }


@router.get("/families/{family_id}/audit-trail/entity/{entity_type}/{entity_id}")
def phase9b_audit_trail_entity(
    family_id: str,
    entity_type: str,
    entity_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase9b_require_any_permission(
        db,
        family_id,
        current_user,
        ["audit.view", "audit.view_all", "reports.view", "reports.view_all"],
    )

    cols = _phase9b_audit_columns_or_500(db)

    entity_type_col = _phase9b_first(cols, ["entity_type"])
    entity_id_col = _phase9b_first(cols, ["entity_id"])

    if not entity_type_col or not entity_id_col:
        raise HTTPException(
            status_code=500,
            detail="audit_logs entity_type/entity_id columns missing",
        )

    filters, params = _phase9b_base_filters(
        cols,
        family_id,
        entity_type=entity_type,
    )
    filters.append(f"CAST({_phase9b_q(entity_id_col)} AS TEXT) = :entity_id")
    params["entity_id"] = str(entity_id)
    params["limit"] = limit

    created_col = _phase9b_first(cols, ["created_at", "timestamp", "created_on", "id"])
    order_sql = f"ORDER BY {_phase9b_q(created_col)} DESC" if created_col else ""

    rows = _phase9b_rows(
        db.execute(
            text(
                f"SELECT {_phase9b_select_expr(cols)} "
                f"FROM audit_logs "
                f"WHERE {' AND '.join(filters)} "
                f"{order_sql} "
                f"LIMIT :limit"
            ),
            params,
        )
    )

    _phase9b_insert_audit_evidence(
        db,
        family_id,
        current_user,
        "READ",
        "Audit Trail Entity Viewed",
        f"Audit trail entity endpoint viewed for {entity_type}/{entity_id}",
        entity_type,
        entity_id,
    )

    return {
        "status": "ok",
        "family_id": str(family_id),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "limit": limit,
        "immutable": True,
        "read_only": True,
        "rows": _phase9b_json(rows),
    }
