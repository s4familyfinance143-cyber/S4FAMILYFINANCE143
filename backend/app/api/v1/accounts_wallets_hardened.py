
# === PHASE 6B ACCOUNTS / WALLETS HARDENING START ===
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
    _phase5b_require_family_member,
    _phase5b_require_permission,
    _phase5b_is_owner,
    _phase5b_has_permission,
    _phase5b_user_id,
)
from app.core.timeutil import utc_now

router = APIRouter(tags=["Phase 6B Accounts / Wallets Hardened"])

ACCOUNTS_TABLE = "accounts"


class Phase6BAccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    account_type: str | None = Field(default="CASH", max_length=80)
    currency: str | None = Field(default="BDT", max_length=12)
    opening_balance: Decimal | float | int | str | None = Field(default=0)
    description: str | None = Field(default=None, max_length=500)


class Phase6BAccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    account_type: str | None = Field(default=None, max_length=80)
    currency: str | None = Field(default=None, max_length=12)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = Field(default=None)


class Phase6BWalletCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    currency: str | None = Field(default="BDT", max_length=12)
    opening_balance: Decimal | float | int | str | None = Field(default=0)
    description: str | None = Field(default=None, max_length=500)


class Phase6BWalletUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    currency: str | None = Field(default=None, max_length=12)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = Field(default=None)


def _phase6b_now() -> str:
    return utc_now().isoformat()


def _phase6b_to_decimal(value: Any) -> str:
    """Return DB-bind-safe numeric string.

    SQLite text() binding does not accept Decimal objects directly.
    PostgreSQL NUMERIC also accepts numeric strings safely.
    """
    if value is None or value == "":
        return "0"
    return format(Decimal(str(value)), "f")


