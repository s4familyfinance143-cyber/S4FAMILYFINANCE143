from __future__ import annotations

import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.timeutil import utc_now
from app.models.account import Account

try:
    from app.api.v1.family_governance_hardened import (
        _phase5b_get_current_user,
        _phase5b_require_permission,
    )
except Exception as import_error:  # pragma: no cover
    _PHASE8B_IMPORT_ERROR = import_error

    def _phase5b_get_current_user():
        raise HTTPException(
            status_code=500,
            detail=f"RBAC dependency import failed: {_PHASE8B_IMPORT_ERROR}",
        )

    def _phase5b_require_permission(*args, **kwargs):
        raise HTTPException(
            status_code=500,
            detail=f"RBAC permission dependency import failed: {_PHASE8B_IMPORT_ERROR}",
        )


router = APIRouter(tags=["Phase 8B Reports Audit Integration"])


def _phase8b_q(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _phase8b_tables(db: Session) -> set[str]:
    return set(inspect(db.bind).get_table_names())


def _phase8b_columns(db: Session, table_name: str) -> dict[str, Any]:
    if table_name not in _phase8b_tables(db):
        return {}
    return {c["name"]: c for c in inspect(db.bind).get_columns(table_name)}


def _phase8b_first(columns: dict[str, Any], names: list[str]) -> Optional[str]:
    for name in names:
        if name in columns:
            return name
    lowered = {c.lower(): c for c in columns}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def _phase8b_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    if isinstance(value, dict):
        return {k: _phase8b_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_phase8b_json(v) for v in value]
    return value


def _phase8b_rows(result) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in result.fetchall()]


