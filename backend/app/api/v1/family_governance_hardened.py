from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4
import hashlib
import logging
import sys

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import MetaData, Table, and_, func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.rate_limit import JOIN_REQUEST_LIMIT, limiter
from app.core.timeutil import utc_now
from app.models.user import User
from app.services.permission_service import PERMISSIONS, normalize_role


_phase5b_get_current_user = get_current_user


router = APIRouter(tags=["Family Governance Hardened"])
_log = logging.getLogger("s4.family_governance")


def _log_db_route_error(route: str, exc: Exception, **context: Any) -> None:
    """Log the underlying SQLAlchemy/DB exception before the global DB_001 handler."""
    ctx = " ".join(f"{k}={v!r}" for k, v in context.items())
    _log.exception("%s failed %s: %s", route, ctx, exc)
    print(f"[S4 DB ERROR] {route} {ctx}: {exc!r}", file=sys.stderr, flush=True)

# Map Phase5B-era keys → architecture role-matrix keys
_PHASE5B_KEY_ALIASES = {
    "accounts.create": "wallet.create",
    "accounts.view_all": "wallet.read",
    "accounts.update": "wallet.update",
    "accounts.delete": "wallet.delete",
    "transactions.create": "transaction.create",
    "transactions.view_all": "transaction.read",
    "transactions.update": "transaction.update",
    "transactions.delete": "transaction.delete",
    "reports.view": "report.read",
    "audit.view": "audit.read",
    "audit.view_all": "audit.read",
    "sync.view": "dashboard.read",
    "sync.pull": "dashboard.read",
    "sync.push": "transaction.create",
}

class FamilyCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    default_currency: str = "BDT"
    timezone: str = "Asia/Dhaka"
    # Family identity (not RBAC role) — Husband / Wife / Father / Mother / Elder Brother / Elder Sister / Guardian / Other
    relationship_type: str | None = Field(default="Husband", max_length=80)


class InviteGenerateRequest(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=1, ge=1, le=100)
    invitee_email: str | None = Field(default=None, max_length=255)
    send_email: bool = False


class JoinInviteRequest(BaseModel):
    invite_code: str
    relationship_type: str | None = None
    relationship_type_id: str | None = None
    relationship_serial: str | None = None
    serial_label: str | None = None
    linked_member_id: str | None = None
    relationship_note: str | None = None


class JoinDecisionRequest(BaseModel):
    decision: str | None = None
    action: str | None = None
    reason: str | None = None
    note: str | None = None

    @model_validator(mode="after")
    def normalize_decision_alias(self):
        value = (self.decision or self.action or "").strip()
        if not value:
            raise ValueError("decision or action is required")
        self.decision = value
        if self.reason is None and self.note:
            self.reason = self.note
        return self


def new_id() -> str:
    return str(uuid4())


def reflect(db: Session) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=db.get_bind())
    return metadata


def find_table(metadata: MetaData, exact: list[str], contains_any: list[str]) -> Table:
    for name in exact:
        if name in metadata.tables:
            return metadata.tables[name]

    for name, table in metadata.tables.items():
        low = name.lower()
        if any(k in low for k in contains_any):
            return table

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Required table not found. exact={exact}, contains={contains_any}",
    )


def optional_table(metadata: MetaData, exact: list[str], contains_any: list[str]) -> Table | None:
    try:
        return find_table(metadata, exact, contains_any)
    except HTTPException:
        return None


def pk_name(table: Table) -> str:
    cols = list(table.primary_key.columns)
    if cols:
        return cols[0].name
    if "id" in table.c:
        return "id"
    return list(table.c.keys())[0]


def has(table: Table, col: str) -> bool:
    return col in table.c


def first_col(table: Table | None, names: list[str]) -> str | None:
    if table is None:
        return None
    for n in names:
        if n in table.c:
            return n
    return None


def clean(v: Any) -> Any:
    if hasattr(v, "value"):
        return v.value
    return v


def hash_invite_code(raw_code: str) -> str:
    return hashlib.sha256(raw_code.strip().upper().encode("utf-8")).hexdigest()


def get_owner_member_id(db: Session, family_id: Any, user_id: Any, t: dict[str, Table | None]) -> Any | None:
    mem = t["members"]
    family_col = first_col(mem, ["family_id"])
    user_col = first_col(mem, ["user_id", "member_user_id"])
    role_col = first_col(mem, ["role", "member_role"])
    pkn = pk_name(mem)

    conditions = [mem.c[family_col] == family_id, mem.c[user_col] == user_id]
    if role_col:
        conditions.append(func.upper(mem.c[role_col]) == "OWNER")

    row = query_one(db, mem, conditions)
    return row.get(pkn) if row else None