def _phase6b_jsonable(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = str(v) if "UUID" in type(v).__name__.upper() else v
    return out


def _phase6b_table_exists(db: Session, table_name: str) -> bool:
    return table_name in inspect(db.get_bind()).get_table_names()


def _phase6b_columns(db: Session, table_name: str = ACCOUNTS_TABLE) -> list[dict[str, Any]]:
    return list(inspect(db.get_bind()).get_columns(table_name))


def _phase6b_column_names(db: Session, table_name: str = ACCOUNTS_TABLE) -> list[str]:
    return [c["name"] for c in _phase6b_columns(db, table_name)]


def _phase6b_require_accounts_table(db: Session) -> list[str]:
    if not _phase6b_table_exists(db, ACCOUNTS_TABLE):
        raise HTTPException(status_code=500, detail="accounts table missing")
    cols = _phase6b_column_names(db, ACCOUNTS_TABLE)
    if "id" not in cols or "family_id" not in cols:
        raise HTTPException(status_code=500, detail="accounts table must have id and family_id")
    return cols


def _phase6b_pick(cols: list[str], candidates: list[str]) -> str | None:
    for c in candidates:
        if c in cols:
            return c
    return None


def _phase6b_type_col(cols: list[str]) -> str | None:
    return _phase6b_pick(cols, ["account_type", "type", "category", "account_category", "kind"])


def _phase6b_name_col(cols: list[str]) -> str | None:
    return _phase6b_pick(cols, ["name", "account_name", "wallet_name", "title", "display_name"])


def _phase6b_balance_cols(cols: list[str]) -> list[str]:
    return [c for c in ["opening_balance", "current_balance", "available_balance", "balance"] if c in cols]


def _phase6b_description_col(cols: list[str]) -> str | None:
    return _phase6b_pick(cols, ["description", "notes", "note", "memo"])


def _phase6b_status_col(cols: list[str]) -> str | None:
    return _phase6b_pick(cols, ["status", "state"])


def _phase6b_created_member_col(cols: list[str]) -> str | None:
    return _phase6b_pick(cols, ["created_by_member_id", "owner_member_id", "member_id"])


def _phase6b_created_user_col(cols: list[str]) -> str | None:
    return _phase6b_pick(cols, ["created_by_user_id", "user_id", "created_by"])


def _phase6b_col_type_name(col: dict[str, Any]) -> str:
    return str(col.get("type", "")).upper()


def _phase6b_required_default(col: dict[str, Any], kind: str) -> Any:
    name = col["name"]
    t = _phase6b_col_type_name(col)
    now = _phase6b_now()

    if name.endswith("_at") or "DATE" in t or "TIME" in t:
        return now
    if "BOOL" in t:
        return False
    if "INT" in t:
        return 0
    if "NUM" in t or "DEC" in t or "REAL" in t or "FLOAT" in t:
        return 0
    if name in ["status", "state"]:
        return "ACTIVE"
    if name in ["account_type", "type", "category", "account_category", "kind"]:
        return kind
    if "code" in name:
        return f"{kind[:3].upper()}-{uuid4().hex[:10].upper()}"
    if "slug" in name:
        return f"{kind.lower()}-{uuid4().hex[:10]}"
    return ""


def _phase6b_insert_account(
    db: Session,
    family_id: str,
    current_member: dict[str, Any],
    current_user: Any,
    payload: Any,
    kind: str,
) -> dict[str, Any]:
    cols_info = _phase6b_columns(db)
    cols = [c["name"] for c in cols_info]
    values: dict[str, Any] = {}

    values["id"] = str(uuid4())
    values["family_id"] = family_id

    name_col = _phase6b_name_col(cols)
    if name_col:
        values[name_col] = payload.name.strip()

    type_col = _phase6b_type_col(cols)
    if type_col:
        values[type_col] = "WALLET" if kind == "WALLET" else (payload.account_type or "CASH")

    if "currency" in cols:
        values["currency"] = (payload.currency or "BDT").upper()

    opening_balance = _phase6b_to_decimal(getattr(payload, "opening_balance", 0))
    for bcol in _phase6b_balance_cols(cols):
        values[bcol] = opening_balance

    desc_col = _phase6b_description_col(cols)
    if desc_col and getattr(payload, "description", None) is not None:
        values[desc_col] = payload.description

    if "is_active" in cols:
        values["is_active"] = True
    if "is_deleted" in cols:
        values["is_deleted"] = False

    status_col = _phase6b_status_col(cols)
    if status_col:
        values[status_col] = "ACTIVE"

    created_member_col = _phase6b_created_member_col(cols)
    if created_member_col:
        values[created_member_col] = current_member.get("id")

    created_user_col = _phase6b_created_user_col(cols)
    if created_user_col:
        values[created_user_col] = _phase5b_user_id(current_user)

    if "created_at" in cols:
        values["created_at"] = _phase6b_now()
    if "updated_at" in cols:
        values["updated_at"] = _phase6b_now()
    if "row_version" in cols:
        values["row_version"] = 1

    # Fill any remaining NOT NULL column that has no DB default.
    for col in cols_info:
        cname = col["name"]
        if cname in values:
            continue
        if cname == "deleted_at":
            continue
        if col.get("nullable") is False and col.get("default") is None:
            values[cname] = _phase6b_required_default(col, kind)

    insert_cols = list(values.keys())
    insert_sql = f"""
        INSERT INTO {ACCOUNTS_TABLE} ({", ".join(insert_cols)})
        VALUES ({", ".join([":" + c for c in insert_cols])})
    """
    db.execute(text(insert_sql), values)
    db.commit()

    return _phase6b_get_account_row(db, family_id, values["id"])


def _phase6b_base_where(cols: list[str]) -> str:
    where = "family_id = :family_id"
    if "deleted_at" in cols:
        where += " AND deleted_at IS NULL"
    if "is_deleted" in cols:
        where += " AND (is_deleted = 0 OR is_deleted IS NULL)"
    return where


def _phase6b_kind_filter(cols: list[str], kind: str) -> str:
    type_col = _phase6b_type_col(cols)
    if not type_col:
        return ""
    if kind == "WALLET":
        return f" AND UPPER(CAST({type_col} AS TEXT)) = 'WALLET'"
    if kind == "ACCOUNT":
        return f" AND (UPPER(CAST({type_col} AS TEXT)) != 'WALLET' OR {type_col} IS NULL)"
    return ""


def _phase6b_get_account_row(db: Session, family_id: str, account_id: str) -> dict[str, Any]:
    cols = _phase6b_require_accounts_table(db)
    where = _phase6b_base_where(cols)

    row = db.execute(
        text(f"""
            SELECT *
            FROM {ACCOUNTS_TABLE}
            WHERE id = :account_id
              AND {where}
            LIMIT 1
        """),
        {"account_id": account_id, "family_id": family_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Account or wallet not found")

    return dict(row)


def _phase6b_list_accounts(db: Session, family_id: str, kind: str) -> list[dict[str, Any]]:
    cols = _phase6b_require_accounts_table(db)
    where = _phase6b_base_where(cols) + _phase6b_kind_filter(cols, kind)

    order_col = "created_at" if "created_at" in cols else "id"

    rows = db.execute(
        text(f"""
            SELECT *
            FROM {ACCOUNTS_TABLE}
            WHERE {where}
            ORDER BY {order_col} DESC
        """),
        {"family_id": family_id},
    ).mappings().all()

    return [dict(r) for r in rows]


def _phase6b_update_account_row(
    db: Session,
    family_id: str,
    account_id: str,
    payload: Any,
    kind: str,
) -> dict[str, Any]:
    cols = _phase6b_require_accounts_table(db)
    existing = _phase6b_get_account_row(db, family_id, account_id)

    updates: dict[str, Any] = {}

    name_col = _phase6b_name_col(cols)
    if name_col and getattr(payload, "name", None) is not None:
        updates[name_col] = payload.name.strip()

    type_col = _phase6b_type_col(cols)
    if type_col and kind == "ACCOUNT" and getattr(payload, "account_type", None) is not None:
        updates[type_col] = payload.account_type
    if type_col and kind == "WALLET":
        updates[type_col] = "WALLET"

    if "currency" in cols and getattr(payload, "currency", None) is not None:
        updates["currency"] = payload.currency.upper()

    desc_col = _phase6b_description_col(cols)
    if desc_col and getattr(payload, "description", None) is not None:
        updates[desc_col] = payload.description

    if "is_active" in cols and getattr(payload, "is_active", None) is not None:
        updates["is_active"] = bool(payload.is_active)

    status_col = _phase6b_status_col(cols)
    if status_col and getattr(payload, "is_active", None) is not None:
        updates[status_col] = "ACTIVE" if payload.is_active else "INACTIVE"

    if "updated_at" in cols:
        updates["updated_at"] = _phase6b_now()
    if "row_version" in cols:
        old_version = existing.get("row_version") or 1
        try:
            updates["row_version"] = int(old_version) + 1
        except Exception:
            updates["row_version"] = 2

    # Balance is intentionally not updated here. Future Phase 7 double-entry
    # transaction ledger must be responsible for balance movement.

    if not updates:
        return existing

    db.execute(
        text(f"""
            UPDATE {ACCOUNTS_TABLE}
            SET {", ".join([c + " = :" + c for c in updates.keys()])}
            WHERE id = :account_id
              AND family_id = :family_id
        """),
        {**updates, "account_id": account_id, "family_id": family_id},
    )
    db.commit()

    return _phase6b_get_account_row(db, family_id, account_id)


def _phase6b_assert_kind(row: dict[str, Any], cols: list[str], kind: str) -> None:
    type_col = _phase6b_type_col(cols)
    if not type_col:
        return
    value = str(row.get(type_col) or "").upper()
    if kind == "WALLET" and value != "WALLET":
        raise HTTPException(status_code=404, detail="Wallet not found")
    if kind == "ACCOUNT" and value == "WALLET":
        raise HTTPException(status_code=404, detail="Account not found")


@router.post("/families/{family_id}/accounts")
def phase6b_create_account(
    family_id: str,
    payload: Phase6BAccountCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    member = _phase5b_require_permission(db, family_id, current_user, "accounts.create")
    row = _phase6b_insert_account(db, family_id, member, current_user, payload, "ACCOUNT")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "ACCOUNT",
        "account": _phase6b_jsonable(row),
    }


@router.get("/families/{family_id}/accounts")
def phase6b_list_accounts(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "accounts.view_all")
    rows = _phase6b_list_accounts(db, family_id, "ACCOUNT")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "ACCOUNT",
        "count": len(rows),
        "accounts": [_phase6b_jsonable(r) for r in rows],
    }


@router.get("/families/{family_id}/accounts/{account_id}")
def phase6b_get_account(
    family_id: str,
    account_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "accounts.view_all")
    row = _phase6b_get_account_row(db, family_id, account_id)
    cols = _phase6b_require_accounts_table(db)
    _phase6b_assert_kind(row, cols, "ACCOUNT")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "ACCOUNT",
        "account": _phase6b_jsonable(row),
    }


@router.patch("/families/{family_id}/accounts/{account_id}")
def phase6b_update_account(
    family_id: str,
    account_id: str,
    payload: Phase6BAccountUpdate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "accounts.update")
    row = _phase6b_get_account_row(db, family_id, account_id)
    cols = _phase6b_require_accounts_table(db)
    _phase6b_assert_kind(row, cols, "ACCOUNT")
    updated = _phase6b_update_account_row(db, family_id, account_id, payload, "ACCOUNT")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "ACCOUNT",
        "account": _phase6b_jsonable(updated),
    }


