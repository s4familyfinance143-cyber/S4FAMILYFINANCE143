
# === PHASE 7B DOUBLE-ENTRY TRANSACTIONS HARDENING START ===
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.api.v1.family_governance_hardened import (
    get_db,
    get_current_user,
    _phase5b_require_permission,
    _phase5b_user_id,
)
from app.core.timeutil import utc_now

router = APIRouter(tags=["Phase 7B Double-Entry Transactions Hardened"])

TRANSACTIONS_TABLE = "transactions"
LINES_TABLE = "transaction_lines"
ACCOUNTS_TABLE = "accounts"


class Phase7BTransactionLine(BaseModel):
    account_id: str
    debit: Decimal | int | float | str | None = Field(default=0)
    credit: Decimal | int | float | str | None = Field(default=0)
    description: str | None = Field(default=None, max_length=500)


class Phase7BTransactionCreate(BaseModel):
    transaction_date: str | None = None
    description: str | None = Field(default=None, max_length=500)
    reference: str | None = Field(default=None, max_length=160)
    lines: list[Phase7BTransactionLine] = Field(..., min_length=2)


def _phase7b_now() -> str:
    return utc_now().isoformat()


def _phase7b_money(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _phase7b_bind_money(value: Any) -> str:
    return format(_phase7b_money(value), "f")


def _phase7b_jsonable(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = str(v) if "UUID" in type(v).__name__.upper() else v
    return out


def _phase7b_table_exists(db: Session, table_name: str) -> bool:
    return table_name in inspect(db.get_bind()).get_table_names()


def _phase7b_columns_info(db: Session, table_name: str) -> list[dict[str, Any]]:
    if not _phase7b_table_exists(db, table_name):
        raise HTTPException(status_code=500, detail=f"{table_name} table missing")
    return list(inspect(db.get_bind()).get_columns(table_name))


def _phase7b_cols(db: Session, table_name: str) -> list[str]:
    return [c["name"] for c in _phase7b_columns_info(db, table_name)]


def _phase7b_pick(cols: list[str], candidates: list[str]) -> str | None:
    for c in candidates:
        if c in cols:
            return c
    return None


def _phase7b_tx_required(db: Session) -> tuple[list[str], list[str]]:
    tx_cols = _phase7b_cols(db, TRANSACTIONS_TABLE)
    line_cols = _phase7b_cols(db, LINES_TABLE)

    for required in ["id", "family_id"]:
        if required not in tx_cols:
            raise HTTPException(status_code=500, detail=f"transactions.{required} missing")

    for required in ["id", "transaction_id", "account_id", "debit", "credit"]:
        if required not in line_cols:
            raise HTTPException(status_code=500, detail=f"transaction_lines.{required} missing")

    return tx_cols, line_cols


def _phase7b_account_cols(db: Session) -> list[str]:
    cols = _phase7b_cols(db, ACCOUNTS_TABLE)
    if "id" not in cols or "family_id" not in cols:
        raise HTTPException(status_code=500, detail="accounts table must have id and family_id")
    return cols


def _phase7b_base_where(cols: list[str], alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    where = f"{prefix}family_id = :family_id"
    if "deleted_at" in cols:
        where += f" AND {prefix}deleted_at IS NULL"
    if "is_deleted" in cols:
        where += f" AND ({prefix}is_deleted = 0 OR {prefix}is_deleted IS NULL)"
    return where


def _phase7b_account_row(db: Session, family_id: str, account_id: str) -> dict[str, Any]:
    cols = _phase7b_account_cols(db)
    where = _phase7b_base_where(cols)

    row = db.execute(
        text(f"""
            SELECT *
            FROM {ACCOUNTS_TABLE}
            WHERE id = :account_id
              AND {where}
            LIMIT 1
        """),
        {"family_id": family_id, "account_id": account_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=422, detail=f"Invalid or cross-family account_id: {account_id}")

    if "is_active" in cols and row.get("is_active") in [False, 0, "0"]:
        raise HTTPException(status_code=422, detail=f"Inactive account_id: {account_id}")

    return dict(row)


def _phase7b_validate_lines(db: Session, family_id: str, lines: list[Phase7BTransactionLine]) -> tuple[Decimal, Decimal]:
    if len(lines) < 2:
        raise HTTPException(status_code=422, detail="Double-entry transaction requires at least 2 lines")

    debit_total = Decimal("0.00")
    credit_total = Decimal("0.00")
    seen_positive = 0

    for line in lines:
        _phase7b_account_row(db, family_id, line.account_id)

        debit = _phase7b_money(line.debit)
        credit = _phase7b_money(line.credit)

        if debit < 0 or credit < 0:
            raise HTTPException(status_code=422, detail="Debit/Credit cannot be negative")

        if debit > 0 and credit > 0:
            raise HTTPException(status_code=422, detail="A line cannot have both debit and credit")

        if debit == 0 and credit == 0:
            raise HTTPException(status_code=422, detail="A line must have debit or credit amount")

        if debit > 0 or credit > 0:
            seen_positive += 1

        debit_total += debit
        credit_total += credit

    if seen_positive < 2:
        raise HTTPException(status_code=422, detail="Double-entry transaction needs at least 2 posting lines")

    if debit_total != credit_total:
        raise HTTPException(status_code=422, detail=f"Unbalanced transaction: debit={debit_total} credit={credit_total}")

    return debit_total, credit_total


def _phase7b_col_type_name(col: dict[str, Any]) -> str:
    return str(col.get("type", "")).upper()


def _phase7b_required_default(col: dict[str, Any], prefix: str = "TX") -> Any:
    name = col["name"]
    t = _phase7b_col_type_name(col)

    if name.endswith("_at") or "DATE" in t or "TIME" in t:
        return _phase7b_now()
    if "BOOL" in t:
        return False
    if "INT" in t:
        return 0
    if "NUM" in t or "DEC" in t or "REAL" in t or "FLOAT" in t:
        return "0"
    if name in ["status", "state"]:
        return "POSTED"
    if "code" in name or "number" in name:
        return f"{prefix}-{uuid4().hex[:10].upper()}"
    if "slug" in name:
        return f"{prefix.lower()}-{uuid4().hex[:10]}"
    return ""


def _phase7b_fill_required_defaults(db: Session, table_name: str, values: dict[str, Any], prefix: str) -> dict[str, Any]:
    for col in _phase7b_columns_info(db, table_name):
        cname = col["name"]
        if cname in values:
            continue
        if cname == "deleted_at":
            continue
        if col.get("nullable") is False and col.get("default") is None:
            if cname.endswith("_id"):
                raise HTTPException(
                    status_code=500,
                    detail=f"Required FK column not mapped: {table_name}.{cname}",
                )
            values[cname] = _phase7b_required_default(col, prefix)
    return values


def _phase7b_tx_description_col(cols: list[str]) -> str | None:
    return _phase7b_pick(cols, ["description", "memo", "note", "notes", "narration"])


def _phase7b_tx_reference_col(cols: list[str]) -> str | None:
    return _phase7b_pick(cols, ["reference", "reference_no", "ref_no", "external_ref", "document_no"])


def _phase7b_tx_status_col(cols: list[str]) -> str | None:
    return _phase7b_pick(cols, ["status", "state"])


def _phase7b_tx_date_col(cols: list[str]) -> str | None:
    return _phase7b_pick(cols, ["transaction_date", "txn_date", "date", "posted_at"])


def _phase7b_tx_total_col(cols: list[str]) -> str | None:
    return _phase7b_pick(cols, ["amount", "total_amount", "transaction_amount", "net_amount"])


def _phase7b_line_description_col(cols: list[str]) -> str | None:
    return _phase7b_pick(cols, ["description", "memo", "note", "notes", "narration"])


def _phase7b_insert_transaction(
    db: Session,
    family_id: str,
    current_member: dict[str, Any],
    current_user: Any,
    payload: Phase7BTransactionCreate,
) -> dict[str, Any]:
    tx_cols, line_cols = _phase7b_tx_required(db)
    debit_total, credit_total = _phase7b_validate_lines(db, family_id, payload.lines)

    tx_id = str(uuid4())
    now = _phase7b_now()

    tx_values: dict[str, Any] = {
        "id": tx_id,
        "family_id": family_id,
    }

    current_member_id = current_member.get("id")
    current_user_id = _phase5b_user_id(current_user)

    for member_col in [
        "created_by_member_id",
        "updated_by_member_id",
        "posted_by_member_id",
        "approved_by_member_id",
        "owner_member_id",
        "member_id",
        "created_member_id",
    ]:
        if member_col in tx_cols and current_member_id:
            tx_values[member_col] = current_member_id

    for user_col in [
        "created_by_user_id",
        "updated_by_user_id",
        "posted_by_user_id",
        "approved_by_user_id",
        "user_id",
        "created_by",
        "updated_by",
        "posted_by",
    ]:
        if user_col in tx_cols and current_user_id:
            tx_values[user_col] = current_user_id

    desc_col = _phase7b_tx_description_col(tx_cols)
    if desc_col:
        tx_values[desc_col] = payload.description or "Double-entry transaction"

    ref_col = _phase7b_tx_reference_col(tx_cols)
    if ref_col:
        tx_values[ref_col] = payload.reference or f"TX-{uuid4().hex[:10].upper()}"

    status_col = _phase7b_tx_status_col(tx_cols)
    if status_col:
        tx_values[status_col] = "POSTED"

    date_col = _phase7b_tx_date_col(tx_cols)
    if date_col:
        tx_values[date_col] = payload.transaction_date or now

    total_col = _phase7b_tx_total_col(tx_cols)
    if total_col:
        tx_values[total_col] = _phase7b_bind_money(debit_total)

    if "created_by_user_id" in tx_cols:
        tx_values["created_by_user_id"] = _phase5b_user_id(current_user)
    if "created_by" in tx_cols:
        tx_values["created_by"] = _phase5b_user_id(current_user)
    if "posted_by_user_id" in tx_cols:
        tx_values["posted_by_user_id"] = _phase5b_user_id(current_user)
    if "posted_by" in tx_cols:
        tx_values["posted_by"] = _phase5b_user_id(current_user)

    if "is_locked" in tx_cols:
        tx_values["is_locked"] = True
    if "is_posted" in tx_cols:
        tx_values["is_posted"] = True
    if "is_deleted" in tx_cols:
        tx_values["is_deleted"] = False
    if "created_at" in tx_cols:
        tx_values["created_at"] = now
    if "updated_at" in tx_cols:
        tx_values["updated_at"] = now
    if "posted_at" in tx_cols:
        tx_values["posted_at"] = now
    if "row_version" in tx_cols:
        tx_values["row_version"] = 1

    tx_values = _phase7b_fill_required_defaults(db, TRANSACTIONS_TABLE, tx_values, "TX")
    tx_insert_cols = list(tx_values.keys())

    db.execute(
        text(f"""
            INSERT INTO {TRANSACTIONS_TABLE} ({", ".join(tx_insert_cols)})
            VALUES ({", ".join([":" + c for c in tx_insert_cols])})
        """),
        tx_values,
    )

    line_desc_col = _phase7b_line_description_col(line_cols)

    for idx, line in enumerate(payload.lines, start=1):
        line_values: dict[str, Any] = {
            "id": str(uuid4()),
            "transaction_id": tx_id,
            "account_id": line.account_id,
            "debit": _phase7b_bind_money(line.debit),
            "credit": _phase7b_bind_money(line.credit),
        }

        for member_col in [
            "created_by_member_id",
            "updated_by_member_id",
            "owner_member_id",
            "member_id",
            "created_member_id",
        ]:
            if member_col in line_cols and current_member_id:
                line_values[member_col] = current_member_id

        for user_col in [
            "created_by_user_id",
            "updated_by_user_id",
            "user_id",
            "created_by",
            "updated_by",
        ]:
            if user_col in line_cols and current_user_id:
                line_values[user_col] = current_user_id

        if "family_id" in line_cols:
            line_values["family_id"] = family_id
        if "line_no" in line_cols:
            line_values["line_no"] = idx
        if "sort_order" in line_cols:
            line_values["sort_order"] = idx
        if line_desc_col:
            line_values[line_desc_col] = line.description or payload.description or ""
        if "created_at" in line_cols:
            line_values["created_at"] = now
        if "updated_at" in line_cols:
            line_values["updated_at"] = now
        if "is_deleted" in line_cols:
            line_values["is_deleted"] = False

        line_values = _phase7b_fill_required_defaults(db, LINES_TABLE, line_values, "TL")
        line_insert_cols = list(line_values.keys())

        db.execute(
            text(f"""
                INSERT INTO {LINES_TABLE} ({", ".join(line_insert_cols)})
                VALUES ({", ".join([":" + c for c in line_insert_cols])})
            """),
            line_values,
        )

    # Apply ledger balance updates (architecture: journal moves CoA balances)
    from app.models.account import Account
    from app.services.accounting_service import _apply_line_to_account

    for line in payload.lines:
        account = (
            db.query(Account)
            .filter(
                Account.id == line.account_id,
                Account.family_id == family_id,
                Account.deleted_at.is_(None),
            )
            .with_for_update()
            .first()
        )
        if account:
            _apply_line_to_account(
                account,
                _phase7b_money(line.debit),
                _phase7b_money(line.credit),
            )

    db.commit()
    return _phase7b_get_transaction_row(db, family_id, tx_id)


def _phase7b_get_transaction_row(db: Session, family_id: str, transaction_id: str) -> dict[str, Any]:
    tx_cols, line_cols = _phase7b_tx_required(db)
    where = _phase7b_base_where(tx_cols)

    row = db.execute(
        text(f"""
            SELECT *
            FROM {TRANSACTIONS_TABLE}
            WHERE id = :transaction_id
              AND {where}
            LIMIT 1
        """),
        {"family_id": family_id, "transaction_id": transaction_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")

    return dict(row)


def _phase7b_get_lines(db: Session, transaction_id: str) -> list[dict[str, Any]]:
    line_cols = _phase7b_cols(db, LINES_TABLE)
    order_col = "line_no" if "line_no" in line_cols else ("sort_order" if "sort_order" in line_cols else "id")

    where = "transaction_id = :transaction_id"
    if "deleted_at" in line_cols:
        where += " AND deleted_at IS NULL"
    if "is_deleted" in line_cols:
        where += " AND (is_deleted = 0 OR is_deleted IS NULL)"

    rows = db.execute(
        text(f"""
            SELECT *
            FROM {LINES_TABLE}
            WHERE {where}
            ORDER BY {order_col}
        """),
        {"transaction_id": transaction_id},
    ).mappings().all()

    return [dict(r) for r in rows]


def _phase7b_transaction_with_lines(db: Session, family_id: str, transaction_id: str) -> dict[str, Any]:
    tx = _phase7b_get_transaction_row(db, family_id, transaction_id)
    lines = _phase7b_get_lines(db, transaction_id)

    debit_total = sum((_phase7b_money(r.get("debit")) for r in lines), Decimal("0.00"))
    credit_total = sum((_phase7b_money(r.get("credit")) for r in lines), Decimal("0.00"))

    return {
        "transaction": _phase7b_jsonable(tx),
        "lines": [_phase7b_jsonable(r) for r in lines],
        "line_count": len(lines),
        "debit_total": str(debit_total),
        "credit_total": str(credit_total),
        "balanced": debit_total == credit_total and len(lines) >= 2,
    }


def _phase7b_list_transactions(db: Session, family_id: str) -> list[dict[str, Any]]:
    tx_cols, _ = _phase7b_tx_required(db)
    where = _phase7b_base_where(tx_cols)
    order_col = "created_at" if "created_at" in tx_cols else "id"

    rows = db.execute(
        text(f"""
            SELECT *
            FROM {TRANSACTIONS_TABLE}
            WHERE {where}
            ORDER BY {order_col} DESC
            LIMIT 200
        """),
        {"family_id": family_id},
    ).mappings().all()

    return [dict(r) for r in rows]


@router.post("/families/{family_id}/transactions")
def phase7b_create_transaction(
    family_id: str,
    payload: Phase7BTransactionCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    current_member = _phase5b_require_permission(db, family_id, current_user, "transactions.create")
    row = _phase7b_insert_transaction(db, family_id, current_member, current_user, payload)
    full = _phase7b_transaction_with_lines(db, family_id, row["id"])
    return {
        "hardened": True,
        "phase": "7B",
        "status": "POSTED",
        **full,
    }


@router.get("/families/{family_id}/transactions")
def phase7b_list_transactions(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "transactions.view_all")
    rows = _phase7b_list_transactions(db, family_id)
    return {
        "hardened": True,
        "phase": "7B",
        "count": len(rows),
        "transactions": [_phase7b_jsonable(r) for r in rows],
    }


@router.get("/families/{family_id}/transactions/{transaction_id}")
def phase7b_get_transaction(
    family_id: str,
    transaction_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "transactions.view_all")
    full = _phase7b_transaction_with_lines(db, family_id, transaction_id)
    return {
        "hardened": True,
        "phase": "7B",
        **full,
    }

# === PHASE 7B DOUBLE-ENTRY TRANSACTIONS HARDENING END ===