def default_value(col: Any, context: dict[str, Any]) -> Any:
    col_name = col.name if hasattr(col, "name") else str(col)
    low = col_name.lower()

    if col_name in context:
        return context[col_name]

    py_type = None
    try:
        py_type = col.type.python_type if hasattr(col, "type") else None
    except Exception:
        py_type = None

    if low == "id":
        return new_id()

    if low in {"created_at", "updated_at", "requested_at", "joined_at", "issued_at"}:
        return utc_now()

    if low in {"expires_at", "expired_at"}:
        return utc_now() + timedelta(days=int(context.get("expires_in_days", 7)))

    if low in {"is_active", "active", "is_default", "is_enabled"}:
        return True

    if low in {"is_deleted", "deleted", "is_system", "system", "needs_approval"}:
        return False

    if low in {"needs_serial", "requires_serial"}:
        return bool(context.get("needs_serial", False))

    if py_type is bool:
        return bool(context.get(col_name, False))

    if low in {"used_count", "current_uses", "uses_count", "used_times"}:
        return 0

    if low in {"max_uses"}:
        return int(context.get("max_uses", 1))

    if low in {"status", "request_status"}:
        return context.get("status", "ACTIVE")

    if low in {"role", "member_role"}:
        return context.get("role", "MEMBER")

    if low in {"default_currency", "currency"}:
        return context.get("default_currency", "BDT")

    if low in {"timezone"}:
        return context.get("timezone", "Asia/Dhaka")

    if low in {
        "name",
        "name_bn",
        "name_en",
        "relationship_type",
        "relationship_name",
        "relationship_name_bn",
        "relationship_name_en",
        "display_name",
        "title",
    }:
        return context.get(col_name, context.get("name", "S4"))

    if low in {"group_name", "category"}:
        return context.get(col_name, "FAMILY")

    if low in {"invite_channel", "channel"}:
        return context.get(col_name, "CODE")

    if low in {"invitee_email"}:
        return context.get(col_name, None)

    if low in {"invite_link_token", "raw_code_hint"}:
        return context.get(col_name, None)

    if low.endswith("_at"):
        return utc_now()

    if py_type is int:
        return int(context.get(col_name, 0))

    if py_type is float:
        return float(context.get(col_name, 0))

    if low.endswith("_count") or low.endswith("_version") or low in {"sort_order", "display_order"}:
        return 0

    return context.get(col_name, "")


def insert_dynamic(db: Session, table: Table, values: dict[str, Any], context: dict[str, Any] | None = None) -> Any:
    context = context or {}
    final = {}

    for c in table.c:
        if c.name in values and values[c.name] is not None:
            final[c.name] = clean(values[c.name])

    for c in table.c:
        if c.name in final:
            continue

        is_required = not c.nullable and c.default is None and c.server_default is None

        if c.primary_key:
            final[c.name] = default_value(c, context)
        elif is_required:
            final[c.name] = default_value(c, context)

    result = db.execute(table.insert().values(**final))
    pkn = pk_name(table)

    if pkn in final:
        return final[pkn]

    try:
        return result.inserted_primary_key[0]
    except Exception:
        return final.get(pkn)


def fetch_by_id(db: Session, table: Table, row_id: Any) -> dict[str, Any] | None:
    pkn = pk_name(table)
    row = db.execute(select(table).where(table.c[pkn] == row_id)).mappings().first()
    return dict(row) if row else None


def query_one(db: Session, table: Table, conditions: list[Any]) -> dict[str, Any] | None:
    row = db.execute(select(table).where(and_(*conditions))).mappings().first()
    return dict(row) if row else None


def query_all(db: Session, table: Table, conditions: list[Any]) -> list[dict[str, Any]]:
    rows = db.execute(select(table).where(and_(*conditions))).mappings().all()
    return [dict(r) for r in rows]


def tables(db: Session) -> dict[str, Table | None]:
    metadata = reflect(db)
    return {
        "families": find_table(metadata, ["families", "family"], ["famil"]),
        "members": find_table(metadata, ["family_members", "members"], ["family_member"]),
        "users": find_table(metadata, ["users"], ["user"]),
        "invites": optional_table(metadata, ["family_invites", "invites", "invite_codes", "invites"], ["invite"]),
        "join_requests": optional_table(metadata, ["join_requests", "family_join_requests"], ["join"]),
        "relationships": optional_table(metadata, ["relationship_types", "relationships"], ["relationship"]),
        "permissions": optional_table(metadata, ["member_permissions", "family_member_permissions"], ["permission"]),
    }


def user_id_value(user: User) -> str:
    return str(user.id)


def get_or_create_relationship(db: Session, rel_table: Table | None, name: str, needs_serial: bool = False) -> Any | None:
    if rel_table is None:
        return None

    pkn = pk_name(rel_table)
    name_col = first_col(rel_table, ["name", "name_en", "name_bn", "relationship_type", "title"])
    code_col = first_col(rel_table, ["code", "slug"])

    if name_col:
        existing = db.execute(
            select(rel_table).where(func.lower(rel_table.c[name_col]) == name.strip().lower())
        ).mappings().first()
        if existing:
            return existing[pkn]

    code = name.strip().upper().replace(" ", "_")

    values = {}
    if name_col:
        values[name_col] = name.strip()
    if code_col:
        values[code_col] = code
    if has(rel_table, "group_name"):
        values["group_name"] = "FAMILY"
    if has(rel_table, "needs_serial"):
        values["needs_serial"] = needs_serial
    if has(rel_table, "requires_serial"):
        values["requires_serial"] = needs_serial

    return insert_dynamic(
        db,
        rel_table,
        values,
        context={"name": name.strip(), "status": "ACTIVE", "needs_serial": needs_serial},
    )


def is_owner(db: Session, family_id: Any, user_id: Any, t: dict[str, Table | None]) -> bool:
    fam = t["families"]
    mem = t["members"]

    owner_col = first_col(fam, ["owner_user_id", "created_by", "user_id"])
    if owner_col:
        row = query_one(db, fam, [fam.c[pk_name(fam)] == family_id, fam.c[owner_col] == user_id])
        if row:
            return True

    family_col = first_col(mem, ["family_id"])
    user_col = first_col(mem, ["user_id", "member_user_id"])
    role_col = first_col(mem, ["role", "member_role"])

    if family_col and user_col and role_col:
        row = query_one(
            db,
            mem,
            [
                mem.c[family_col] == family_id,
                mem.c[user_col] == user_id,
                func.upper(mem.c[role_col]) == "OWNER",
            ],
        )
        return row is not None

    return False