@router.post("/families/{family_id}/wallets")
def phase6b_create_wallet(
    family_id: str,
    payload: Phase6BWalletCreate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    member = _phase5b_require_permission(db, family_id, current_user, "wallets.create")
    row = _phase6b_insert_account(db, family_id, member, current_user, payload, "WALLET")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "WALLET",
        "wallet": _phase6b_jsonable(row),
    }


@router.get("/families/{family_id}/wallets")
def phase6b_list_wallets(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "wallets.view_all")
    rows = _phase6b_list_accounts(db, family_id, "WALLET")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "WALLET",
        "count": len(rows),
        "wallets": [_phase6b_jsonable(r) for r in rows],
    }


@router.get("/families/{family_id}/wallets/{wallet_id}")
def phase6b_get_wallet(
    family_id: str,
    wallet_id: str,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "wallets.view_all")
    row = _phase6b_get_account_row(db, family_id, wallet_id)
    cols = _phase6b_require_accounts_table(db)
    _phase6b_assert_kind(row, cols, "WALLET")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "WALLET",
        "wallet": _phase6b_jsonable(row),
    }


@router.patch("/families/{family_id}/wallets/{wallet_id}")
def phase6b_update_wallet(
    family_id: str,
    wallet_id: str,
    payload: Phase6BWalletUpdate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    _phase5b_require_permission(db, family_id, current_user, "wallets.update")
    row = _phase6b_get_account_row(db, family_id, wallet_id)
    cols = _phase6b_require_accounts_table(db)
    _phase6b_assert_kind(row, cols, "WALLET")
    updated = _phase6b_update_account_row(db, family_id, wallet_id, payload, "WALLET")
    return {
        "hardened": True,
        "phase": "6B",
        "type": "WALLET",
        "wallet": _phase6b_jsonable(updated),
    }

# === PHASE 6B ACCOUNTS / WALLETS HARDENING END ===