def _phase8b_require_any_permission(
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


def _phase8b_date_filters(
    tx_columns: dict[str, Any],
    start_date: Optional[str],
    end_date: Optional[str],
    alias: str = "t",
) -> tuple[list[str], dict[str, Any]]:
    date_col = _phase8b_first(
        tx_columns,
        ["transaction_date", "date", "txn_date", "posted_at", "created_at"],
    )

    filters: list[str] = []
    params: dict[str, Any] = {}

    if date_col and start_date:
        filters.append(f"CAST({alias}.{_phase8b_q(date_col)} AS TEXT) >= :start_date")
        params["start_date"] = start_date

    if date_col and end_date:
        filters.append(f"CAST({alias}.{_phase8b_q(date_col)} AS TEXT) <= :end_date")
        params["end_date"] = end_date

    return filters, params


def _phase8b_status_filter(tx_columns: dict[str, Any], alias: str = "t") -> Optional[str]:
    status_col = _phase8b_first(tx_columns, ["status", "transaction_status", "state"])
    if not status_col:
        return None

    col = f"{alias}.{_phase8b_q(status_col)}"
    return (
        f"({col} IS NULL OR "
        f"UPPER(CAST({col} AS TEXT)) IN "
        f"('POSTED','APPROVED','COMPLETED','COMPLETE','ACTIVE'))"
    )


def _phase8b_valid_transaction_subquery(
    tx_columns: dict[str, Any],
    line_columns: dict[str, Any],
    start_date: Optional[str],
    end_date: Optional[str],
) -> tuple[str, dict[str, Any]]:
    tx_id = _phase8b_first(tx_columns, ["id", "transaction_id"])
    line_tx = _phase8b_first(line_columns, ["transaction_id", "tx_id"])
    debit = _phase8b_first(line_columns, ["debit", "debit_amount"])
    credit = _phase8b_first(line_columns, ["credit", "credit_amount"])

    if not tx_id or not line_tx or not debit or not credit:
        raise HTTPException(status_code=500, detail="Double-entry columns missing for reports")

    filters = ["t." + _phase8b_q("family_id") + " = :family_id"]
    date_filters, params = _phase8b_date_filters(tx_columns, start_date, end_date, "t")
    filters.extend(date_filters)

    status_filter = _phase8b_status_filter(tx_columns, "t")
    if status_filter:
        filters.append(status_filter)

    where_sql = " AND ".join(filters)

    sql = f"""
        SELECT tl.{_phase8b_q(line_tx)} AS txid
        FROM transaction_lines tl
        JOIN transactions t
          ON t.{_phase8b_q(tx_id)} = tl.{_phase8b_q(line_tx)}
        WHERE {where_sql}
        GROUP BY tl.{_phase8b_q(line_tx)}
        HAVING COUNT(*) >= 2
           AND ROUND(SUM(COALESCE(tl.{_phase8b_q(debit)},0)) - SUM(COALESCE(tl.{_phase8b_q(credit)},0)), 2) = 0
    """

    return sql, params


def _phase8b_insert_audit(
    db: Session,
    family_id: str,
    current_user: Any,
    action: str,
    report_name: str,
    description: str,
) -> None:
    tables = _phase8b_tables(db)
    if "audit_logs" not in tables:
        return

    cols = _phase8b_columns(db, "audit_logs")
    payload: dict[str, Any] = {}

    user_id = getattr(current_user, "id", None) or getattr(current_user, "user_id", None)

    if "id" in cols:
        payload["id"] = str(uuid.uuid4())
    if "family_id" in cols:
        payload["family_id"] = str(family_id)
    if "user_id" in cols and user_id:
        payload["user_id"] = str(user_id)
    if "action" in cols:
        payload["action"] = action
    if "entity_type" in cols:
        payload["entity_type"] = "REPORT"
    if "entity_id" in cols:
        payload["entity_id"] = report_name
    if "description" in cols:
        payload["description"] = description
    if "details" in cols:
        payload["details"] = description
    if "metadata" in cols:
        payload["metadata"] = json.dumps({"report": report_name, "phase": "8B"})
    if "created_at" in cols:
        payload["created_at"] = utc_now()
    if "updated_at" in cols:
        payload["updated_at"] = utc_now()

    if not payload:
        return

    try:
        names = list(payload.keys())
        sql = text(
            f"INSERT INTO audit_logs "
            f"({', '.join(_phase8b_q(n) for n in names)}) "
            f"VALUES ({', '.join(':' + n for n in names)})"
        )
        db.execute(sql, payload)
        db.commit()
    except Exception:
        db.rollback()


@router.get("/families/{family_id}/reports/financial-summary")
def phase8b_financial_summary(
    family_id: str,
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase8b_require_any_permission(
        db,
        family_id,
        current_user,
        ["reports.view", "reports.view_all", "dashboard.view", "accounts.view_all"],
    )

    tables = _phase8b_tables(db)
    for required in ["transactions", "transaction_lines", "accounts"]:
        if required not in tables:
            raise HTTPException(status_code=500, detail=f"Missing required table: {required}")

    tx_cols = _phase8b_columns(db, "transactions")
    line_cols = _phase8b_columns(db, "transaction_lines")
    account_cols = _phase8b_columns(db, "accounts")

    tx_id = _phase8b_first(tx_cols, ["id", "transaction_id"])
    line_tx = _phase8b_first(line_cols, ["transaction_id", "tx_id"])
    line_account = _phase8b_first(line_cols, ["account_id"])
    debit = _phase8b_first(line_cols, ["debit", "debit_amount"])
    credit = _phase8b_first(line_cols, ["credit", "credit_amount"])
    account_id = _phase8b_first(account_cols, ["id", "account_id"])
    account_type = _phase8b_first(account_cols, ["account_type", "type", "category"])

    if not all([tx_id, line_tx, line_account, debit, credit, account_id]):
        raise HTTPException(status_code=500, detail="Required report columns missing")

    valid_tx_sql, params = _phase8b_valid_transaction_subquery(
        tx_cols, line_cols, start_date, end_date
    )
    params["family_id"] = str(family_id)

    summary_sql = text(f"""
        SELECT
            COUNT(DISTINCT t.{_phase8b_q(tx_id)}) AS transaction_count,
            COUNT(tl.{_phase8b_q(line_tx)}) AS line_count,
            COALESCE(SUM(tl.{_phase8b_q(debit)}),0) AS total_debit,
            COALESCE(SUM(tl.{_phase8b_q(credit)}),0) AS total_credit
        FROM transactions t
        JOIN transaction_lines tl
          ON tl.{_phase8b_q(line_tx)} = t.{_phase8b_q(tx_id)}
        WHERE t.{_phase8b_q(tx_id)} IN ({valid_tx_sql})
    """)

    summary = dict(db.execute(summary_sql, params).first()._mapping)

    account_type_rows: list[dict[str, Any]] = []
    if account_type:
        account_type_sql = text(f"""
            SELECT
                UPPER(COALESCE(CAST(a.{_phase8b_q(account_type)} AS TEXT), 'UNKNOWN')) AS account_type,
                COALESCE(SUM(tl.{_phase8b_q(debit)}),0) AS total_debit,
                COALESCE(SUM(tl.{_phase8b_q(credit)}),0) AS total_credit,
                COUNT(DISTINCT t.{_phase8b_q(tx_id)}) AS transaction_count
            FROM transactions t
            JOIN transaction_lines tl
              ON tl.{_phase8b_q(line_tx)} = t.{_phase8b_q(tx_id)}
            JOIN accounts a
              ON a.{_phase8b_q(account_id)} = tl.{_phase8b_q(line_account)}
            WHERE t.{_phase8b_q(tx_id)} IN ({valid_tx_sql})
            GROUP BY UPPER(COALESCE(CAST(a.{_phase8b_q(account_type)} AS TEXT), 'UNKNOWN'))
            ORDER BY account_type
        """)
        account_type_rows = _phase8b_rows(db.execute(account_type_sql, params))

    _phase8b_insert_audit(
        db,
        family_id,
        current_user,
        "REPORT_VIEW",
        "financial-summary",
        "Viewed Phase 8B financial summary report",
    )

    return {
        "status": "ok",
        "family_id": family_id,
        "filters": {"start_date": start_date, "end_date": end_date},
        "integrity": {
            "balanced_only": True,
            "minimum_two_lines": True,
            "family_scoped": True,
        },
        "summary": _phase8b_json(summary),
        "account_type_summary": _phase8b_json(account_type_rows),
    }


@router.get("/families/{family_id}/reports/account-ledger")
def phase8b_account_ledger(
    family_id: str,
    account_id: str = Query(...),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase8b_require_any_permission(
        db,
        family_id,
        current_user,
        ["reports.view", "reports.view_all", "accounts.view_all"],
    )

    tx_cols = _phase8b_columns(db, "transactions")
    line_cols = _phase8b_columns(db, "transaction_lines")
    account_cols = _phase8b_columns(db, "accounts")

    tx_id = _phase8b_first(tx_cols, ["id", "transaction_id"])
    line_tx = _phase8b_first(line_cols, ["transaction_id", "tx_id"])
    line_account = _phase8b_first(line_cols, ["account_id"])
    debit = _phase8b_first(line_cols, ["debit", "debit_amount"])
    credit = _phase8b_first(line_cols, ["credit", "credit_amount"])
    account_pk = _phase8b_first(account_cols, ["id", "account_id"])
    account_name = _phase8b_first(account_cols, ["name", "account_name"])
    tx_date = _phase8b_first(tx_cols, ["transaction_date", "date", "posted_at", "created_at"])
    tx_desc = _phase8b_first(tx_cols, ["description", "memo", "note", "title"])

    if not all([tx_id, line_tx, line_account, debit, credit, account_pk]):
        raise HTTPException(status_code=500, detail="Required ledger columns missing")

    account_check = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.family_id == family_id,
            Account.deleted_at.is_(None),
        )
        .first()
    )

    if not account_check:
        raise HTTPException(status_code=404, detail="Account not found in this family")

    valid_tx_sql, params = _phase8b_valid_transaction_subquery(
        tx_cols, line_cols, start_date, end_date
    )
    params.update({"family_id": family_id, "account_id": account_id, "limit": limit})

    select_date = f"t.{_phase8b_q(tx_date)} AS transaction_date," if tx_date else "NULL AS transaction_date,"
    select_desc = f"t.{_phase8b_q(tx_desc)} AS description," if tx_desc else "NULL AS description,"

    order_col = f"t.{_phase8b_q(tx_date)}" if tx_date else f"t.{_phase8b_q(tx_id)}"

    ledger_sql = text(f"""
        SELECT
            t.{_phase8b_q(tx_id)} AS transaction_id,
            {select_date}
            {select_desc}
            tl.{_phase8b_q(debit)} AS debit,
            tl.{_phase8b_q(credit)} AS credit
        FROM transaction_lines tl
        JOIN transactions t
          ON t.{_phase8b_q(tx_id)} = tl.{_phase8b_q(line_tx)}
        WHERE tl.{_phase8b_q(line_account)} = :account_id
          AND t.{_phase8b_q(tx_id)} IN ({valid_tx_sql})
        ORDER BY {order_col} ASC
        LIMIT :limit
    """)

    rows = _phase8b_rows(db.execute(ledger_sql, params))

    balance = Decimal("0")
    ledger_rows = []
    for row in rows:
        debit_value = Decimal(str(row.get("debit") or 0))
        credit_value = Decimal(str(row.get("credit") or 0))
        balance += debit_value - credit_value
        row["running_balance"] = balance
        ledger_rows.append(row)

    _phase8b_insert_audit(
        db,
        family_id,
        current_user,
        "REPORT_VIEW",
        "account-ledger",
        f"Viewed Phase 8B account ledger report for account {account_id}",
    )

    return {
        "status": "ok",
        "family_id": family_id,
        "account": {
            "id": account_check.id,
            "name": account_check.name,
        },
        "filters": {"start_date": start_date, "end_date": end_date, "limit": limit},
        "rows": _phase8b_json(ledger_rows),
    }


@router.get("/families/{family_id}/reports/wallet-summary")
def phase8b_wallet_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase8b_require_any_permission(
        db,
        family_id,
        current_user,
        ["reports.view", "reports.view_all", "wallets.view_all", "accounts.view_all"],
    )

    account_cols = _phase8b_columns(db, "accounts")

    account_pk = _phase8b_first(account_cols, ["id", "account_id"])
    account_name = _phase8b_first(account_cols, ["name", "account_name"])
    account_type = _phase8b_first(account_cols, ["account_type", "type", "category"])
    currency = _phase8b_first(account_cols, ["currency", "currency_code"])
    opening = _phase8b_first(account_cols, ["opening_balance"])
    current = _phase8b_first(account_cols, ["current_balance", "balance"])
    is_owner_wallet = _phase8b_first(account_cols, ["is_owner_wallet"])
    is_shared_family = _phase8b_first(account_cols, ["is_shared_family"])
    is_active = _phase8b_first(account_cols, ["is_active"])

    if not account_pk:
        raise HTTPException(status_code=500, detail="Account id column missing")

    filters = [f"{_phase8b_q('family_id')} = :family_id"]
    wallet_filters = []

    if account_type:
        wallet_filters.append(f"UPPER(CAST({_phase8b_q(account_type)} AS TEXT)) LIKE '%WALLET%'")
    if is_owner_wallet:
        wallet_filters.append(f"({_phase8b_q(is_owner_wallet)} = 1 OR {_phase8b_q(is_owner_wallet)} = true)")
    if is_shared_family:
        wallet_filters.append(f"({_phase8b_q(is_shared_family)} = 1 OR {_phase8b_q(is_shared_family)} = true)")

    if wallet_filters:
        filters.append("(" + " OR ".join(wallet_filters) + ")")

    if is_active:
        filters.append(f"({_phase8b_q(is_active)} IS NULL OR {_phase8b_q(is_active)} = 1 OR {_phase8b_q(is_active)} = true)")

    where_sql = " AND ".join(filters)

    select_cols = [
        f"{_phase8b_q(account_pk)} AS id",
        f"{_phase8b_q(account_name)} AS name" if account_name else "NULL AS name",
        f"{_phase8b_q(account_type)} AS account_type" if account_type else "NULL AS account_type",
        f"{_phase8b_q(currency)} AS currency" if currency else "NULL AS currency",
        f"{_phase8b_q(opening)} AS opening_balance" if opening else "0 AS opening_balance",
        f"{_phase8b_q(current)} AS current_balance" if current else "0 AS current_balance",
    ]

    rows = _phase8b_rows(
        db.execute(
            text(
                f"SELECT {', '.join(select_cols)} "
                f"FROM accounts "
                f"WHERE {where_sql} "
                f"ORDER BY name"
            ),
            {"family_id": family_id},
        )
    )

    total_balance = sum(Decimal(str(row.get("current_balance") or 0)) for row in rows)

    _phase8b_insert_audit(
        db,
        family_id,
        current_user,
        "REPORT_VIEW",
        "wallet-summary",
        "Viewed Phase 8B wallet summary report",
    )

    return {
        "status": "ok",
        "family_id": family_id,
        "wallet_count": len(rows),
        "total_current_balance": _phase8b_json(total_balance),
        "wallets": _phase8b_json(rows),
    }


@router.get("/families/{family_id}/reports/audit-activity")
def phase8b_audit_activity(
    family_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(_phase5b_get_current_user),
):
    _phase8b_require_any_permission(
        db,
        family_id,
        current_user,
        ["audit.view", "audit.view_all", "reports.view", "reports.view_all"],
    )

    if "audit_logs" not in _phase8b_tables(db):
        return {
            "status": "ok",
            "family_id": family_id,
            "available": False,
            "rows": [],
        }

    cols = _phase8b_columns(db, "audit_logs")
    family_col = _phase8b_first(cols, ["family_id"])
    created_col = _phase8b_first(cols, ["created_at", "timestamp", "created_on"])
    action_col = _phase8b_first(cols, ["action", "event", "event_type"])
    entity_type_col = _phase8b_first(cols, ["entity_type", "model", "table_name"])
    description_col = _phase8b_first(cols, ["description", "details", "message"])
    metadata_col = _phase8b_first(cols, ["metadata", "meta", "data"])

    if not family_col:
        raise HTTPException(status_code=500, detail="audit_logs family_id column missing")

    select_cols = [
        f"{_phase8b_q(action_col)} AS action" if action_col else "NULL AS action",
        f"{_phase8b_q(entity_type_col)} AS entity_type" if entity_type_col else "NULL AS entity_type",
        f"{_phase8b_q(description_col)} AS description" if description_col else "NULL AS description",
        f"{_phase8b_q(metadata_col)} AS metadata" if metadata_col else "NULL AS metadata",
        f"{_phase8b_q(created_col)} AS created_at" if created_col else "NULL AS created_at",
    ]

    order_sql = f"ORDER BY {_phase8b_q(created_col)} DESC" if created_col else ""

    rows = _phase8b_rows(
        db.execute(
            text(
                f"SELECT {', '.join(select_cols)} "
                f"FROM audit_logs "
                f"WHERE {_phase8b_q(family_col)} = :family_id "
                f"{order_sql} "
                f"LIMIT :limit"
            ),
            {"family_id": family_id, "limit": limit},
        )
    )

    _phase8b_insert_audit(
        db,
        family_id,
        current_user,
        "REPORT_VIEW",
        "audit-activity",
        "Viewed Phase 8B audit activity report",
    )

    return {
        "status": "ok",
        "family_id": family_id,
        "available": True,
        "limit": limit,
        "rows": _phase8b_json(rows),
    }