def is_owner_or_admin(db: Session, family_id: Any, user_id: Any, t: dict[str, Table | None]) -> bool:
    if is_owner(db, family_id, user_id, t):
        return True
    mem = t["members"]
    family_col = first_col(mem, ["family_id"])
    user_col = first_col(mem, ["user_id", "member_user_id"])
    role_col = first_col(mem, ["role", "member_role"])
    if not (family_col and user_col and role_col):
        return False
    row = query_one(
        db,
        mem,
        [
            mem.c[family_col] == family_id,
            mem.c[user_col] == user_id,
            func.upper(mem.c[role_col]) == "ADMIN",
        ],
    )
    return row is not None


def member_id_for_user(db: Session, family_id: Any, user_id: Any, t: dict[str, Table | None]) -> Any | None:
    mem = t["members"]
    family_col = first_col(mem, ["family_id"])
    user_col = first_col(mem, ["user_id", "member_user_id"])
    if not (family_col and user_col):
        return None
    row = query_one(db, mem, [mem.c[family_col] == family_id, mem.c[user_col] == user_id])
    return row.get(pk_name(mem)) if row else None


def require_family_member(db: Session, family_id: Any, user_id: Any, t: dict[str, Table | None]) -> None:
    if is_owner(db, family_id, user_id, t):
        return

    mem = t["members"]
    family_col = first_col(mem, ["family_id"])
    user_col = first_col(mem, ["user_id", "member_user_id"])
    active_col = first_col(mem, ["is_active", "active"])

    conditions = [mem.c[family_col] == family_id, mem.c[user_col] == user_id]
    if active_col:
        conditions.append(mem.c[active_col] == True)

    row = query_one(db, mem, conditions)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a family member")


def create_default_permissions(db: Session, family_id: Any, member_id: Any, user_id: Any, t: dict[str, Table | None], role: str) -> None:
    perm = t.get("permissions")
    if perm is None:
        return

    member_col = first_col(perm, ["family_member_id", "member_id"])
    family_col = first_col(perm, ["family_id"])
    user_col = first_col(perm, ["user_id"])
    key_col = first_col(perm, ["permission_key", "permission", "key", "code"])
    allowed_col = first_col(perm, ["allow", "is_allowed", "allowed", "value", "enabled"])

    keys = [
        "transactions.create",
        "income.create",
        "expense.create",
        "savings.create",
        "wallets.view_all",
    ]

    if key_col:
        for key in keys:
            conditions = []
            if member_col:
                conditions.append(perm.c[member_col] == member_id)
            if family_col:
                conditions.append(perm.c[family_col] == family_id)
            conditions.append(perm.c[key_col] == key)

            if conditions and query_one(db, perm, conditions):
                continue

            values = {}
            if member_col:
                values[member_col] = member_id
            if family_col:
                values[family_col] = family_id
            if user_col:
                values[user_col] = user_id
            values[key_col] = key
            if allowed_col:
                values[allowed_col] = True if role.upper() == "OWNER" else key != "wallets.view_all"
            if has(perm, "scope"):
                values["scope"] = "family"

            insert_dynamic(db, perm, values, context={"status": "ACTIVE"})
        return

    values = {}
    if member_col:
        values[member_col] = member_id
    if family_col:
        values[family_col] = family_id
    if user_col:
        values[user_col] = user_id

    for c in perm.c:
        low = c.name.lower()
        if low.startswith("can_") or low.endswith("_allowed") or low.endswith("_create") or low.endswith("_view_all"):
            values[c.name] = True if role.upper() == "OWNER" else "view_all" not in low

    insert_dynamic(db, perm, values, context={"status": "ACTIVE"})


def invite_code_col(invite_table: Table) -> str:
    col = first_col(invite_table, ["code_hash", "invite_code", "code", "token"])
    if not col:
        raise HTTPException(status_code=500, detail="Invite code column not found")
    return col


def invite_used_col(invite_table: Table) -> str | None:
    return first_col(invite_table, ["used_count", "current_uses", "uses_count", "used_times"])


def invite_max_col(invite_table: Table) -> str | None:
    return first_col(invite_table, ["max_uses", "usage_limit"])


def invite_expiry_col(invite_table: Table) -> str | None:
    return first_col(invite_table, ["expires_at", "expired_at"])


def get_invite_by_code(db: Session, invite_table: Table, code: str) -> dict[str, Any] | None:
    code_col = invite_code_col(invite_table)
    lookup_value = hash_invite_code(code) if code_col == "code_hash" else code.strip()
    return query_one(db, invite_table, [invite_table.c[code_col] == lookup_value])




