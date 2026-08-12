"""Apply sync outbox rows and conflict resolutions to domain tables."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.grocery import GroceryItem, GroceryList, GroceryVendor
from app.models.sync_tables import SyncConflict, SyncOutbox
from app.services.finance_posting import (
    post_expense_flush,
    post_income_flush,
    post_transfer_flush,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

ALLOWED_ENTITY_TYPES = frozenset(
    {
        "grocery_lists",
        "grocery_items",
        "grocery_vendors",
        "accounts",
        "transactions",
        "zakat_records",
        "phase15_items",
        "phase16_items",
        "budgets",
        "savings_goals",
        "loans",
        "financial_goals",
        "recurring_transactions",
        # Architecture dedicated tables
        "investments",
        "health_expenses",
        "vehicle_expenses",
        "education_funds",
        "properties",
        "subscriptions",
        "documents",
        "tags",
        "transaction_tags",
        "loan_payments",
    }
)

APPLYABLE_NOW = frozenset(ALLOWED_ENTITY_TYPES)


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _load_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except Exception:
        return value


def _dec(value: Any, default: str = "0") -> Decimal:
    try:
        if value is None or value == "":
            return Decimal(default)
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _clean(value: Any) -> Optional[str]:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _server_snapshot(row: Any) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key in (
        "id",
        "family_id",
        "title",
        "name",
        "status",
        "sync_version",
        "updated_at",
        "is_bought",
        "quantity",
        "unit",
        "estimated_price",
        "actual_price",
        "vendor_name",
        "note",
        "currency",
        "budget_amount",
        "grocery_list_id",
        "category",
        "phone",
        "address",
        "is_active",
        "account_type",
        "current_balance",
        "opening_balance",
        "institution_name",
        "mobile_sync_key",
        "last_client_updated_at",
        "transaction_type",
        "amount",
        "description",
        "client_request_id",
    ):
        if hasattr(row, key):
            val = getattr(row, key)
            if isinstance(val, Decimal):
                data[key] = float(val)
            elif hasattr(val, "isoformat"):
                data[key] = val.isoformat()
            else:
                data[key] = val
    return data


def _open_conflict(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    entity_type: str,
    entity_id: Optional[str],
    local_payload: Any,
    remote_payload: Any,
    reason: Optional[str] = None,
    notify: bool = False,
) -> str:
    conflict_id = str(uuid.uuid4())
    local_blob = local_payload
    remote_blob = remote_payload
    if reason:
        if isinstance(local_blob, dict):
            local_blob = {**local_blob, "conflict_reason": reason}
        if isinstance(remote_blob, dict):
            remote_blob = {**remote_blob, "conflict_reason": reason}
    db.add(
        SyncConflict(
            id=conflict_id,
            family_id=family_id,
            device_id=device_id,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            local_payload=_json_text(local_blob),
            remote_payload=_json_text(remote_blob),
            status="OPEN",
            created_at=_utcnow(),
        )
    )
    if notify or reason == "DELETE_EDIT_RACE":
        try:
            from app.api.v1.notifications import create_notification

            create_notification(
                db,
                family_id,
                "SYNC_DELETE_EDIT_CONFLICT" if reason == "DELETE_EDIT_RACE" else "SYNC_CONFLICT",
                "Sync conflict needs review",
                f"{reason or 'CONFLICT'} on {entity_type}:{entity_id}",
                severity="WARN",
            )
        except Exception:
            pass
    return conflict_id


def _set_outbox_status(
    db: Session,
    outbox_id: str,
    status: str,
    error_message: Optional[str] = None,
) -> None:
    row = db.query(SyncOutbox).filter(SyncOutbox.id == outbox_id).first()
    if not row:
        return
    row.status = status
    row.error_message = error_message
    row.updated_at = _utcnow()
    if status == "SYNCED":
        row.synced_at = _utcnow()


def _find_grocery_list(db: Session, family_id: str, entity_id: Optional[str], payload: dict) -> Optional[GroceryList]:
    if entity_id:
        row = (
            db.query(GroceryList)
            .filter(GroceryList.id == entity_id, GroceryList.family_id == family_id)
            .first()
        )
        if row:
            return row
    key = _clean(payload.get("mobile_sync_key"))
    if key:
        return (
            db.query(GroceryList)
            .filter(GroceryList.family_id == family_id, GroceryList.mobile_sync_key == key)
            .first()
        )
    return None


def _find_grocery_item(db: Session, family_id: str, entity_id: Optional[str], payload: dict) -> Optional[GroceryItem]:
    if entity_id:
        row = (
            db.query(GroceryItem)
            .filter(GroceryItem.id == entity_id, GroceryItem.family_id == family_id)
            .first()
        )
        if row:
            return row
    key = _clean(payload.get("mobile_sync_key"))
    if key:
        return (
            db.query(GroceryItem)
            .filter(GroceryItem.family_id == family_id, GroceryItem.mobile_sync_key == key)
            .first()
        )
    return None


def _check_version(row: Any, payload: dict) -> Optional[dict[str, Any]]:
    """Optimistic concurrency. Grocery bought-only updates skip version clash (merge strategy)."""
    # Grocery merge: if client only flips is_bought, accept without version fight
    keys = {k for k in payload.keys() if k not in {"expected_sync_version", "sync_version", "last_client_updated_at", "client_updated_at", "mobile_sync_key", "family_id", "client_change_id", "client_request_id"}}
    if keys and keys.issubset({"is_bought", "bought_by", "actual_price"}):
        return None

    expected = payload.get("expected_sync_version")
    if expected is None:
        expected = payload.get("sync_version")
    if expected is None:
        # Last-write-wins fallback using updated_at / last_client_updated_at
        client_ts = _clean(payload.get("last_client_updated_at") or payload.get("client_updated_at") or payload.get("updated_at"))
        server_ts = None
        if hasattr(row, "last_client_updated_at") and row.last_client_updated_at:
            server_ts = str(row.last_client_updated_at)
        elif hasattr(row, "updated_at") and row.updated_at is not None:
            server_ts = str(row.updated_at)
        if client_ts and server_ts and client_ts < server_ts:
            return {
                "code": "SYNC_CONFLICT",
                "reason": "LAST_WRITE_WINS_SERVER_NEWER",
                "server": _server_snapshot(row),
            }
        return None
    try:
        expected_int = int(expected)
    except Exception:
        return None
    current = int(getattr(row, "sync_version", 0) or 0)
    if current != expected_int:
        return {
            "code": "SYNC_CONFLICT",
            "server_sync_version": current,
            "expected_sync_version": expected_int,
            "server": _server_snapshot(row),
        }
    return None


def _bump(row: Any, payload: dict) -> None:
    row.sync_version = int(getattr(row, "sync_version", 0) or 0) + 1
    row.last_client_updated_at = _clean(payload.get("last_client_updated_at") or payload.get("client_updated_at"))


def _gate_version_or_conflict(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    entity_type: str,
    row: Any,
    payload: dict,
    operation: str,
) -> Optional[dict[str, Any]]:
    """
    None → proceed with apply.
    Result dict → return immediately (SYNCED via LWW, or CONFLICT).
    """
    conflict = _check_version(row, payload)
    if not conflict:
        return None
    # Last-write-wins: server newer → keep server, no OPEN conflict row
    if conflict.get("reason") == "LAST_WRITE_WINS_SERVER_NEWER":
        return {"status": "SYNCED", "entity_id": str(row.id), "note": "lww_server_wins"}
    reason = "DELETE_EDIT_RACE" if operation == "DELETE" else None
    cid = _open_conflict(
        db,
        family_id=family_id,
        device_id=device_id,
        entity_type=entity_type,
        entity_id=str(row.id),
        local_payload=payload,
        remote_payload=conflict.get("server") or _server_snapshot(row),
        reason=reason,
        notify=bool(reason),
    )
    return {"status": "CONFLICT", "conflict_id": cid, "entity_id": str(row.id)}


def _apply_grocery_list(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    row = _find_grocery_list(db, family_id, entity_id, payload)

    if operation == "DELETE":
        if not row:
            return {"status": "SYNCED", "entity_id": entity_id, "note": "already_absent"}
        gated = _gate_version_or_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="grocery_lists",
            row=row,
            payload=payload,
            operation=operation,
        )
        if gated:
            return gated
        db.delete(row)
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation == "UPDATE" and not row and entity_id:
        # Edit arrived after delete → admin review
        cid = _open_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="grocery_lists",
            entity_id=entity_id,
            local_payload=payload,
            remote_payload={"status": "DELETED", "entity_id": entity_id},
            reason="DELETE_EDIT_RACE",
            notify=True,
        )
        return {"status": "CONFLICT", "conflict_id": cid, "entity_id": entity_id}

    if operation in {"CREATE", "UPSERT"} and not row:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for grocery_lists CREATE"}
        title = _clean(payload.get("name")) or _clean(payload.get("title")) or "Grocery List"
        row = GroceryList(
            id=str(entity_id or uuid.uuid4()),
            family_id=family_id,
            created_by_member_id=member_id,
            name=title,
            status=_clean(payload.get("status")) or "OPEN",
            budget_amount=_dec(payload.get("budget_amount")),
            currency=_clean(payload.get("currency")) or "BDT",
            vendor_name=_clean(payload.get("vendor_name")),
            shopping_date=_clean(payload.get("shopping_date")),
            mobile_sync_key=_clean(payload.get("mobile_sync_key")),
            sync_version=1,
            note=_clean(payload.get("note")),
            last_client_updated_at=_clean(payload.get("last_client_updated_at")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if not row:
        return {"status": "FAILED", "error": "grocery_list not found"}

    gated = _gate_version_or_conflict(
        db,
        family_id=family_id,
        device_id=device_id,
        entity_type="grocery_lists",
        row=row,
        payload=payload,
        operation=operation,
    )
    if gated:
        return gated

    if payload.get("name") is not None or payload.get("title") is not None:
        row.name = _clean(payload.get("name")) or _clean(payload.get("title")) or row.name
    if payload.get("status") is not None:
        row.status = _clean(payload.get("status")) or row.status
    if "budget_amount" in payload:
        row.budget_amount = _dec(payload.get("budget_amount"), str(row.budget_amount))
    if payload.get("currency") is not None:
        row.currency = _clean(payload.get("currency")) or row.currency
    if "vendor_name" in payload:
        row.vendor_name = _clean(payload.get("vendor_name"))
    if "shopping_date" in payload:
        row.shopping_date = _clean(payload.get("shopping_date"))
    if "note" in payload:
        row.note = _clean(payload.get("note"))
    if payload.get("mobile_sync_key") and not row.mobile_sync_key:
        row.mobile_sync_key = _clean(payload.get("mobile_sync_key"))
    _bump(row, payload)
    return {"status": "SYNCED", "entity_id": str(row.id)}


def _apply_grocery_item(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    row = _find_grocery_item(db, family_id, entity_id, payload)

    if operation == "DELETE":
        if not row:
            return {"status": "SYNCED", "entity_id": entity_id, "note": "already_absent"}
        gated = _gate_version_or_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="grocery_items",
            row=row,
            payload=payload,
            operation=operation,
        )
        if gated:
            return gated
        db.delete(row)
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation == "UPDATE" and not row and entity_id:
        cid = _open_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="grocery_items",
            entity_id=entity_id,
            local_payload=payload,
            remote_payload={"status": "DELETED", "entity_id": entity_id},
            reason="DELETE_EDIT_RACE",
            notify=True,
        )
        return {"status": "CONFLICT", "conflict_id": cid, "entity_id": entity_id}

    if operation in {"CREATE", "UPSERT"} and not row:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for grocery_items CREATE"}
        list_id = _clean(payload.get("grocery_list_id"))
        if not list_id:
            return {"status": "FAILED", "error": "grocery_list_id required"}
        glist = (
            db.query(GroceryList)
            .filter(GroceryList.id == list_id, GroceryList.family_id == family_id)
            .first()
        )
        if not glist:
            return {"status": "FAILED", "error": "grocery_list not found for item"}
        name = _clean(payload.get("name")) or "Item"
        row = GroceryItem(
            id=str(entity_id or uuid.uuid4()),
            family_id=family_id,
            grocery_list_id=list_id,
            created_by_member_id=member_id,
            name=name,
            category=_clean(payload.get("category")) or "GENERAL",
            quantity=_dec(payload.get("quantity"), "1"),
            unit=_clean(payload.get("unit")) or "pcs",
            estimated_price=_dec(payload.get("estimated_price")),
            actual_price=_dec(payload.get("actual_price")),
            vendor_name=_clean(payload.get("vendor_name")),
            barcode=_clean(payload.get("barcode")),
            mobile_sync_key=_clean(payload.get("mobile_sync_key")),
            sync_version=1,
            is_bought=bool(payload.get("is_bought", False)),
            note=_clean(payload.get("note")),
            last_client_updated_at=_clean(payload.get("last_client_updated_at")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if not row:
        return {"status": "FAILED", "error": "grocery_item not found"}

    conflict = _check_version(row, payload)
    if conflict:
        if conflict.get("reason") == "LAST_WRITE_WINS_SERVER_NEWER":
            return {"status": "SYNCED", "entity_id": str(row.id), "note": "lww_server_wins"}
        # Grocery bought-only already skipped in _check_version; other clashes open conflict
        cid = _open_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="grocery_items",
            entity_id=str(row.id),
            local_payload=payload,
            remote_payload=conflict["server"],
        )
        return {"status": "CONFLICT", "conflict_id": cid, "entity_id": str(row.id)}

    if payload.get("name") is not None:
        row.name = _clean(payload.get("name")) or row.name
    if payload.get("category") is not None:
        row.category = _clean(payload.get("category")) or row.category
    if "quantity" in payload:
        row.quantity = _dec(payload.get("quantity"), str(row.quantity))
    if payload.get("unit") is not None:
        row.unit = _clean(payload.get("unit")) or row.unit
    if "estimated_price" in payload:
        row.estimated_price = _dec(payload.get("estimated_price"), str(row.estimated_price))
    if "actual_price" in payload:
        row.actual_price = _dec(payload.get("actual_price"), str(row.actual_price))
    if "vendor_name" in payload:
        row.vendor_name = _clean(payload.get("vendor_name"))
    if "barcode" in payload:
        row.barcode = _clean(payload.get("barcode"))
    if "note" in payload:
        row.note = _clean(payload.get("note"))
    if "is_bought" in payload:
        row.is_bought = bool(payload.get("is_bought"))
    if payload.get("mobile_sync_key") and not row.mobile_sync_key:
        row.mobile_sync_key = _clean(payload.get("mobile_sync_key"))
    _bump(row, payload)
    return {"status": "SYNCED", "entity_id": str(row.id)}


def _apply_grocery_vendor(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    row = None
    if entity_id:
        row = (
            db.query(GroceryVendor)
            .filter(GroceryVendor.id == entity_id, GroceryVendor.family_id == family_id)
            .first()
        )

    if operation == "DELETE":
        if not row:
            return {"status": "SYNCED", "entity_id": entity_id, "note": "already_absent"}
        db.delete(row)
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation in {"CREATE", "UPSERT"} and not row:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for grocery_vendors CREATE"}
        name = _clean(payload.get("name"))
        if not name:
            return {"status": "FAILED", "error": "vendor name required"}
        row = GroceryVendor(
            id=str(entity_id or uuid.uuid4()),
            family_id=family_id,
            created_by_member_id=member_id,
            name=name,
            phone=_clean(payload.get("phone")),
            address=_clean(payload.get("address")),
            category=_clean(payload.get("category")) or "GENERAL",
            note=_clean(payload.get("note")),
            is_active=bool(payload.get("is_active", True)),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if not row:
        return {"status": "FAILED", "error": "grocery_vendor not found"}

    if payload.get("name") is not None:
        row.name = _clean(payload.get("name")) or row.name
    if "phone" in payload:
        row.phone = _clean(payload.get("phone"))
    if "address" in payload:
        row.address = _clean(payload.get("address"))
    if payload.get("category") is not None:
        row.category = _clean(payload.get("category")) or row.category
    if "note" in payload:
        row.note = _clean(payload.get("note"))
    if "is_active" in payload:
        row.is_active = bool(payload.get("is_active"))
    return {"status": "SYNCED", "entity_id": str(row.id)}


def _apply_account(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str] = None,
    device_id: str = "default-device",
) -> dict[str, Any]:
    """CREATE wallet / UPDATE metadata / soft DELETE. Never rewrite balances on UPDATE."""
    from datetime import datetime, timezone

    if operation == "DELETE":
        if not entity_id:
            return {"status": "FAILED", "error": "entity_id required for accounts DELETE"}
        row = (
            db.query(Account)
            .filter(Account.id == entity_id, Account.family_id == family_id)
            .first()
        )
        if not row:
            return {"status": "SYNCED", "entity_id": entity_id, "note": "already_absent"}
        if row.deleted_at is not None:
            return {"status": "SYNCED", "entity_id": str(row.id), "note": "already_deleted"}
        row.is_active = False
        row.deleted_at = datetime.now(timezone.utc)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation in {"CREATE", "UPSERT"}:
        # Idempotent: client may send predetermined local UUID as entity_id
        if entity_id:
            existing = (
                db.query(Account)
                .filter(Account.id == entity_id, Account.family_id == family_id)
                .first()
            )
            if existing:
                return {"status": "SYNCED", "entity_id": str(existing.id), "note": "idempotent"}

        # CREATE when no entity_id, or UPSERT/CREATE with unknown id
        if operation == "CREATE" or not entity_id or (
            entity_id
            and not db.query(Account)
            .filter(Account.id == entity_id, Account.family_id == family_id)
            .first()
        ):
            if not member_id:
                return {"status": "FAILED", "error": "member_id required for accounts CREATE"}
            # Avoid double-create on duplicate client_request_id in institution_name marker
            client_key = _clean(payload.get("client_request_id") or payload.get("mobile_sync_key"))
            if client_key:
                marker = f"[client_request_id:{client_key}]"
                dup = (
                    db.query(Account)
                    .filter(
                        Account.family_id == family_id,
                        Account.deleted_at.is_(None),
                        Account.institution_name.isnot(None),
                    )
                    .all()
                )
                for cand in dup:
                    if marker in str(cand.institution_name or ""):
                        return {"status": "SYNCED", "entity_id": str(cand.id), "note": "idempotent_client_key"}

            opening = _dec(payload.get("opening_balance"))
            account_type = (_clean(payload.get("account_type")) or "CASH").upper()
            inst = _clean(payload.get("institution_name")) or ""
            if client_key:
                marker = f"[client_request_id:{client_key}]"
                inst = f"{inst} {marker}".strip()
            row = Account(
                id=str(entity_id or uuid.uuid4()),
                family_id=family_id,
                owner_member_id=member_id,
                name=_clean(payload.get("name")) or "Wallet",
                account_type=account_type,
                currency=_clean(payload.get("currency")) or "BDT",
                opening_balance=opening,
                current_balance=opening,
                institution_name=inst or None,
                account_number_masked=_clean(payload.get("account_number_masked")),
                is_shared_family=bool(payload.get("is_shared_family", True)),
                is_owner_wallet=bool(payload.get("is_owner_wallet", False)),
                is_active=True,
            )
            db.add(row)
            db.flush()
            return {"status": "SYNCED", "entity_id": str(row.id)}

    if not entity_id:
        return {"status": "FAILED", "error": "entity_id required for accounts UPDATE"}
    row = (
        db.query(Account)
        .filter(Account.id == entity_id, Account.family_id == family_id)
        .first()
    )
    if not row:
        return {"status": "FAILED", "error": "account not found"}
    if row.deleted_at is not None:
        cid = _open_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="accounts",
            entity_id=entity_id,
            local_payload=payload,
            remote_payload=_server_snapshot(row),
            reason="DELETE_EDIT_RACE",
            notify=True,
        )
        return {"status": "CONFLICT", "conflict_id": cid, "entity_id": entity_id}
    if payload.get("name") is not None:
        row.name = _clean(payload.get("name")) or row.name
    if payload.get("account_type") is not None:
        row.account_type = (_clean(payload.get("account_type")) or row.account_type).upper()
    if "institution_name" in payload:
        row.institution_name = _clean(payload.get("institution_name"))
    if "is_active" in payload:
        row.is_active = bool(payload.get("is_active"))
    if "is_shared_family" in payload:
        row.is_shared_family = bool(payload.get("is_shared_family"))
    return {"status": "SYNCED", "entity_id": str(row.id)}


def _apply_budget(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    try:
        from app.models.budget import Budget
    except Exception:
        return {"status": "FAILED", "error": "Budget model unavailable"}

    if operation == "DELETE" and entity_id:
        row = db.get(Budget, entity_id)
        if row and row.family_id == family_id:
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if operation in {"UPDATE", "UPSERT"} and entity_id:
        row = db.get(Budget, entity_id)
        if not row or row.family_id != family_id:
            return {"status": "FAILED", "error": "budget not found"}
        if payload.get("name") is not None:
            row.name = _clean(payload.get("name")) or row.name
        if "budget_amount" in payload:
            row.budget_amount = _dec(payload.get("budget_amount"), str(row.budget_amount))
        if "note" in payload:
            row.note = _clean(payload.get("note"))
        if payload.get("status") is not None:
            row.status = _clean(payload.get("status")) or row.status
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation in {"CREATE", "UPSERT"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for budgets CREATE"}
        category_id = _clean(payload.get("category_id"))
        if not category_id:
            return {"status": "FAILED", "error": "category_id required for budgets CREATE"}
        row = Budget(
            family_id=family_id,
            created_by_member_id=member_id,
            category_id=category_id,
            name=_clean(payload.get("name")) or "Budget",
            budget_amount=_dec(payload.get("budget_amount") or payload.get("amount")),
            spent_amount=_dec(payload.get("spent_amount")),
            currency=_clean(payload.get("currency")) or "BDT",
            period_type=(_clean(payload.get("period_type")) or "MONTHLY").upper(),
            status=_clean(payload.get("status")) or "ACTIVE",
            note=_clean(payload.get("note")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    return {"status": "FAILED", "error": f"unsupported budget operation {operation}"}


def _apply_savings_goal(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    """CREATE/UPDATE/CLOSE metadata, plus DEPOSIT/WITHDRAW money moves."""
    try:
        from app.models.savings import SavingsGoal
        from app.models.transaction import Transaction
        from app.models.transaction_line import TransactionLine
    except Exception:
        return {"status": "FAILED", "error": "SavingsGoal model unavailable"}

    op = (operation or "").upper()

    if op in {"DEPOSIT", "WITHDRAW"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for savings money move"}
        goal_id = _clean(entity_id or payload.get("savings_goal_id") or payload.get("id"))
        wallet_id = _clean(
            payload.get("wallet_account_id")
            or payload.get("from_account_id")
            or payload.get("to_account_id")
            or payload.get("account_id")
        )
        amount = _dec(payload.get("amount"))
        if not goal_id:
            return {"status": "FAILED", "error": "savings_goal_id required"}
        if not wallet_id:
            return {"status": "FAILED", "error": "wallet_account_id required"}
        if amount <= 0:
            return {"status": "FAILED", "error": "amount must be positive"}

        client_request_id = _clean(payload.get("client_request_id"))
        if client_request_id:
            existing_tx = (
                db.query(Transaction)
                .filter(
                    Transaction.family_id == family_id,
                    Transaction.client_request_id == client_request_id,
                )
                .first()
            )
            if existing_tx and existing_tx.goal_id:
                return {"status": "SYNCED", "entity_id": str(existing_tx.goal_id)}

        goal = db.get(SavingsGoal, goal_id)
        if not goal or goal.family_id != family_id:
            return {"status": "FAILED", "error": "savings goal not found"}
        if str(goal.status or "").upper() != "ACTIVE":
            return {"status": "FAILED", "error": "savings goal is not active"}

        wallet = (
            db.query(Account)
            .filter(Account.id == wallet_id, Account.family_id == family_id, Account.deleted_at.is_(None))
            .first()
        )
        if not wallet:
            return {"status": "FAILED", "error": "wallet not found"}

        currency = (_clean(payload.get("currency")) or goal.currency or wallet.currency or "BDT").upper()
        if str(wallet.currency or "").upper() != currency:
            return {"status": "FAILED", "error": f"Currency mismatch. Wallet currency is {wallet.currency}"}
        if str(goal.currency or "").upper() != currency:
            return {"status": "FAILED", "error": f"Currency mismatch. Savings currency is {goal.currency}"}

        description = _clean(payload.get("description") or payload.get("note"))
        wallet_balance = Decimal(wallet.current_balance or 0)
        goal_balance = Decimal(goal.current_amount or 0)

        if op == "DEPOSIT":
            if wallet_balance < amount:
                return {"status": "FAILED", "error": "insufficient wallet balance for savings deposit"}
            try:
                from app.services import accounting_service

                accounting_service.post_savings_deposit(
                    db,
                    family_id=family_id,
                    member_id=member_id,
                    wallet=wallet,
                    amount=amount,
                    currency=currency,
                    goal_id=goal.id,
                    description=description,
                    client_request_id=client_request_id,
                )
            except Exception as exc:
                return {"status": "FAILED", "error": str(getattr(exc, "detail", None) or exc)}
            goal.current_amount = goal_balance + amount
            db.flush()
            return {"status": "SYNCED", "entity_id": str(goal.id)}

        # WITHDRAW
        if goal_balance < amount:
            return {"status": "FAILED", "error": "insufficient savings balance for withdraw"}
        try:
            from app.services import accounting_service

            accounting_service.post_savings_withdraw(
                db,
                family_id=family_id,
                member_id=member_id,
                wallet=wallet,
                amount=amount,
                currency=currency,
                goal_id=goal.id,
                description=description,
                client_request_id=client_request_id,
            )
        except Exception as exc:
            return {"status": "FAILED", "error": str(getattr(exc, "detail", None) or exc)}
        goal.current_amount = goal_balance - amount
        db.flush()
        return {"status": "SYNCED", "entity_id": str(goal.id)}

    if operation == "DELETE" and entity_id:
        row = db.get(SavingsGoal, entity_id)
        if row and row.family_id == family_id:
            if Decimal(row.current_amount or 0) > 0:
                return {"status": "FAILED", "error": "cannot close savings goal with balance"}
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if operation in {"UPDATE", "UPSERT"} and entity_id:
        row = db.get(SavingsGoal, entity_id)
        if not row or row.family_id != family_id:
            return {"status": "FAILED", "error": "savings goal not found"}
        if payload.get("name") is not None:
            row.name = _clean(payload.get("name")) or row.name
        if "target_amount" in payload:
            target = _dec(payload.get("target_amount"), str(row.target_amount))
            if target < Decimal(row.current_amount or 0):
                return {"status": "FAILED", "error": "target cannot be less than current amount"}
            row.target_amount = target
        if "note" in payload:
            row.note = _clean(payload.get("note"))
        if payload.get("status") is not None:
            row.status = _clean(payload.get("status")) or row.status
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation in {"CREATE", "UPSERT"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for savings_goals CREATE"}
        wallet_id = _clean(payload.get("wallet_account_id") or payload.get("account_id"))
        if not wallet_id:
            return {"status": "FAILED", "error": "wallet_account_id required"}
        wallet = (
            db.query(Account)
            .filter(Account.id == wallet_id, Account.family_id == family_id, Account.deleted_at.is_(None))
            .first()
        )
        if not wallet:
            return {"status": "FAILED", "error": "wallet not found"}
        currency = _clean(payload.get("currency")) or wallet.currency or "BDT"
        row = SavingsGoal(
            family_id=family_id,
            owner_member_id=member_id,
            wallet_account_id=wallet.id,
            name=_clean(payload.get("name")) or "Savings",
            goal_type=(_clean(payload.get("goal_type")) or "GENERAL").upper(),
            target_amount=_dec(payload.get("target_amount")),
            current_amount=Decimal("0"),
            currency=currency,
            status=_clean(payload.get("status")) or "ACTIVE",
            note=_clean(payload.get("note")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    return {"status": "FAILED", "error": f"unsupported savings operation {operation}"}


def _apply_loan(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    """CREATE posts loan + wallet balance; UPDATE/CLOSE metadata; PAYMENT money move."""
    try:
        from app.models.loan import Loan
        from app.models.transaction import Transaction
        from app.models.transaction_line import TransactionLine
    except Exception:
        return {"status": "FAILED", "error": "Loan models unavailable"}

    op = (operation or "").upper()

    if op == "PAYMENT":
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for loan payment"}
        loan_id = _clean(entity_id or payload.get("loan_id") or payload.get("id"))
        wallet_id = _clean(payload.get("wallet_account_id") or payload.get("account_id"))
        amount = _dec(payload.get("amount"))
        if not loan_id:
            return {"status": "FAILED", "error": "loan_id required"}
        if not wallet_id:
            return {"status": "FAILED", "error": "wallet_account_id required"}
        if amount <= 0:
            return {"status": "FAILED", "error": "amount must be positive"}

        client_request_id = _clean(payload.get("client_request_id"))
        if client_request_id:
            existing_tx = (
                db.query(Transaction)
                .filter(
                    Transaction.family_id == family_id,
                    Transaction.client_request_id == client_request_id,
                )
                .first()
            )
            if existing_tx and existing_tx.loan_id:
                return {"status": "SYNCED", "entity_id": str(existing_tx.loan_id)}

        loan = db.get(Loan, loan_id)
        if not loan or loan.family_id != family_id:
            return {"status": "FAILED", "error": "loan not found"}
        if str(loan.status or "").upper() != "ACTIVE":
            return {"status": "FAILED", "error": "loan is not active"}

        wallet = (
            db.query(Account)
            .filter(Account.id == wallet_id, Account.family_id == family_id, Account.deleted_at.is_(None))
            .first()
        )
        if not wallet:
            return {"status": "FAILED", "error": "wallet not found"}

        currency = (_clean(payload.get("currency")) or loan.currency or wallet.currency or "BDT").upper()
        if str(wallet.currency or "").upper() != currency:
            return {"status": "FAILED", "error": f"Currency mismatch. Wallet currency is {wallet.currency}"}
        if str(loan.currency or "").upper() != currency:
            return {"status": "FAILED", "error": f"Currency mismatch. Loan currency is {loan.currency}"}

        remaining = Decimal(loan.remaining_amount or 0)
        if amount > remaining:
            return {"status": "FAILED", "error": "payment cannot exceed remaining loan amount"}

        wallet_balance = Decimal(wallet.current_balance or 0)
        if str(loan.loan_type or "").upper() == "TAKEN" and wallet_balance < amount:
            return {"status": "FAILED", "error": "insufficient wallet balance for loan payment"}

        description = _clean(payload.get("description") or payload.get("note"))
        try:
            from app.services import accounting_service

            accounting_service.post_loan_installment(
                db,
                family_id=family_id,
                member_id=member_id,
                wallet=wallet,
                amount=amount,
                currency=currency,
                loan_type=str(loan.loan_type or ""),
                loan_id=loan.id,
                description=description,
            )
        except Exception as exc:
            return {"status": "FAILED", "error": str(getattr(exc, "detail", None) or exc)}

        loan.paid_amount = Decimal(loan.paid_amount or 0) + amount
        loan.remaining_amount = remaining - amount
        if loan.remaining_amount <= 0:
            loan.remaining_amount = Decimal("0")
            loan.status = "CLOSED"
        db.flush()
        return {"status": "SYNCED", "entity_id": str(loan.id)}

    if operation == "DELETE" and entity_id:
        row = db.get(Loan, entity_id)
        if row and row.family_id == family_id:
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if operation in {"UPDATE", "UPSERT"} and entity_id:
        row = db.get(Loan, entity_id)
        if not row or row.family_id != family_id:
            return {"status": "FAILED", "error": "loan not found"}
        if payload.get("person_name") is not None:
            row.person_name = _clean(payload.get("person_name")) or row.person_name
        if "note" in payload:
            row.note = _clean(payload.get("note"))
        if payload.get("status") is not None:
            row.status = _clean(payload.get("status")) or row.status
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation in {"CREATE", "UPSERT"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for loans CREATE"}
        wallet_id = _clean(payload.get("wallet_account_id") or payload.get("account_id"))
        loan_type = (_clean(payload.get("loan_type")) or "").upper()
        person_name = _clean(payload.get("person_name"))
        amount = _dec(payload.get("principal_amount") or payload.get("amount"))
        if not wallet_id:
            return {"status": "FAILED", "error": "wallet_account_id required"}
        if loan_type not in {"GIVEN", "TAKEN"}:
            return {"status": "FAILED", "error": "loan_type must be GIVEN or TAKEN"}
        if not person_name:
            return {"status": "FAILED", "error": "person_name required"}
        if amount <= 0:
            return {"status": "FAILED", "error": "principal_amount must be positive"}

        client_request_id = _clean(payload.get("client_request_id"))
        if client_request_id:
            existing_tx = (
                db.query(Transaction)
                .filter(
                    Transaction.family_id == family_id,
                    Transaction.client_request_id == client_request_id,
                )
                .first()
            )
            if existing_tx and existing_tx.loan_id:
                return {"status": "SYNCED", "entity_id": str(existing_tx.loan_id)}

        wallet = (
            db.query(Account)
            .filter(Account.id == wallet_id, Account.family_id == family_id, Account.deleted_at.is_(None))
            .first()
        )
        if not wallet:
            return {"status": "FAILED", "error": "wallet not found"}
        currency = _clean(payload.get("currency")) or wallet.currency or "BDT"
        wallet_balance = Decimal(wallet.current_balance or 0)
        if loan_type == "GIVEN" and wallet_balance < amount:
            return {"status": "FAILED", "error": "insufficient wallet balance for GIVEN loan"}

        note = _clean(payload.get("note"))
        loan = Loan(
            family_id=family_id,
            owner_member_id=member_id,
            wallet_account_id=wallet.id,
            loan_type=loan_type,
            person_name=person_name,
            principal_amount=amount,
            paid_amount=Decimal("0"),
            remaining_amount=amount,
            currency=currency,
            status="ACTIVE",
            note=note,
        )
        db.add(loan)
        db.flush()

        try:
            from app.services import accounting_service

            if loan_type == "GIVEN":
                accounting_service.post_loan_given(
                    db,
                    family_id=family_id,
                    member_id=member_id,
                    wallet=wallet,
                    amount=amount,
                    currency=currency,
                    loan_id=loan.id,
                    description=note,
                )
            else:
                accounting_service.post_loan_taken(
                    db,
                    family_id=family_id,
                    member_id=member_id,
                    wallet=wallet,
                    amount=amount,
                    currency=currency,
                    loan_id=loan.id,
                    description=note,
                )
        except Exception as exc:
            return {"status": "FAILED", "error": str(getattr(exc, "detail", None) or exc)}

        db.flush()
        return {"status": "SYNCED", "entity_id": str(loan.id)}

    return {"status": "FAILED", "error": f"unsupported loan operation {operation}"}


def _parse_date(value: Any):
    from datetime import date, datetime

    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value).strip()[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except Exception:
        return None


def _apply_recurring_transaction(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    """CREATE/UPDATE/CLOSE recurring templates. Auto-post stays online."""
    try:
        from app.models.recurring import RecurringTransaction
    except Exception:
        return {"status": "FAILED", "error": "RecurringTransaction model unavailable"}

    op = (operation or "").upper()

    if op in {"DELETE", "CLOSE"} and entity_id:
        row = db.get(RecurringTransaction, entity_id)
        if row and row.family_id == family_id:
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if op in {"UPDATE", "UPSERT", "PAUSE", "RESUME"} and entity_id:
        row = db.get(RecurringTransaction, entity_id)
        if not row or row.family_id != family_id:
            return {"status": "FAILED", "error": "recurring not found"}
        if op == "PAUSE":
            row.status = "PAUSED"
            db.flush()
            return {"status": "SYNCED", "entity_id": str(row.id)}
        if op == "RESUME":
            row.status = "ACTIVE"
            db.flush()
            return {"status": "SYNCED", "entity_id": str(row.id)}
        if payload.get("title") is not None:
            row.title = _clean(payload.get("title")) or row.title
        if "amount" in payload:
            amount = _dec(payload.get("amount"))
            if amount <= 0:
                return {"status": "FAILED", "error": "amount must be positive"}
            row.amount = amount
        if payload.get("frequency") is not None:
            freq = (_clean(payload.get("frequency")) or row.frequency or "").upper()
            if freq not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
                return {"status": "FAILED", "error": "invalid frequency"}
            row.frequency = freq
        if "description" in payload:
            row.description = _clean(payload.get("description"))
        if "end_date" in payload:
            row.end_date = _parse_date(payload.get("end_date"))
        if payload.get("status") is not None:
            row.status = _clean(payload.get("status")) or row.status
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if op in {"CREATE", "UPSERT"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for recurring CREATE"}
        account_id = _clean(payload.get("account_id") or payload.get("wallet_account_id"))
        title = _clean(payload.get("title"))
        tx_type = (_clean(payload.get("transaction_type")) or "").upper()
        amount = _dec(payload.get("amount"))
        frequency = (_clean(payload.get("frequency")) or "").upper()
        start_date = _parse_date(payload.get("start_date") or payload.get("next_due_date"))
        if not account_id:
            return {"status": "FAILED", "error": "account_id required"}
        if not title:
            return {"status": "FAILED", "error": "title required"}
        if tx_type not in {"INCOME", "EXPENSE"}:
            return {"status": "FAILED", "error": "transaction_type must be INCOME or EXPENSE"}
        if amount <= 0:
            return {"status": "FAILED", "error": "amount must be positive"}
        if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
            return {"status": "FAILED", "error": "invalid frequency"}
        if not start_date:
            return {"status": "FAILED", "error": "start_date required"}
        wallet = (
            db.query(Account)
            .filter(Account.id == account_id, Account.family_id == family_id, Account.deleted_at.is_(None))
            .first()
        )
        if not wallet:
            return {"status": "FAILED", "error": "wallet not found"}
        currency = (_clean(payload.get("currency")) or wallet.currency or "BDT").upper()
        row = RecurringTransaction(
            family_id=family_id,
            created_by_member_id=member_id,
            account_id=wallet.id,
            category_id=_clean(payload.get("category_id")),
            title=title,
            transaction_type=tx_type,
            amount=amount,
            currency=currency,
            frequency=frequency,
            start_date=start_date,
            end_date=_parse_date(payload.get("end_date")),
            next_due_date=start_date,
            status=_clean(payload.get("status")) or "ACTIVE",
            description=_clean(payload.get("description")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    return {"status": "FAILED", "error": f"unsupported recurring operation {operation}"}


def _apply_financial_goal(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    """CREATE/UPDATE metadata plus CONTRIBUTE/WITHDRAW money moves for financial_goals."""
    try:
        from app.models.goal import FinancialGoal
        from app.models.savings import SavingsGoal
        from app.models.transaction import Transaction
        from app.models.transaction_line import TransactionLine
    except Exception:
        return {"status": "FAILED", "error": "FinancialGoal model unavailable"}

    op = (operation or "").upper()

    if op in {"CONTRIBUTE", "WITHDRAW"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for goal money move"}
        goal_id = _clean(entity_id or payload.get("goal_id") or payload.get("id"))
        wallet_id = _clean(payload.get("wallet_account_id") or payload.get("account_id"))
        amount = _dec(payload.get("amount"))
        if not goal_id:
            return {"status": "FAILED", "error": "goal_id required"}
        if not wallet_id:
            return {"status": "FAILED", "error": "wallet_account_id required"}
        if amount <= 0:
            return {"status": "FAILED", "error": "amount must be positive"}

        client_request_id = _clean(payload.get("client_request_id"))
        if client_request_id:
            existing_tx = (
                db.query(Transaction)
                .filter(
                    Transaction.family_id == family_id,
                    Transaction.client_request_id == client_request_id,
                )
                .first()
            )
            if existing_tx and existing_tx.goal_id:
                return {"status": "SYNCED", "entity_id": str(existing_tx.goal_id)}

        goal = db.get(FinancialGoal, goal_id)
        if not goal or goal.family_id != family_id:
            return {"status": "FAILED", "error": "financial goal not found"}

        wallet = (
            db.query(Account)
            .filter(Account.id == wallet_id, Account.family_id == family_id, Account.deleted_at.is_(None))
            .first()
        )
        if not wallet:
            return {"status": "FAILED", "error": "wallet not found"}

        currency = (_clean(payload.get("currency")) or goal.currency or wallet.currency or "BDT").upper()
        description = _clean(payload.get("description") or payload.get("note"))
        wallet_balance = Decimal(wallet.current_balance or 0)
        goal_balance = Decimal(goal.current_amount or 0)
        linked_savings = None
        if goal.linked_savings_goal_id:
            linked_savings = db.get(SavingsGoal, goal.linked_savings_goal_id)

        if op == "CONTRIBUTE":
            if str(goal.status or "").upper() != "ACTIVE":
                return {"status": "FAILED", "error": "goal is not active"}
            if wallet_balance < amount:
                return {"status": "FAILED", "error": "insufficient wallet balance for goal contribute"}
            try:
                from app.services import accounting_service

                accounting_service.post_goal_contribute(
                    db,
                    family_id=family_id,
                    member_id=member_id,
                    wallet=wallet,
                    amount=amount,
                    currency=currency,
                    goal_id=goal.id,
                    description=description,
                    client_request_id=client_request_id,
                )
            except Exception as exc:
                return {"status": "FAILED", "error": str(getattr(exc, "detail", None) or exc)}
            goal.current_amount = goal_balance + amount
            if linked_savings and linked_savings.family_id == family_id:
                linked_savings.current_amount = Decimal(linked_savings.current_amount or 0) + amount
            if Decimal(goal.current_amount) >= Decimal(goal.target_amount or 0):
                goal.status = "COMPLETED"
            db.flush()
            return {"status": "SYNCED", "entity_id": str(goal.id)}

        # WITHDRAW
        if str(goal.status or "").upper() not in {"ACTIVE", "COMPLETED"}:
            return {"status": "FAILED", "error": "goal cannot withdraw in current status"}
        if goal_balance < amount:
            return {"status": "FAILED", "error": "insufficient goal balance"}
        if linked_savings and linked_savings.family_id == family_id:
            if Decimal(linked_savings.current_amount or 0) < amount:
                return {"status": "FAILED", "error": "insufficient linked savings balance"}
        try:
            from app.services import accounting_service

            accounting_service.post_goal_withdraw(
                db,
                family_id=family_id,
                member_id=member_id,
                wallet=wallet,
                amount=amount,
                currency=currency,
                goal_id=goal.id,
                description=description,
                client_request_id=client_request_id,
            )
        except Exception as exc:
            return {"status": "FAILED", "error": str(getattr(exc, "detail", None) or exc)}
        goal.current_amount = goal_balance - amount
        if linked_savings and linked_savings.family_id == family_id:
            linked_savings.current_amount = Decimal(linked_savings.current_amount or 0) - amount
        if str(goal.status or "").upper() == "COMPLETED" and Decimal(goal.current_amount or 0) < Decimal(
            goal.target_amount or 0
        ):
            goal.status = "ACTIVE"
        db.flush()
        return {"status": "SYNCED", "entity_id": str(goal.id)}

    if operation == "DELETE" and entity_id:
        row = db.get(FinancialGoal, entity_id)
        if row and row.family_id == family_id:
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if operation in {"UPDATE", "UPSERT"} and entity_id:
        row = db.get(FinancialGoal, entity_id)
        if not row or row.family_id != family_id:
            return {"status": "FAILED", "error": "financial goal not found"}
        if payload.get("goal_name") is not None or payload.get("name") is not None:
            row.goal_name = _clean(payload.get("goal_name") or payload.get("name")) or row.goal_name
        if "target_amount" in payload:
            target = _dec(payload.get("target_amount"), str(row.target_amount))
            if target < Decimal(row.current_amount or 0):
                return {"status": "FAILED", "error": "target cannot be less than current amount"}
            row.target_amount = target
        if "note" in payload:
            row.note = _clean(payload.get("note"))
        if payload.get("status") is not None:
            row.status = _clean(payload.get("status")) or row.status
        if payload.get("goal_type") is not None:
            row.goal_type = _clean(payload.get("goal_type")) or row.goal_type
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if operation in {"CREATE", "UPSERT"}:
        if not member_id:
            return {"status": "FAILED", "error": "member_id required for financial_goals CREATE"}
        name = _clean(payload.get("goal_name") or payload.get("name"))
        target = _dec(payload.get("target_amount"))
        if not name:
            return {"status": "FAILED", "error": "goal_name required"}
        if target <= 0:
            return {"status": "FAILED", "error": "target_amount must be positive"}
        currency = _clean(payload.get("currency")) or "BDT"
        row = FinancialGoal(
            family_id=family_id,
            created_by_member_id=member_id,
            linked_savings_goal_id=_clean(payload.get("linked_savings_goal_id")),
            goal_name=name,
            goal_type=(_clean(payload.get("goal_type")) or "GENERAL").upper(),
            target_amount=target,
            current_amount=Decimal("0"),
            currency=currency,
            status=_clean(payload.get("status")) or "ACTIVE",
            note=_clean(payload.get("note")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    return {"status": "FAILED", "error": f"unsupported financial_goals operation {operation}"}


def _apply_transaction(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
    device_id: str = "default-device",
) -> dict[str, Any]:
    if operation == "DELETE":
        # Financial deletes are review-only: open conflict, keep posted row
        if not entity_id:
            return {"status": "FAILED", "error": "entity_id required for transaction DELETE"}
        try:
            from app.models.transaction import Transaction
        except Exception:
            return {"status": "FAILED", "error": "Transaction model unavailable"}
        row = (
            db.query(Transaction)
            .filter(Transaction.id == entity_id, Transaction.family_id == family_id)
            .first()
        )
        if not row:
            return {"status": "SYNCED", "entity_id": entity_id, "note": "already_absent"}
        cid = _open_conflict(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type="transactions",
            entity_id=entity_id,
            local_payload={**payload, "operation": "DELETE"},
            remote_payload=_server_snapshot(row),
            reason="DELETE_EDIT_RACE",
            notify=True,
        )
        return {"status": "CONFLICT", "conflict_id": cid, "entity_id": entity_id}

    if operation not in {"CREATE", "UPSERT", "UPDATE"}:
        return {"status": "FAILED", "error": "transactions only support CREATE/UPSERT/UPDATE/DELETE via sync"}
    if not member_id:
        return {"status": "FAILED", "error": "member_id required for transactions"}

    tx_type = str(payload.get("transaction_type") or payload.get("type") or "").strip().upper()
    client_request_id = _clean(payload.get("client_request_id") or entity_id)
    description = _clean(payload.get("description") or payload.get("note"))
    currency = _clean(payload.get("currency")) or "BDT"
    amount = payload.get("amount")

    # Idempotency / financial conflict: keep both + flag when same key diverges
    if client_request_id:
        try:
            from app.models.transaction import Transaction

            existing = (
                db.query(Transaction)
                .filter(
                    Transaction.family_id == family_id,
                    Transaction.client_request_id == client_request_id,
                    Transaction.deleted_at.is_(None),
                )
                .first()
            )
            if existing:
                same_amount = _dec(existing.amount) == _dec(amount, str(existing.amount))
                same_type = str(existing.transaction_type or "").upper() == tx_type
                same_desc = (existing.description or "") == (description or existing.description or "")
                if same_amount and same_type and (same_desc or description is None):
                    return {"status": "SYNCED", "entity_id": str(existing.id), "note": "idempotent"}
                # Divergent edit of same logical tx → keep both, flag conflict
                sibling_key = f"{client_request_id}#conflict#{uuid.uuid4().hex[:8]}"
                flagged_desc = f"[SYNC_CONFLICT keep-both] {description or existing.description or ''}".strip()
                payload = {**payload, "client_request_id": sibling_key, "description": flagged_desc}
                client_request_id = sibling_key
                description = flagged_desc
                # fall through to post sibling, then open conflict below via flag
                payload["_tx_conflict_peer_id"] = str(existing.id)
        except Exception:
            pass

    try:
        if tx_type in {"INCOME"}:
            tx = post_income_flush(
                db,
                family_id=family_id,
                member_id=member_id,
                account_id=str(payload.get("account_id") or ""),
                category_id=str(payload.get("category_id") or ""),
                amount=amount,
                currency=currency,
                description=description,
                client_request_id=client_request_id,
            )
        elif tx_type in {"EXPENSE"}:
            tx = post_expense_flush(
                db,
                family_id=family_id,
                member_id=member_id,
                account_id=str(payload.get("account_id") or ""),
                category_id=str(payload.get("category_id") or ""),
                amount=amount,
                currency=currency,
                description=description,
                client_request_id=client_request_id,
            )
        elif tx_type in {"TRANSFER"}:
            tx = post_transfer_flush(
                db,
                family_id=family_id,
                member_id=member_id,
                from_account_id=str(payload.get("from_account_id") or payload.get("account_id") or ""),
                to_account_id=str(payload.get("to_account_id") or ""),
                amount=amount,
                currency=currency,
                description=description,
                client_request_id=client_request_id,
            )
        else:
            return {"status": "FAILED", "error": f"unsupported transaction_type: {tx_type}"}

        peer_id = payload.get("_tx_conflict_peer_id")
        if peer_id:
            cid = _open_conflict(
                db,
                family_id=family_id,
                device_id=device_id,
                entity_type="transactions",
                entity_id=str(peer_id),
                local_payload={
                    **{k: v for k, v in payload.items() if not str(k).startswith("_")},
                    "kept_sibling_id": str(tx.id),
                    "conflict_flag": True,
                },
                remote_payload={"id": peer_id, "note": "original_kept"},
                reason="TX_MERGE_KEEP_BOTH",
                notify=True,
            )
            return {
                "status": "SYNCED",
                "entity_id": str(tx.id),
                "conflict_id": cid,
                "note": "tx_keep_both_flagged",
            }
        return {"status": "SYNCED", "entity_id": str(tx.id)}
    except HTTPException as exc:
        detail = exc.detail
        return {"status": "FAILED", "error": str(detail) if not isinstance(detail, dict) else detail.get("message") or str(detail)}
    except Exception as exc:
        return {"status": "FAILED", "error": str(exc)}


def _apply_zakat_record(
    db: Session,
    *,
    family_id: str,
    operation: str,
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    """Persist a zakat calculation snapshot from offline queue."""
    if operation not in {"CREATE", "UPSERT"}:
        return {"status": "FAILED", "error": "zakat_records only support CREATE/UPSERT"}
    if not member_id:
        return {"status": "FAILED", "error": "member_id required for zakat_records"}
    try:
        from app.models.zakat import ZakatRecord
    except Exception:
        return {"status": "FAILED", "error": "ZakatRecord model unavailable"}

    client_request_id = _clean(payload.get("client_request_id"))
    if client_request_id:
        rows = (
            db.query(ZakatRecord)
            .filter(ZakatRecord.family_id == family_id, ZakatRecord.note.isnot(None))
            .all()
        )
        for row in rows:
            if client_request_id in str(row.note or ""):
                return {"status": "SYNCED", "entity_id": str(row.id)}

    try:
        note = _clean(payload.get("note") or payload.get("notes")) or ""
        if client_request_id:
            note = f"{note} [client_request_id:{client_request_id}]".strip()

        cash = _dec(payload.get("cash_amount") or payload.get("cash_value"))
        gold = _dec(payload.get("gold_value"))
        silver = _dec(payload.get("silver_value"))
        investment = _dec(payload.get("investment_value"))
        business = _dec(payload.get("business_assets") or payload.get("business_value"))
        receivables = _dec(payload.get("receivables"))
        debts = _dec(payload.get("deductible_debts") or payload.get("liabilities"))
        nisab = _dec(payload.get("nisab_amount") or payload.get("nisab_value"))

        zakatable = payload.get("zakatable_amount")
        due = payload.get("zakat_due")
        if zakatable is None or due is None:
            assets = cash + gold + silver + investment + business + receivables
            computed_zakatable = max(assets - debts, Decimal("0"))
            computed_due = (
                computed_zakatable * Decimal("0.025")
                if nisab > 0 and computed_zakatable >= nisab
                else Decimal("0")
            )
            if zakatable is None:
                zakatable = computed_zakatable
            if due is None:
                due = computed_due

        row = ZakatRecord(
            family_id=family_id,
            created_by_member_id=member_id,
            calculation_year=str(payload.get("calculation_year") or payload.get("hijri_year") or "1447"),
            currency=_clean(payload.get("currency")) or "BDT",
            cash_amount=cash,
            gold_value=gold,
            silver_value=silver,
            investment_value=investment,
            business_assets=business,
            receivables=receivables,
            deductible_debts=debts,
            nisab_amount=nisab,
            zakatable_amount=_dec(zakatable),
            zakat_due=_dec(due),
            status=_clean(payload.get("status")) or "CALCULATED",
            note=note or None,
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}
    except Exception as exc:
        return {"status": "FAILED", "error": str(exc)}


def _apply_phase15_item(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    try:
        from app.models.phase15 import Phase15Item
    except Exception:
        return {"status": "FAILED", "error": "Phase15 model unavailable"}

    if operation == "DELETE" and entity_id:
        row = db.get(Phase15Item, entity_id)
        if row and row.family_id == family_id:
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if operation in {"CREATE", "UPSERT"}:
        if entity_id:
            row = db.get(Phase15Item, entity_id)
            if row and row.family_id == family_id:
                if payload.get("name") is not None or payload.get("title") is not None:
                    row.name = _clean(payload.get("name") or payload.get("title")) or row.name
                if payload.get("module_type") is not None:
                    row.module_type = _clean(payload.get("module_type")) or row.module_type
                if payload.get("status") is not None:
                    row.status = _clean(payload.get("status")) or row.status
                if "amount" in payload:
                    row.amount = _dec(payload.get("amount"), str(row.amount))
                if "note" in payload:
                    row.note = _clean(payload.get("note"))
                if "target_date" in payload or "due_date" in payload:
                    row.target_date = _clean(payload.get("target_date") or payload.get("due_date"))
                db.flush()
                return {"status": "SYNCED", "entity_id": str(row.id)}

        if not member_id:
            return {"status": "FAILED", "error": "member_id required for phase15 CREATE"}
        row = Phase15Item(
            family_id=family_id,
            created_by_member_id=member_id,
            module_type=_clean(payload.get("module_type")) or "GENERAL",
            name=_clean(payload.get("name") or payload.get("title")) or "Life item",
            category=_clean(payload.get("category")) or "GENERAL",
            amount=_dec(payload.get("amount")),
            currency=_clean(payload.get("currency")) or "BDT",
            target_date=_clean(payload.get("target_date") or payload.get("due_date")),
            status=_clean(payload.get("status")) or "ACTIVE",
            note=_clean(payload.get("note")),
            provider=_clean(payload.get("provider")),
        )
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    return {"status": "FAILED", "error": f"unsupported phase15 operation {operation}"}


def _apply_phase16_item(
    db: Session,
    *,
    family_id: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict,
    member_id: Optional[str],
) -> dict[str, Any]:
    """Apply phase16 metadata (subscription/document/property). File bytes stay client-queued."""
    try:
        from app.models.phase16 import Phase16Item
    except Exception:
        return {"status": "FAILED", "error": "Phase16 model unavailable"}

    if operation == "DELETE" and entity_id:
        row = db.get(Phase16Item, entity_id)
        if row and row.family_id == family_id:
            row.status = "CLOSED"
            db.flush()
        return {"status": "SYNCED", "entity_id": entity_id}

    if operation in {"CREATE", "UPSERT", "UPDATE"}:
        if entity_id:
            row = db.get(Phase16Item, entity_id)
            if row and row.family_id == family_id:
                if payload.get("name") is not None:
                    row.name = _clean(payload.get("name")) or row.name
                if payload.get("module_type") is not None:
                    row.module_type = _clean(payload.get("module_type")) or row.module_type
                if payload.get("status") is not None:
                    row.status = _clean(payload.get("status")) or row.status
                if "amount" in payload:
                    row.amount = _dec(payload.get("amount"), str(row.amount))
                if "note" in payload:
                    row.note = _clean(payload.get("note"))
                if "provider" in payload:
                    row.provider = _clean(payload.get("provider"))
                if "category" in payload:
                    row.category = _clean(payload.get("category")) or row.category
                if "sub_type" in payload:
                    row.sub_type = _clean(payload.get("sub_type"))
                if "billing_cycle" in payload:
                    row.billing_cycle = _clean(payload.get("billing_cycle"))
                if "reference" in payload:
                    row.reference = _clean(payload.get("reference"))
                if "renewal_or_expiry_date" in payload:
                    row.renewal_or_expiry_date = _clean(payload.get("renewal_or_expiry_date"))
                if "payment_account_id" in payload:
                    row.payment_account_id = _clean(payload.get("payment_account_id"))
                # Optional metadata about a queued file (not the bytes)
                if payload.get("file_name") and not row.file_name:
                    row.file_name = _clean(payload.get("file_name"))
                    row.file_mime = _clean(payload.get("file_mime"))
                    if payload.get("file_size") is not None:
                        try:
                            row.file_size = int(payload.get("file_size"))
                        except Exception:
                            pass
                db.flush()
                return {"status": "SYNCED", "entity_id": str(row.id)}

        if not member_id:
            return {"status": "FAILED", "error": "member_id required for phase16 CREATE"}
        row = Phase16Item(
            family_id=family_id,
            created_by_member_id=member_id,
            module_type=_clean(payload.get("module_type")) or "SUBSCRIPTION",
            name=_clean(payload.get("name") or payload.get("title")) or "Life item",
            category=_clean(payload.get("category")) or "GENERAL",
            sub_type=_clean(payload.get("sub_type")),
            provider=_clean(payload.get("provider")),
            amount=_dec(payload.get("amount")),
            currency=_clean(payload.get("currency")) or "BDT",
            renewal_or_expiry_date=_clean(payload.get("renewal_or_expiry_date")),
            secondary_date=_clean(payload.get("secondary_date")),
            billing_cycle=_clean(payload.get("billing_cycle")),
            payment_account_id=_clean(payload.get("payment_account_id")),
            reference=_clean(payload.get("reference")),
            status=_clean(payload.get("status")) or "ACTIVE",
            note=_clean(payload.get("note")),
            file_name=_clean(payload.get("file_name")),
            file_mime=_clean(payload.get("file_mime")),
        )
        if payload.get("file_size") is not None:
            try:
                row.file_size = int(payload.get("file_size"))
            except Exception:
                pass
        db.add(row)
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    return {"status": "FAILED", "error": f"unsupported phase16 operation {operation}"}


def _apply_architecture_entity(
    db: Session,
    *,
    family_id: str,
    entity_type: str,
    operation: str,
    entity_id: Optional[str],
    payload: dict[str, Any],
    member_id: Optional[str],
) -> dict[str, Any]:
    """Apply offline changes for architecture dedicated tables."""
    from decimal import Decimal

    from app.models.architecture_feature import LoanPayment, Tag, TransactionTag
    from app.models.architecture_modules import (
        Document,
        EducationFund,
        HealthExpense,
        Investment,
        Property,
        Subscription,
        VehicleExpense,
    )
    op = operation.upper()
    mid = member_id or payload.get("created_by_member_id") or payload.get("member_id")
    if not mid and op in {"CREATE", "UPSERT"}:
        return {"status": "FAILED", "error": "member_id required"}

    def money(v: Any) -> Decimal:
        try:
            return Decimal(str(v if v is not None else 0))
        except Exception:
            return Decimal("0")

    if entity_type == "tags":
        if op in {"CREATE", "UPSERT"}:
            name = str(payload.get("name") or "").strip()
            if not name:
                return {"status": "FAILED", "error": "tag name required"}
            row = Tag(family_id=family_id, name=name, color=payload.get("color"))
            db.add(row)
            db.flush()
            return {"status": "SYNCED", "entity_id": str(row.id)}
        return {"status": "FAILED", "error": f"unsupported tags op {op}"}

    if entity_type == "transaction_tags":
        if op in {"CREATE", "UPSERT"}:
            tx_id = str(payload.get("transaction_id") or entity_id or "").strip()
            tag_id = str(payload.get("tag_id") or "").strip()
            if not tx_id or not tag_id:
                return {"status": "FAILED", "error": "transaction_id and tag_id required"}
            row = TransactionTag(transaction_id=tx_id, tag_id=tag_id)
            db.add(row)
            db.flush()
            return {"status": "SYNCED", "entity_id": str(row.id)}
        return {"status": "FAILED", "error": f"unsupported transaction_tags op {op}"}

    if entity_type == "loan_payments":
        if op in {"CREATE", "UPSERT"}:
            loan_id = str(payload.get("loan_id") or "").strip()
            if not loan_id:
                return {"status": "FAILED", "error": "loan_id required"}
            row = LoanPayment(
                loan_id=loan_id,
                family_id=family_id,
                amount=money(payload.get("amount")),
                payment_date=str(payload.get("payment_date") or "")[:30],
                notes=payload.get("notes"),
                payment_method=payload.get("payment_method"),
                transaction_id=payload.get("transaction_id"),
            )
            db.add(row)
            db.flush()
            return {"status": "SYNCED", "entity_id": str(row.id)}
        return {"status": "FAILED", "error": f"unsupported loan_payments op {op}"}

    model_map = {
        "investments": Investment,
        "health_expenses": HealthExpense,
        "vehicle_expenses": VehicleExpense,
        "education_funds": EducationFund,
        "properties": Property,
        "subscriptions": Subscription,
        "documents": Document,
    }
    Model = model_map.get(entity_type)
    if Model is None:
        return {"status": "FAILED", "error": f"unsupported architecture entity {entity_type}"}

    if op in {"DELETE", "CLOSE"}:
        row = None
        if entity_id:
            row = db.get(Model, entity_id)
        if row is None or getattr(row, "family_id", None) != family_id:
            return {"status": "FAILED", "error": "row not found"}
        row.status = "CLOSED"
        db.flush()
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if op not in {"CREATE", "UPSERT", "UPDATE"}:
        return {"status": "FAILED", "error": f"unsupported op {op}"}

    row = None
    if entity_id and op in {"UPSERT", "UPDATE"}:
        row = db.get(Model, entity_id)
        if row and getattr(row, "family_id", None) != family_id:
            row = None

    if row is None:
        kwargs: dict[str, Any] = {"family_id": family_id, "created_by_member_id": mid, "status": "ACTIVE"}
        if entity_type == "investments":
            kwargs.update(
                name=str(payload.get("name") or "Investment"),
                type=str(payload.get("type") or payload.get("sub_type") or "GENERAL"),
                principal=money(payload.get("principal") or payload.get("amount")),
                rate=money(payload["rate"]) if payload.get("rate") is not None else None,
                maturity=payload.get("maturity") or payload.get("renewal_or_expiry_date"),
                currency=str(payload.get("currency") or "BDT"),
                note=payload.get("note") or payload.get("notes"),
                member_id=payload.get("member_id"),
            )
        elif entity_type == "health_expenses":
            kwargs.update(
                type=str(payload.get("type") or payload.get("sub_type") or "GENERAL"),
                doctor=payload.get("doctor") or payload.get("provider"),
                amount=money(payload.get("amount")),
                expense_date=payload.get("expense_date") or payload.get("renewal_or_expiry_date"),
                currency=str(payload.get("currency") or "BDT"),
                notes=payload.get("notes") or payload.get("note"),
                member_id=payload.get("member_id"),
            )
        elif entity_type == "vehicle_expenses":
            kwargs.update(
                vehicle_name=str(payload.get("vehicle_name") or payload.get("name") or "Vehicle"),
                type=str(payload.get("type") or payload.get("sub_type") or "GENERAL"),
                amount=money(payload.get("amount")),
                expense_date=payload.get("expense_date") or payload.get("renewal_or_expiry_date"),
                currency=str(payload.get("currency") or "BDT"),
                notes=payload.get("notes") or payload.get("note"),
            )
        elif entity_type == "education_funds":
            kwargs.update(
                name=str(payload.get("name") or "Education"),
                type=str(payload.get("type") or payload.get("sub_type") or "GENERAL"),
                provider=payload.get("provider"),
                amount=money(payload.get("amount")),
                target_date=payload.get("target_date") or payload.get("renewal_or_expiry_date"),
                currency=str(payload.get("currency") or "BDT"),
                notes=payload.get("notes") or payload.get("note"),
                member_id=payload.get("member_id"),
            )
        elif entity_type == "properties":
            kwargs.update(
                name=str(payload.get("name") or "Property"),
                type=str(payload.get("type") or payload.get("sub_type") or "GENERAL"),
                value=money(payload.get("value") or payload.get("amount")),
                location=payload.get("location") or payload.get("provider"),
                area=payload.get("area") or payload.get("reference"),
                currency=str(payload.get("currency") or "BDT"),
                notes=payload.get("notes") or payload.get("note"),
            )
        elif entity_type == "subscriptions":
            kwargs.update(
                name=str(payload.get("name") or "Subscription"),
                amount=money(payload.get("amount")),
                cycle=str(payload.get("cycle") or payload.get("billing_cycle") or "MONTHLY"),
                next_due=payload.get("next_due") or payload.get("renewal_or_expiry_date"),
                currency=str(payload.get("currency") or "BDT"),
                notes=payload.get("notes") or payload.get("note"),
            )
        elif entity_type == "documents":
            kwargs.update(
                name=str(payload.get("name") or "Document"),
                type=str(payload.get("type") or payload.get("sub_type") or "GENERAL"),
                expiry_date=payload.get("expiry_date") or payload.get("renewal_or_expiry_date"),
                notes=payload.get("notes") or payload.get("note"),
                member_id=payload.get("member_id"),
            )
        row = Model(**kwargs)
        db.add(row)
    else:
        # light update of common fields
        for key in ("name", "status", "note", "notes", "currency", "provider", "doctor", "location"):
            if key in payload and hasattr(row, key):
                setattr(row, key, payload.get(key))
        if "amount" in payload and hasattr(row, "amount"):
            row.amount = money(payload.get("amount"))
        if "principal" in payload and hasattr(row, "principal"):
            row.principal = money(payload.get("principal"))
        if "value" in payload and hasattr(row, "value"):
            row.value = money(payload.get("value"))

    db.flush()
    return {"status": "SYNCED", "entity_id": str(row.id)}


def apply_one_change(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    entity_type: str,
    operation: str,
    entity_id: Optional[str],
    payload: Any,
    member_id: Optional[str],
) -> dict[str, Any]:
    entity_type = str(entity_type or "").strip()
    operation = str(operation or "").strip().upper()
    payload_dict = payload if isinstance(payload, dict) else {}

    if entity_type not in ALLOWED_ENTITY_TYPES:
        return {"status": "FAILED", "error": f"unsupported entity_type: {entity_type}"}

    if entity_type == "transactions":
        return _apply_transaction(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
            device_id=device_id,
        )
    if entity_type == "zakat_records":
        return _apply_zakat_record(
            db,
            family_id=family_id,
            operation=operation,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "phase15_items":
        return _apply_phase15_item(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "phase16_items":
        return _apply_phase16_item(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )

    if entity_type == "grocery_lists":
        return _apply_grocery_list(
            db,
            family_id=family_id,
            device_id=device_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "grocery_items":
        return _apply_grocery_item(
            db,
            family_id=family_id,
            device_id=device_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "grocery_vendors":
        return _apply_grocery_vendor(
            db,
            family_id=family_id,
            device_id=device_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "accounts":
        return _apply_account(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
            device_id=device_id,
        )
    if entity_type == "budgets":
        return _apply_budget(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "savings_goals":
        return _apply_savings_goal(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "loans":
        return _apply_loan(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "financial_goals":
        return _apply_financial_goal(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type == "recurring_transactions":
        return _apply_recurring_transaction(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    if entity_type in {
        "investments",
        "health_expenses",
        "vehicle_expenses",
        "education_funds",
        "properties",
        "subscriptions",
        "documents",
        "tags",
        "loan_payments",
        "transaction_tags",
    }:
        return _apply_architecture_entity(
            db,
            family_id=family_id,
            entity_type=entity_type,
            operation=operation,
            entity_id=entity_id,
            payload=payload_dict,
            member_id=member_id,
        )
    return {"status": "FAILED", "error": f"no applicator for {entity_type}"}


def process_pending_outbox(
    db: Session,
    *,
    family_id: str,
    device_id: Optional[str] = None,
    member_id: Optional[str] = None,
    outbox_ids: Optional[list[str]] = None,
    limit: int = 500,
) -> dict[str, Any]:
    q = db.query(SyncOutbox).filter(
        SyncOutbox.family_id == family_id,
        SyncOutbox.status == "PENDING",
    )
    if device_id:
        q = q.filter(SyncOutbox.device_id == device_id)
    if outbox_ids:
        q = q.filter(SyncOutbox.id.in_(list(outbox_ids)))
    rows = q.order_by(SyncOutbox.created_at.asc()).limit(limit).all()

    synced: list[str] = []
    failed: list[dict[str, Any]] = []
    conflicts: list[str] = []
    conflicted_outbox: list[str] = []

    for row in rows:
        outbox_id = str(row.id)
        payload = _load_json(row.payload)
        result = apply_one_change(
            db,
            family_id=family_id,
            device_id=str(row.device_id or device_id or "default-device"),
            entity_type=str(row.entity_type or ""),
            operation=str(row.operation or ""),
            entity_id=str(row.entity_id) if row.entity_id else None,
            payload=payload,
            member_id=member_id,
        )
        status = result.get("status")
        if status == "SYNCED":
            _set_outbox_status(db, outbox_id, "SYNCED")
            if result.get("entity_id") and not row.entity_id:
                row.entity_id = str(result["entity_id"])
            synced.append(outbox_id)
            if result.get("conflict_id"):
                conflicts.append(str(result["conflict_id"]))
        elif status == "CONFLICT":
            _set_outbox_status(db, outbox_id, "CONFLICT", "SYNC_CONFLICT: version mismatch")
            conflicted_outbox.append(outbox_id)
            if result.get("conflict_id"):
                conflicts.append(str(result["conflict_id"]))
        else:
            _set_outbox_status(db, outbox_id, "FAILED", str(result.get("error") or "apply failed"))
            failed.append({"outbox_id": outbox_id, "error": result.get("error")})

    return {
        "processed": len(rows),
        "synced": synced,
        "synced_count": len(synced),
        "failed": failed,
        "failed_count": len(failed),
        "conflict_ids": conflicts,
        "conflict_count": len(conflicts),
        "conflicted_outbox_ids": conflicted_outbox,
    }


def apply_conflict_resolution(
    db: Session,
    *,
    family_id: str,
    device_id: str,
    conflict_row: dict[str, Any],
    body: dict[str, Any],
    member_id: Optional[str],
) -> dict[str, Any]:
    strategy = str(body.get("strategy") or body.get("resolution") or "keep_server").strip().lower()
    entity_type = str(conflict_row.get("entity_type") or "")
    entity_id = str(conflict_row["entity_id"]) if conflict_row.get("entity_id") else None
    local_payload = _load_json(conflict_row.get("local_payload")) or {}
    remote_payload = _load_json(conflict_row.get("remote_payload")) or {}
    chosen = body.get("chosen") if isinstance(body.get("chosen"), dict) else None

    if strategy in {"keep_server", "server", "discard_local"}:
        # Domain already has server state — nothing to write.
        return {"applied": False, "strategy": "keep_server", "entity_id": entity_id}

    if strategy in {"keep_local", "local", "client"}:
        payload = dict(chosen or local_payload or {})
        # Force apply: drop expected version so applicator overwrites server.
        payload.pop("expected_sync_version", None)
        if remote_payload.get("sync_version") is not None:
            payload["expected_sync_version"] = remote_payload.get("sync_version")
            # Still may conflict if changed again — use force bump path:
            payload["expected_sync_version"] = remote_payload.get("sync_version")
        # Prefer forcing by setting expected to current server version then apply fields
        result = apply_one_change(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type=entity_type,
            operation="UPDATE",
            entity_id=entity_id,
            payload=payload,
            member_id=member_id,
        )
        if result.get("status") == "CONFLICT":
            # Force overwrite after conflict during resolve
            result = _force_apply_payload(
                db,
                family_id=family_id,
                entity_type=entity_type,
                entity_id=entity_id,
                payload=payload,
            )
        return {"applied": result.get("status") == "SYNCED", "strategy": "keep_local", "result": result}

    if strategy in {"merge"}:
        merged = dict(remote_payload if isinstance(remote_payload, dict) else {})
        local_dict = local_payload if isinstance(local_payload, dict) else {}
        for key, value in local_dict.items():
            if key in {"id", "family_id", "sync_version", "expected_sync_version", "created_at"}:
                continue
            if value is not None:
                merged[key] = value
        if chosen:
            merged.update(chosen)
        if remote_payload.get("sync_version") is not None:
            merged["expected_sync_version"] = remote_payload.get("sync_version")
        result = apply_one_change(
            db,
            family_id=family_id,
            device_id=device_id,
            entity_type=entity_type,
            operation="UPDATE",
            entity_id=entity_id,
            payload=merged,
            member_id=member_id,
        )
        if result.get("status") == "CONFLICT":
            result = _force_apply_payload(
                db,
                family_id=family_id,
                entity_type=entity_type,
                entity_id=entity_id,
                payload=merged,
            )
        return {"applied": result.get("status") == "SYNCED", "strategy": "merge", "result": result}

    return {"applied": False, "strategy": strategy, "error": "unknown strategy"}


def _force_apply_payload(
    db: Session,
    *,
    family_id: str,
    entity_type: str,
    entity_id: Optional[str],
    payload: dict,
) -> dict[str, Any]:
    """Apply fields ignoring version (used after explicit conflict resolve)."""
    payload = dict(payload or {})
    payload.pop("expected_sync_version", None)
    payload.pop("sync_version", None)

    if entity_type == "grocery_lists" and entity_id:
        row = (
            db.query(GroceryList)
            .filter(GroceryList.id == entity_id, GroceryList.family_id == family_id)
            .first()
        )
        if not row:
            return {"status": "FAILED", "error": "grocery_list not found"}
        if payload.get("name") is not None or payload.get("title") is not None:
            row.name = _clean(payload.get("name")) or _clean(payload.get("title")) or row.name
        if payload.get("status") is not None:
            row.status = _clean(payload.get("status")) or row.status
        if "budget_amount" in payload:
            row.budget_amount = _dec(payload.get("budget_amount"), str(row.budget_amount))
        if "vendor_name" in payload:
            row.vendor_name = _clean(payload.get("vendor_name"))
        if "note" in payload:
            row.note = _clean(payload.get("note"))
        _bump(row, payload)
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if entity_type == "grocery_items" and entity_id:
        row = (
            db.query(GroceryItem)
            .filter(GroceryItem.id == entity_id, GroceryItem.family_id == family_id)
            .first()
        )
        if not row:
            return {"status": "FAILED", "error": "grocery_item not found"}
        if payload.get("name") is not None:
            row.name = _clean(payload.get("name")) or row.name
        if payload.get("category") is not None:
            row.category = _clean(payload.get("category")) or row.category
        if "quantity" in payload:
            row.quantity = _dec(payload.get("quantity"), str(row.quantity))
        if payload.get("unit") is not None:
            row.unit = _clean(payload.get("unit")) or row.unit
        if "estimated_price" in payload:
            row.estimated_price = _dec(payload.get("estimated_price"), str(row.estimated_price))
        if "actual_price" in payload:
            row.actual_price = _dec(payload.get("actual_price"), str(row.actual_price))
        if "is_bought" in payload:
            row.is_bought = bool(payload.get("is_bought"))
        if "note" in payload:
            row.note = _clean(payload.get("note"))
        if "vendor_name" in payload:
            row.vendor_name = _clean(payload.get("vendor_name"))
        _bump(row, payload)
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if entity_type == "grocery_vendors" and entity_id:
        row = (
            db.query(GroceryVendor)
            .filter(GroceryVendor.id == entity_id, GroceryVendor.family_id == family_id)
            .first()
        )
        if not row:
            return {"status": "FAILED", "error": "grocery_vendor not found"}
        if payload.get("name") is not None:
            row.name = _clean(payload.get("name")) or row.name
        if "phone" in payload:
            row.phone = _clean(payload.get("phone"))
        if "address" in payload:
            row.address = _clean(payload.get("address"))
        if payload.get("category") is not None:
            row.category = _clean(payload.get("category")) or row.category
        if "is_active" in payload:
            row.is_active = bool(payload.get("is_active"))
        return {"status": "SYNCED", "entity_id": str(row.id)}

    if entity_type == "accounts" and entity_id:
        return _apply_account(
            db,
            family_id=family_id,
            operation="UPDATE",
            entity_id=entity_id,
            payload=payload,
        )

    if entity_type == "savings_goals":
        operation = str(payload.get("operation") or "UPDATE").upper()
        if operation not in {"CREATE", "UPDATE", "DELETE", "UPSERT", "DEPOSIT", "WITHDRAW"}:
            operation = "UPDATE"
        return _apply_savings_goal(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload,
            member_id=_clean(payload.get("member_id") or payload.get("owner_member_id")),
        )

    if entity_type == "loans":
        operation = str(payload.get("operation") or "UPDATE").upper()
        if operation not in {"CREATE", "UPDATE", "DELETE", "UPSERT", "PAYMENT"}:
            operation = "UPDATE"
        return _apply_loan(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload,
            member_id=_clean(payload.get("member_id") or payload.get("owner_member_id")),
        )

    if entity_type == "budgets":
        return _apply_budget(
            db,
            family_id=family_id,
            operation=str(payload.get("operation") or "UPDATE").upper(),
            entity_id=entity_id,
            payload=payload,
            member_id=_clean(payload.get("member_id") or payload.get("owner_member_id")),
        )

    if entity_type == "financial_goals":
        operation = str(payload.get("operation") or "UPDATE").upper()
        if operation not in {"CREATE", "UPDATE", "DELETE", "UPSERT", "CONTRIBUTE", "WITHDRAW"}:
            operation = "UPDATE"
        return _apply_financial_goal(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload,
            member_id=_clean(payload.get("member_id") or payload.get("created_by_member_id")),
        )

    if entity_type == "recurring_transactions":
        operation = str(payload.get("operation") or "UPDATE").upper()
        if operation not in {"CREATE", "UPDATE", "DELETE", "UPSERT", "PAUSE", "RESUME", "CLOSE"}:
            operation = "UPDATE"
        return _apply_recurring_transaction(
            db,
            family_id=family_id,
            operation=operation,
            entity_id=entity_id,
            payload=payload,
            member_id=_clean(payload.get("member_id") or payload.get("created_by_member_id")),
        )

    return {"status": "FAILED", "error": f"force apply unsupported for {entity_type}"}