def row_first(row: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in row:
            return row.get(key)
    return None


def relationship_needs_serial(db: Session, relationship_id: Any, t: dict[str, Table | None]) -> bool:
    rel = t.get("relationships")
    if rel is None or not relationship_id:
        return False

    pkn = pk_name(rel)
    row = query_one(db, rel, [rel.c[pkn] == relationship_id])
    if not row:
        return False

    needs_col = first_col(rel, ["needs_serial", "requires_serial"])
    if not needs_col:
        return False

    if bool(row.get(needs_col)):
        return True

    # Extra safety: if duplicate relationship rows exist with the same name,
    # and any one of them needs serial, treat all same-name relationship rows as serial-required.
    name_cols = [
        col for col in ["name", "name_en", "name_bn", "relationship_type", "title"]
        if has(rel, col)
    ]

    current_names = []
    for col in name_cols:
        value = row.get(col)
        if value not in [None, ""]:
            current_names.append(str(value).strip().lower())

    for rel_name in set(current_names):
        for col in name_cols:
            matches = query_all(db, rel, [func.lower(rel.c[col]) == rel_name])
            for match in matches:
                if bool(match.get(needs_col)):
                    return True

    return False




def mark_relationship_type_needs_serial(db: Session, relationship_id: Any, t: dict[str, Table | None]) -> None:
    rel = t.get("relationships")
    if rel is None or not relationship_id:
        return

    needs_col = first_col(rel, ["needs_serial", "requires_serial"])
    if not needs_col:
        return

    pkn = pk_name(rel)
    db.execute(
        update(rel)
        .where(rel.c[pkn] == relationship_id)
        .values(**{needs_col: True})
    )
    db.flush()


def relationship_name_or_usage_needs_serial(
    db: Session,
    family_id: Any,
    relationship_id: Any,
    relationship_name: str,
    t: dict[str, Table | None],
) -> bool:
    rel = t.get("relationships")
    if rel is None:
        return False

    pkn = pk_name(rel)
    needs_col = first_col(rel, ["needs_serial", "requires_serial"])
    name_cols = [
        col for col in ["name", "name_en", "name_bn", "relationship_type", "title"]
        if has(rel, col)
    ]

    rel_ids: set[Any] = set()
    if relationship_id:
        rel_ids.add(relationship_id)

    clean_name = (relationship_name or "").strip().lower()

    if clean_name and name_cols:
        for col in name_cols:
            matches = query_all(db, rel, [func.lower(rel.c[col]) == clean_name])
            for match in matches:
                mid = match.get(pkn)
                if mid:
                    rel_ids.add(mid)

                if needs_col and bool(match.get(needs_col)):
                    return True

    for rid in list(rel_ids):
        if relationship_needs_serial(db, rid, t):
            return True

    # If this family already has same relationship type with any serial,
    # then serial becomes mandatory for that relationship inside this family.
    mem = t.get("members")
    if mem is not None and rel_ids:
        mem_family_col = first_col(mem, ["family_id"])
        mem_rel_col = first_col(mem, ["relationship_type_id", "requested_relationship_type_id"])
        mem_serial_col = first_col(mem, ["relationship_serial", "requested_relationship_serial"])

        if mem_family_col and mem_rel_col and mem_serial_col:
            for rid in rel_ids:
                rows = query_all(db, mem, [
                    mem.c[mem_family_col] == family_id,
                    mem.c[mem_rel_col] == rid,
                    mem.c[mem_serial_col].isnot(None),
                ])
                for row in rows:
                    val = row.get(mem_serial_col)
                    if val not in [None, ""]:
                        return True

    # Same check for existing pending/approved join requests.
    jr = t.get("join_requests")
    if jr is not None and rel_ids:
        jr_family_col = first_col(jr, ["family_id"])
        jr_rel_col = first_col(jr, ["requested_relationship_type_id", "relationship_type_id"])
        jr_serial_col = first_col(jr, ["requested_relationship_serial", "relationship_serial"])
        jr_status_col = first_col(jr, ["status", "request_status"])

        if jr_family_col and jr_rel_col and jr_serial_col:
            for rid in rel_ids:
                conditions = [
                    jr.c[jr_family_col] == family_id,
                    jr.c[jr_rel_col] == rid,
                    jr.c[jr_serial_col].isnot(None),
                ]
                if jr_status_col:
                    conditions.append(jr.c[jr_status_col].in_(["PENDING", "APPROVED"]))

                rows = query_all(db, jr, conditions)
                for row in rows:
                    val = row.get(jr_serial_col)
                    if val not in [None, ""]:
                        return True

    return False


def normalize_relationship_serial(raw_serial: Any, needs_serial: bool) -> int | None:
    if raw_serial in [None, ""]:
        if needs_serial:
            raise HTTPException(status_code=422, detail="relationship_serial is required for this relationship type")
        return None

    try:
        serial = int(raw_serial)
    except Exception:
        raise HTTPException(status_code=422, detail="relationship_serial must be a number")

    if serial < 1:
        raise HTTPException(status_code=422, detail="relationship_serial must be greater than or equal to 1")

    return serial


def serial_compare_value(table: Table, col_name: str, serial_value: int) -> Any:
    try:
        py_type = table.c[col_name].type.python_type
    except Exception:
        py_type = None

    if py_type is int:
        return int(serial_value)

    return str(serial_value)


def assert_relationship_serial_available(
    db: Session,
    family_id: Any,
    relationship_type_id: Any,
    serial_value: int | None,
    t: dict[str, Table | None],
    exclude_request_id: Any | None = None,
) -> None:
    if serial_value is None or not relationship_type_id:
        return

    mem = t.get("members")
    if mem is not None:
        mem_family_col = first_col(mem, ["family_id"])
        mem_rel_col = first_col(mem, ["relationship_type_id", "requested_relationship_type_id"])
        mem_serial_col = first_col(mem, ["relationship_serial", "requested_relationship_serial"])
        mem_status_col = first_col(mem, ["status"])
        mem_active_col = first_col(mem, ["is_active", "active"])

        if mem_family_col and mem_rel_col and mem_serial_col:
            conditions = [
                mem.c[mem_family_col] == family_id,
                mem.c[mem_rel_col] == relationship_type_id,
                mem.c[mem_serial_col] == serial_compare_value(mem, mem_serial_col, serial_value),
            ]
            if mem_status_col:
                conditions.append(mem.c[mem_status_col].in_(["ACTIVE", "APPROVED", "MEMBER", "OWNER"]))
            if mem_active_col:
                conditions.append(mem.c[mem_active_col] == True)

            existing_member = query_one(db, mem, conditions)
            if existing_member:
                raise HTTPException(status_code=409, detail="relationship_serial already exists in this family")

    jr = t.get("join_requests")
    if jr is not None:
        jr_family_col = first_col(jr, ["family_id"])
        jr_rel_col = first_col(jr, ["requested_relationship_type_id", "relationship_type_id"])
        jr_serial_col = first_col(jr, ["requested_relationship_serial", "relationship_serial"])
        jr_status_col = first_col(jr, ["status", "request_status"])
        jr_pk = pk_name(jr)

        if jr_family_col and jr_rel_col and jr_serial_col:
            conditions = [
                jr.c[jr_family_col] == family_id,
                jr.c[jr_rel_col] == relationship_type_id,
                jr.c[jr_serial_col] == serial_compare_value(jr, jr_serial_col, serial_value),
            ]
            if jr_status_col:
                conditions.append(jr.c[jr_status_col].in_(["PENDING", "APPROVED"]))

            if exclude_request_id:
                conditions.append(jr.c[jr_pk] != exclude_request_id)

            existing_request = query_one(db, jr, conditions)
            if existing_request:
                raise HTTPException(status_code=409, detail="relationship_serial already requested in this family")


def normalize_decision(value: str) -> str:
    d = value.strip().upper()
    if d in {"APPROVE", "APPROVED", "ACCEPT", "ACCEPTED"}:
        return "APPROVED"
    if d in {"REJECT", "REJECTED", "DECLINE", "DECLINED"}:
        return "REJECTED"
    raise HTTPException(status_code=422, detail="decision must be APPROVED or REJECTED")


def family_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "hardened": True,
        "family": row,
        "family_id": row.get("id"),
    }


@router.post("/families")
def create_family_hardened(
    payload: FamilyCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = tables(db)
    fam = t["families"]
    mem = t["members"]

    owner_rel_name = (payload.relationship_type or "Husband").strip() or "Husband"
    rel_id = get_or_create_relationship(db, t["relationships"], owner_rel_name, needs_serial=False)

    values = {
        "name": payload.name.strip(),
        "default_currency": payload.default_currency,
        "timezone": payload.timezone,
        "owner_user_id": user_id_value(current_user),
        "created_by": user_id_value(current_user),
        "is_active": True,
    }

    family_id = insert_dynamic(
        db,
        fam,
        values,
        context={
            "name": payload.name.strip(),
            "default_currency": payload.default_currency,
            "timezone": payload.timezone,
            "status": "ACTIVE",
        },
    )

    member_values = {
        "family_id": family_id,
        "user_id": user_id_value(current_user),
        "role": "OWNER",
        "relationship_type_id": rel_id,
        "relationship_serial": None,
        "is_active": True,
        "status": "ACTIVE",
    }

    owner_member_id = insert_dynamic(
        db,
        mem,
        member_values,
        context={"role": "OWNER", "status": "ACTIVE", "name": getattr(current_user, "full_name", "Owner")},
    )

    if has(fam, "main_responsible_member_id"):
        db.execute(update(fam).where(fam.c[pk_name(fam)] == family_id).values(main_responsible_member_id=owner_member_id))

    create_default_permissions(db, family_id, owner_member_id, user_id_value(current_user), t, role="OWNER")

    # Production seed: default wallets + categories
    try:
        from app.services.family_bootstrap import seed_family_defaults
        from app.services.family_audit import write_family_audit

        seed_family_defaults(db, family_id=str(family_id), owner_member_id=str(owner_member_id))
        write_family_audit(
            db,
            family_id=str(family_id),
            member_id=str(owner_member_id),
            action_type="FAMILY_CREATED",
            entity_type="FAMILY",
            entity_id=str(family_id),
            title="Family created",
            description=f"Owner responsible type: {owner_rel_name}",
        )
    except Exception as exc:
        print("Family seed warning:", exc)

    db.commit()

    return family_response(fetch_by_id(db, fam, family_id) or {"id": family_id})


@router.get("/families")
def list_my_families_hardened(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = tables(db)
    fam = t["families"]
    mem = t["members"]

    family_col = first_col(mem, ["family_id"])
    user_col = first_col(mem, ["user_id", "member_user_id"])

    family_ids = []
    if family_col and user_col:
        rows = db.execute(select(mem.c[family_col]).where(mem.c[user_col] == user_id_value(current_user))).all()
        family_ids = [r[0] for r in rows]

    result = []
    for fid in family_ids:
        row = fetch_by_id(db, fam, fid)
        if row:
            result.append(row)

    return {"hardened": True, "families": result, "count": len(result)}


@router.post("/invites/generate/{family_id}")
def generate_invite_hardened(
    family_id: str,
    payload: InviteGenerateRequest = InviteGenerateRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        from app.api.v1.invites import _create_invite_row, _maybe_send_invite_email, _public_join_link
        from app.services.family_audit import write_family_audit

        t = tables(db)
        if t["members"] is None:
            raise HTTPException(status_code=500, detail="Members table not found")

        if not is_owner_or_admin(db, family_id, user_id_value(current_user), t):
            raise HTTPException(status_code=403, detail="Only owner/admin can generate invite")

        actor_member_id = member_id_for_user(db, family_id, user_id_value(current_user), t) or get_owner_member_id(
            db, family_id, user_id_value(current_user), t
        )
        if not actor_member_id:
            raise HTTPException(status_code=403, detail="Member record not found")

        email = (payload.invitee_email or "").strip().lower() or None
        channel = "EMAIL" if email else "CODE"

        invite, raw_code = _create_invite_row(
            db=db,
            family_id=family_id,
            actor_id=str(actor_member_id),
            expires_days=payload.expires_in_days,
            max_uses=payload.max_uses,
            channel=channel,
            invitee_email=email,
        )
        link = _public_join_link(raw_code)

        email_sent = None
        email_reason = None
        if email and payload.send_email:
            email_sent, email_reason = _maybe_send_invite_email(to_email=email, code=raw_code, link=link)

        write_family_audit(
            db,
            family_id=str(family_id),
            member_id=str(actor_member_id),
            action_type="INVITE_CREATED",
            entity_type="INVITE_CODE",
            entity_id=str(invite.id),
            title="Invite code created",
            description=f"channel={channel}, expires_in_days={payload.expires_in_days}",
        )

        db.commit()

        return {
            "hardened": True,
            "invite_id": invite.id,
            "family_id": family_id,
            "invite_code": raw_code,
            "code": raw_code,
            "expires_in_days": payload.expires_in_days,
            "max_uses": payload.max_uses,
            "status": invite.status,
            "invite_channel": channel,
            "invitee_email": email,
            "invite_link": link,
            "email_sent": email_sent,
            "email_reason": email_reason,
        }
    except SQLAlchemyError as exc:
        db.rollback()
        _log_db_route_error(
            "POST /invites/generate",
            exc,
            family_id=family_id,
            user_id=user_id_value(current_user),
        )
        raise


@router.post("/invites/join")
@limiter.limit(JOIN_REQUEST_LIMIT)
def join_invite_hardened(
    request: Request,
    payload: JoinInviteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return _join_invite_hardened_impl(payload, db, current_user)
    except SQLAlchemyError as exc:
        db.rollback()
        _log_db_route_error(
            "POST /invites/join",
            exc,
            invite_code=payload.invite_code,
            user_id=user_id_value(current_user),
        )
        raise


def _join_invite_hardened_impl(
    payload: JoinInviteRequest,
    db: Session,
    current_user: User,
):
    from app.api.v1.invites import hash_code, normalize_invite_code
    from app.models.family_member import FamilyMember
    from app.models.invite_code import InviteCode
    from app.models.join_request import JoinRequest
    from app.models.relationship_type import RelationshipType
    from app.services.family_audit import write_family_audit

    invite_code = normalize_invite_code(payload.invite_code)
    raw_input = payload.invite_code.strip()

    invite = (
        db.query(InviteCode)
        .filter(
            InviteCode.code_hash == hash_code(invite_code),
            InviteCode.status == "ACTIVE",
            InviteCode.deleted_at.is_(None),
        )
        .first()
    )
    if not invite:
        invite = (
            db.query(InviteCode)
            .filter(
                InviteCode.invite_link_token == raw_input,
                InviteCode.status == "ACTIVE",
                InviteCode.deleted_at.is_(None),
            )
            .first()
        )
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid invite code")

    if invite.expires_at.replace(tzinfo=None) < utc_now():
        invite.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=400, detail="Invite code expired")

    if invite.used_count >= invite.max_uses:
        invite.status = "USED"
        db.commit()
        raise HTTPException(status_code=400, detail="Invite max uses reached")

    already_member = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == invite.family_id,
            FamilyMember.user_id == current_user.id,
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )
    if already_member:
        raise HTTPException(status_code=409, detail="User is already a family member")

    existing_request = (
        db.query(JoinRequest)
        .filter(
            JoinRequest.family_id == invite.family_id,
            JoinRequest.user_id == current_user.id,
            JoinRequest.status == "PENDING",
            JoinRequest.deleted_at.is_(None),
        )
        .first()
    )
    if existing_request:
        raise HTTPException(status_code=409, detail="Join request already exists")

    rel_name = (payload.relationship_type or "Other").strip()
    if not rel_name:
        raise HTTPException(status_code=400, detail="Relationship type is required")

    serial_int: int | None = None
    if payload.relationship_serial is not None and str(payload.relationship_serial).strip() != "":
        try:
            serial_int = int(str(payload.relationship_serial).strip())
        except ValueError:
            serial_int = None

    relationship = (
        db.query(RelationshipType)
        .filter(
            RelationshipType.name_en.ilike(rel_name),
            RelationshipType.deleted_at.is_(None),
        )
        .first()
    )
    if not relationship:
        relationship = RelationshipType(
            name_bn=rel_name,
            name_en=rel_name,
            group_name="FAMILY",
            needs_serial=serial_int is not None,
            is_system=True,
            is_active=True,
        )
        db.add(relationship)
        db.flush()

    join_req = JoinRequest(
        family_id=invite.family_id,
        user_id=current_user.id,
        invite_code_id=invite.id,
        requested_role="MEMBER",
        status="PENDING",
        requested_relationship_type_id=relationship.id,
        requested_relationship_label=rel_name,
        requested_relationship_serial=serial_int,
        requested_serial_label=payload.serial_label,
        requested_linked_member_id=payload.linked_member_id,
        requested_relationship_note=payload.relationship_note,
    )
    db.add(join_req)
    db.flush()

    write_family_audit(
        db,
        family_id=str(invite.family_id),
        member_id=None,
        action_type="JOIN_REQUESTED",
        entity_type="JOIN_REQUEST",
        entity_id=str(join_req.id),
        title="Join request submitted",
        description=f"relationship={rel_name}",
    )

    db.commit()

    return {
        "hardened": True,
        "request_id": join_req.id,
        "family_id": invite.family_id,
        "status": "PENDING",
        "message": "Join request sent",
    }


@router.post("/join-requests/{request_id}/decision")
def decide_join_request_hardened(
    request_id: str,
    payload: JoinDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.join_requests import approve_or_reject_request
    from app.schemas.join_request import JoinRequestDecisionRequest

    try:
        decision = normalize_decision(payload.decision or payload.action or "")
        action = "APPROVE" if decision == "APPROVED" else "REJECT"
        note = payload.reason or payload.note
        if action == "REJECT" and not (note or "").strip():
            note = "Rejected by family owner"
        result = approve_or_reject_request(
            request_id,
            JoinRequestDecisionRequest(action=action, note=note),
            db,
            current_user,
        )
        return {"hardened": True, **result}
    except SQLAlchemyError as exc:
        db.rollback()
        _log_db_route_error(
            "POST /join-requests/decision",
            exc,
            request_id=request_id,
            user_id=user_id_value(current_user),
        )
        raise


@router.get("/families/{family_id}/members")
def list_family_members_hardened(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        t = tables(db)
        mem = t["members"]
        users = t.get("users")

        if mem is None:
            raise HTTPException(status_code=500, detail="Members table not found")

        require_family_member(db, family_id, user_id_value(current_user), t)

        family_col = first_col(mem, ["family_id"])
        user_col = first_col(mem, ["user_id", "member_user_id"])
        pkn = pk_name(mem)
        rows = query_all(db, mem, [mem.c[family_col] == family_id])

        members = []
        for row in rows:
            if row.get("deleted_at") is not None:
                continue

            uid = row.get(user_col) if user_col else None
            full_name = ""
            email = ""
            if uid and users is not None:
                user_pk = pk_name(users)
                user_row = query_one(db, users, [users.c[user_pk] == uid])
                if user_row:
                    full_name = str(user_row.get("full_name") or "")
                    email = str(user_row.get("email") or "")

            relation = (
                row.get("relationship_display_label")
                or row.get("relationship_type")
                or row.get("relationship")
                or ""
            )
            role = str(row.get("role") or row.get("member_role") or "MEMBER")
            status = str(row.get("status") or ("ACTIVE" if row.get("is_active") else "INACTIVE"))

            members.append(
                {
                    "id": row.get(pkn),
                    "member_id": row.get(pkn),
                    "user_id": uid,
                    "full_name": full_name,
                    "email": email,
                    "role": role,
                    "normalized_role": role.upper(),
                    "status": status,
                    "relationship_type": relation,
                    "relationship": relation,
                    "relationship_display_label": relation,
                    "relationship_serial": row.get("relationship_serial"),
                    "linked_member_id": row.get("linked_member_id"),
                    "relationship_note": row.get("relationship_note"),
                    "created_at": row.get("created_at"),
                }
            )

        return {
            "hardened": True,
            "family_id": family_id,
            "count": len(members),
            "members": members,
        }
    except SQLAlchemyError as exc:
        db.rollback()
        _log_db_route_error(
            "GET /families/members",
            exc,
            family_id=family_id,
            user_id=user_id_value(current_user),
        )
        raise



# === PHASE 5B RBAC / MEMBER PERMISSION HARDENING START ===
from datetime import datetime as _phase5b_datetime
from typing import Any as _Phase5BAny

from fastapi import Depends as _Phase5BDepends
from fastapi import HTTPException as _Phase5BHTTPException
from sqlalchemy import text as _phase5b_text
from sqlalchemy import inspect as _phase5b_inspect
from sqlalchemy.orm import Session as _Phase5BSession


def _phase5b_now() -> str:
    return _phase5b_utc_now().isoformat()


def _phase5b_user_id(current_user: _Phase5BAny) -> str:
    if isinstance(current_user, dict):
        for key in ["id", "user_id", "sub", "uid"]:
            value = current_user.get(key)
            if value:
                return str(value)

    for key in ["id", "user_id", "sub", "uid"]:
        value = getattr(current_user, key, None)
        if value:
            return str(value)

    raise _Phase5BHTTPException(status_code=401, detail="Invalid authenticated user")


def _phase5b_columns(db: _Phase5BSession, table_name: str) -> list[str]:
    return [c["name"] for c in _phase5b_inspect(db.get_bind()).get_columns(table_name)]


def _phase5b_table_exists(db: _Phase5BSession, table_name: str) -> bool:
    return table_name in _phase5b_inspect(db.get_bind()).get_table_names()


def _phase5b_bool(value: _Phase5BAny) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    if isinstance(value, int):
        return value == 1
    return str(value).strip().lower() in ["1", "true", "yes", "y", "on"]


def _phase5b_member_for_user(db: _Phase5BSession, family_id: str, user_id: str) -> dict[str, _Phase5BAny] | None:
    if not _phase5b_table_exists(db, "family_members"):
        return None

    cols = _phase5b_columns(db, "family_members")
    user_col = "user_id" if "user_id" in cols else ("member_user_id" if "member_user_id" in cols else None)

    if not user_col:
        return None

    extra = ""
    if "deleted_at" in cols:
        extra += " AND deleted_at IS NULL"
    # Same rule as permission_service.get_active_member_or_403: a PENDING /
    # REMOVED / SUSPENDED row is not a member, even while deleted_at is NULL.
    if "status" in cols:
        extra += " AND UPPER(status) = 'ACTIVE'"

    row = db.execute(
        _phase5b_text(f"""
            SELECT *
            FROM family_members
            WHERE family_id = :family_id
              AND {user_col} = :user_id
              {extra}
            LIMIT 1
        """),
        {"family_id": family_id, "user_id": user_id},
    ).mappings().first()

    return dict(row) if row else None


def _phase5b_member_by_id(db: _Phase5BSession, family_id: str, member_id: str) -> dict[str, _Phase5BAny] | None:
    if not _phase5b_table_exists(db, "family_members"):
        return None

    cols = _phase5b_columns(db, "family_members")
    extra = ""
    if "deleted_at" in cols:
        extra += " AND deleted_at IS NULL"

    row = db.execute(
        _phase5b_text(f"""
            SELECT *
            FROM family_members
            WHERE id = :member_id
              AND family_id = :family_id
              {extra}
            LIMIT 1
        """),
        {"member_id": member_id, "family_id": family_id},
    ).mappings().first()

    return dict(row) if row else None


def _phase5b_is_owner(member: dict[str, _Phase5BAny] | None) -> bool:
    if not member:
        return False

    role = str(member.get("role") or member.get("member_role") or "").upper()
    if role == "OWNER":
        return True

    return False


def _phase5b_require_family_member(
    db: _Phase5BSession,
    family_id: str,
    current_user: _Phase5BAny,
) -> dict[str, _Phase5BAny]:
    user_id = _phase5b_user_id(current_user)
    member = _phase5b_member_for_user(db, family_id, user_id)

    if not member:
        raise _Phase5BHTTPException(status_code=403, detail="Not a member of this family")

    return member


def _phase5b_require_owner(
    db: _Phase5BSession,
    family_id: str,
    current_user: _Phase5BAny,
) -> dict[str, _Phase5BAny]:
    member = _phase5b_require_family_member(db, family_id, current_user)

    if not _phase5b_is_owner(member):
        raise _Phase5BHTTPException(status_code=403, detail="Owner permission required")

    return member


def _phase5b_permission_row(
    db: _Phase5BSession,
    member_id: str,
    permission_key: str,
) -> dict[str, _Phase5BAny] | None:
    if not _phase5b_table_exists(db, "member_permissions"):
        return None

    cols = _phase5b_columns(db, "member_permissions")
    member_col = "member_id" if "member_id" in cols else ("family_member_id" if "family_member_id" in cols else None)
    key_col = "permission_key" if "permission_key" in cols else None

    if not member_col or not key_col:
        return None

    order_cols = []
    if "updated_at" in cols:
        order_cols.append("updated_at DESC")
    if "created_at" in cols:
        order_cols.append("created_at DESC")
    order_sql = " ORDER BY " + ", ".join(order_cols) if order_cols else ""
    deleted_sql = " AND deleted_at IS NULL" if "deleted_at" in cols else ""

    row = db.execute(
        _phase5b_text(f"""
            SELECT *
            FROM member_permissions
            WHERE {member_col} = :member_id
              AND {key_col} = :permission_key
              {deleted_sql}
            {order_sql}
            LIMIT 1
        """),
        {"member_id": member_id, "permission_key": permission_key},
    ).mappings().first()

    return dict(row) if row else None


def _phase5b_has_permission(
    db: _Phase5BSession,
    family_id: str,
    current_member: dict[str, _Phase5BAny],
    permission_key: str,
) -> bool:
    if _phase5b_is_owner(current_member):
        return True

    mapped = _PHASE5B_KEY_ALIASES.get(permission_key, permission_key)
    role = normalize_role(
        current_member.get("normalized_role")
        or current_member.get("role")
        or current_member.get("member_role")
    )
    if role == "OWNER":
        return True

    # Override rows used to be consulted only when the role did NOT already
    # grant the key, so an owner's explicit deny (allow=false) on e.g.
    # transaction.create never reached sync push, and an allow row could hand
    # a non-owner a PROTECTED_OWNER_PERMISSIONS key. Now: the newest override
    # row per key decides; deny beats the role grant; allow never grants a
    # protected key (same contract as permission_service.effective_permission_keys).
    from app.services.permission_service import PROTECTED_OWNER_PERMISSIONS

    keys = [permission_key] if mapped == permission_key else [permission_key, mapped]
    allowed_by_override = False
    denied_by_override = False
    for key in keys:
        row = _phase5b_permission_row(db, str(current_member.get("id")), key)
        if not row or "allow" not in row:
            continue
        if _phase5b_bool(row.get("allow")):
            if key not in PROTECTED_OWNER_PERMISSIONS:
                allowed_by_override = True
        else:
            denied_by_override = True

    if denied_by_override and not allowed_by_override:
        return False
    if mapped in PERMISSIONS.get(role, set()) or permission_key in PERMISSIONS.get(role, set()):
        return True
    return allowed_by_override


def _phase5b_require_permission(
    db: _Phase5BSession,
    family_id: str,
    current_user: _Phase5BAny,
    permission_key: str,
) -> dict[str, _Phase5BAny]:
    member = _phase5b_require_family_member(db, family_id, current_user)

    if not _phase5b_has_permission(db, family_id, member, permission_key):
        raise _Phase5BHTTPException(status_code=403, detail=f"Permission required: {permission_key}")

    return member



