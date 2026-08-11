from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4
import hashlib

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import MetaData, Table, and_, func, select, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.timeutil import utc_now
from app.models.user import User


_phase5b_get_current_user = get_current_user


router = APIRouter(tags=["Family Governance Hardened"])


class FamilyCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    default_currency: str = "BDT"
    timezone: str = "Asia/Dhaka"
    # Family identity (not RBAC role) — Husband / Wife / Father / Mother / Elder Brother / Elder Sister / Guardian / Other
    relationship_type: str | None = Field(default="Husband", max_length=80)


class InviteGenerateRequest(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=1, ge=1, le=100)


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


def first_col(table: Table, names: list[str]) -> str | None:
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
@router.post("/api/v1/families")
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
@router.get("/api/v1/families")
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
@router.post("/api/v1/invites/generate/{family_id}")
def generate_invite_hardened(
    family_id: str,
    payload: InviteGenerateRequest = InviteGenerateRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = tables(db)
    inv = t["invites"]

    if inv is None:
        raise HTTPException(status_code=500, detail="Invite table not found")

    if not is_owner_or_admin(db, family_id, user_id_value(current_user), t):
        raise HTTPException(status_code=403, detail="Only owner/admin can generate invite")

    code_col = invite_code_col(inv)
    family_col = first_col(inv, ["family_id"])
    used_col = invite_used_col(inv)
    max_col = invite_max_col(inv)
    exp_col = invite_expiry_col(inv)
    created_by_member_col = first_col(inv, ["created_by_member_id"])

    actor_member_id = member_id_for_user(db, family_id, user_id_value(current_user), t) or get_owner_member_id(
        db, family_id, user_id_value(current_user), t
    )
    if created_by_member_col and not actor_member_id:
        raise HTTPException(status_code=403, detail="Member record not found")

    for _ in range(10):
        code = "S4F-" + uuid4().hex[:8].upper()
        if not get_invite_by_code(db, inv, code):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique invite code")

    stored_code = hash_invite_code(code) if code_col == "code_hash" else code

    values = {
        code_col: stored_code,
        "status": "ACTIVE",
    }

    if family_col:
        values[family_col] = family_id
    if created_by_member_col:
        values[created_by_member_col] = actor_member_id
    if has(inv, "created_by"):
        values["created_by"] = user_id_value(current_user)
    if has(inv, "created_by_user_id"):
        values["created_by_user_id"] = user_id_value(current_user)
    if has(inv, "is_active"):
        values["is_active"] = True

    if used_col:
        values[used_col] = 0
    if max_col:
        values[max_col] = payload.max_uses
    if exp_col:
        values[exp_col] = utc_now() + timedelta(days=payload.expires_in_days)

    invite_id = insert_dynamic(
        db,
        inv,
        values,
        context={"status": "ACTIVE", "max_uses": payload.max_uses, "expires_in_days": payload.expires_in_days},
    )

    from app.services.family_audit import write_family_audit

    write_family_audit(
        db,
        family_id=str(family_id),
        member_id=str(actor_member_id) if actor_member_id else None,
        action_type="INVITE_CREATED",
        entity_type="INVITE_CODE",
        entity_id=str(invite_id),
        title="Invite code created",
        description=f"expires_in_days={payload.expires_in_days}",
    )

    db.commit()

    return {
        "hardened": True,
        "invite_id": invite_id,
        "family_id": family_id,
        "invite_code": code,
        "expires_in_days": payload.expires_in_days,
        "max_uses": payload.max_uses,
    }


@router.post("/invites/join")
@router.post("/api/v1/invites/join")
def join_invite_hardened(
    payload: JoinInviteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = tables(db)
    inv = t["invites"]
    jr = t["join_requests"]
    mem = t["members"]

    if inv is None or jr is None:
        raise HTTPException(status_code=500, detail="Invite or join_requests table not found")

    invite = get_invite_by_code(db, inv, payload.invite_code)
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid invite code")

    exp_col = invite_expiry_col(inv)
    if exp_col and invite.get(exp_col) and invite.get(exp_col) < utc_now():
        raise HTTPException(status_code=400, detail="Invite code expired")

    active_col = first_col(inv, ["is_active", "active"])
    if active_col and invite.get(active_col) is False:
        raise HTTPException(status_code=400, detail="Invite code inactive")

    status_col_inv = first_col(inv, ["status"])
    if status_col_inv and str(invite.get(status_col_inv, "")).upper() not in {"ACTIVE", "OPEN", ""}:
        raise HTTPException(status_code=400, detail="Invite code not active")

    used_col = invite_used_col(inv)
    max_col = invite_max_col(inv)
    used = int(invite.get(used_col) or 0) if used_col else 0
    max_uses = int(invite.get(max_col) or 1) if max_col else 1
    if used >= max_uses:
        raise HTTPException(status_code=400, detail="Invite max uses reached")

    family_col_inv = first_col(inv, ["family_id"])
    family_id = invite.get(family_col_inv) if family_col_inv else None
    if not family_id:
        raise HTTPException(status_code=500, detail="Invite family_id missing")

    family_col_mem = first_col(mem, ["family_id"])
    user_col_mem = first_col(mem, ["user_id", "member_user_id"])

    existing_member = query_one(db, mem, [mem.c[family_col_mem] == family_id, mem.c[user_col_mem] == user_id_value(current_user)])
    if existing_member:
        raise HTTPException(status_code=409, detail="User is already a family member")

    jr_family_col = first_col(jr, ["family_id"])
    jr_user_col = first_col(jr, ["user_id", "requester_user_id", "requested_by_user_id"])
    jr_status_col = first_col(jr, ["status", "request_status"])

    pending_conditions = [jr.c[jr_family_col] == family_id, jr.c[jr_user_col] == user_id_value(current_user)]
    if jr_status_col:
        pending_conditions.append(jr.c[jr_status_col].in_(["PENDING", "APPROVED"]))

    existing_request = query_one(db, jr, pending_conditions)
    if existing_request:
        raise HTTPException(status_code=409, detail="Join request already exists")

    rel_name = payload.relationship_type or "Family Member"
    from app.services.relationship_rules import validate_relationship_payload

    serial_raw = payload.relationship_serial
    serial_int: int | None = None
    if serial_raw is not None and str(serial_raw).strip() != "":
        try:
            serial_int = int(str(serial_raw).strip())
        except ValueError:
            # allow ELDER/SECOND etc via serial_label; keep raw for legacy path
            if not payload.serial_label:
                payload.serial_label = str(serial_raw).strip()

    validated = validate_relationship_payload(
        relationship_label=rel_name,
        relationship_serial=serial_int,
        serial_label=payload.serial_label,
        linked_member_id=payload.linked_member_id,
        relationship_note=payload.relationship_note,
    )
    rel_name = validated["label"]
    rel_id = payload.relationship_type_id or get_or_create_relationship(
        db, t["relationships"], rel_name, bool(validated["relationship_serial"] or payload.serial_label)
    )

    needs_serial = relationship_needs_serial(db, rel_id, t) or relationship_name_or_usage_needs_serial(
        db,
        family_id,
        rel_id,
        rel_name,
        t,
    )
    # Prefer rule-resolved rank; fall back to legacy normalize for unknown groups
    serial_value = validated["relationship_serial"]
    if serial_value is None and needs_serial:
        serial_value = normalize_relationship_serial(payload.relationship_serial, needs_serial)

    if serial_value is not None:
        mark_relationship_type_needs_serial(db, rel_id, t)

    assert_relationship_serial_available(db, family_id, rel_id, serial_value, t)

    req_values = {
        "family_id": family_id,
        "user_id": user_id_value(current_user),
        "invite_code_id": invite.get(pk_name(inv)),
        "requested_role": "MEMBER",
        "status": "PENDING",
        "requested_relationship_type_id": rel_id,
        "requested_relationship_label": validated["relationship_display_label"] or rel_name,
        "requested_relationship_serial": serial_value,
    }

    if has(jr, "requester_user_id"):
        req_values["requester_user_id"] = user_id_value(current_user)
    if has(jr, "requested_by_user_id"):
        req_values["requested_by_user_id"] = user_id_value(current_user)
    if has(jr, "invite_id"):
        req_values["invite_id"] = invite.get(pk_name(inv))
    if has(jr, "relationship_type_id"):
        req_values["relationship_type_id"] = rel_id
    if has(jr, "relationship_type"):
        req_values["relationship_type"] = rel_name
    if has(jr, "relationship_serial"):
        req_values["relationship_serial"] = serial_value
    if has(jr, "requested_linked_member_id"):
        req_values["requested_linked_member_id"] = validated["linked_member_id"]
    if has(jr, "linked_member_id"):
        req_values["linked_member_id"] = validated["linked_member_id"]
    if has(jr, "requested_relationship_note"):
        req_values["requested_relationship_note"] = validated["relationship_note"]
    if has(jr, "relationship_note"):
        req_values["relationship_note"] = validated["relationship_note"]
    if has(jr, "serial_label"):
        req_values["serial_label"] = payload.serial_label
    if has(jr, "request_status"):
        req_values["request_status"] = "PENDING"

    request_id = insert_dynamic(db, jr, req_values, context={"status": "PENDING", "name": rel_name, "role": "MEMBER"})

    from app.services.family_audit import write_family_audit

    write_family_audit(
        db,
        family_id=str(family_id),
        member_id=None,
        action_type="JOIN_REQUESTED",
        entity_type="JOIN_REQUEST",
        entity_id=str(request_id),
        title="Join request submitted",
        description=f"relationship={rel_name}",
    )

    db.commit()

    return {
        "hardened": True,
        "request_id": request_id,
        "family_id": family_id,
        "status": "PENDING",
    }


@router.post("/join-requests/{request_id}/decision")
@router.post("/api/v1/join-requests/{request_id}/decision")
def decide_join_request_hardened(
    request_id: str,
    payload: JoinDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = tables(db)
    jr = t["join_requests"]
    mem = t["members"]
    inv = t["invites"]

    if jr is None:
        raise HTTPException(status_code=500, detail="join_requests table not found")

    req = fetch_by_id(db, jr, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Join request not found")

    family_col = first_col(jr, ["family_id"])
    family_id = req.get(family_col)

    if not is_owner_or_admin(db, family_id, user_id_value(current_user), t):
        raise HTTPException(status_code=403, detail="Only owner/admin can approve or reject join request")

    status_col = first_col(jr, ["status", "request_status"])
    current_status = str(req.get(status_col, "PENDING")).upper() if status_col else "PENDING"
    if current_status != "PENDING":
        raise HTTPException(status_code=409, detail="Join request already decided")

    decision = normalize_decision(payload.decision)

    member_created = False
    member_id = None

    if decision == "APPROVED":
        req_user_col = first_col(jr, ["user_id", "requester_user_id", "requested_by_user_id"])
        req_user_id = req.get(req_user_col)

        family_col_mem = first_col(mem, ["family_id"])
        user_col_mem = first_col(mem, ["user_id", "member_user_id"])

        existing_member = query_one(db, mem, [mem.c[family_col_mem] == family_id, mem.c[user_col_mem] == req_user_id])

        if not existing_member:
            req_rel_id = row_first(req, ["requested_relationship_type_id", "relationship_type_id"])
            req_serial_value = row_first(req, ["requested_relationship_serial", "relationship_serial"])
            req_serial_value = normalize_relationship_serial(req_serial_value, False)
            assert_relationship_serial_available(
                db,
                family_id,
                req_rel_id,
                req_serial_value,
                t,
                exclude_request_id=request_id,
            )

            values = {
                "family_id": family_id,
                "user_id": req_user_id,
                "member_user_id": req_user_id,
                "role": "MEMBER",
                "relationship_type_id": req_rel_id,
                "relationship_serial": req_serial_value,
                "relationship_display_label": row_first(req, ["requested_relationship_label", "relationship_label"])
                or "Member",
                "linked_member_id": row_first(req, ["requested_linked_member_id", "linked_member_id"]),
                "relationship_note": row_first(req, ["requested_relationship_note", "relationship_note"]),
                "is_active": True,
                "status": "ACTIVE",
            }
            member_id = insert_dynamic(db, mem, values, context={"role": "MEMBER", "status": "ACTIVE", "name": "Member"})
            create_default_permissions(db, family_id, member_id, req_user_id, t, role="MEMBER")
            member_created = True
        else:
            member_id = existing_member.get(pk_name(mem))

        invite_id_col = first_col(jr, ["invite_code_id", "invite_id"])
        invite_id = req.get(invite_id_col) if invite_id_col else None

        if inv is not None and invite_id:
            used_col = invite_used_col(inv)
            if used_col:
                current_inv = fetch_by_id(db, inv, invite_id)
                current_used = int(current_inv.get(used_col) or 0) if current_inv else 0
                db.execute(update(inv).where(inv.c[pk_name(inv)] == invite_id).values(**{used_col: current_used + 1}))

    update_values = {}
    if status_col:
        update_values[status_col] = decision
    for c in ["decision", "decision_status"]:
        if has(jr, c):
            update_values[c] = decision
    for c in ["decided_by", "decision_by", "approved_by", "updated_by"]:
        if has(jr, c):
            update_values[c] = user_id_value(current_user)
    reviewer_member_id = member_id_for_user(db, family_id, user_id_value(current_user), t)
    if has(jr, "reviewed_by_member_id") and reviewer_member_id:
        update_values["reviewed_by_member_id"] = reviewer_member_id
    for c in ["decided_at", "decision_at", "approved_at", "updated_at"]:
        if has(jr, c):
            update_values[c] = utc_now()
    if has(jr, "decision_reason") and payload.reason:
        update_values["decision_reason"] = payload.reason
    if has(jr, "review_note") and payload.reason:
        update_values["review_note"] = payload.reason

    if update_values:
        db.execute(update(jr).where(jr.c[pk_name(jr)] == request_id).values(**update_values))

    from app.services.family_audit import write_family_audit

    write_family_audit(
        db,
        family_id=str(family_id),
        member_id=str(reviewer_member_id) if reviewer_member_id else None,
        action_type="MEMBER_APPROVED" if decision == "APPROVED" else "MEMBER_REJECTED",
        entity_type="JOIN_REQUEST",
        entity_id=str(request_id),
        title=f"Join request {decision.lower()}",
    )

    db.commit()

    return {
        "hardened": True,
        "request_id": request_id,
        "status": decision,
        "member_created": member_created,
        "member_id": member_id,
    }


@router.get("/families/{family_id}/members")
@router.get("/api/v1/families/{family_id}/members")
def list_family_members_hardened(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = tables(db)
    mem = t["members"]

    require_family_member(db, family_id, user_id_value(current_user), t)

    family_col = first_col(mem, ["family_id"])
    rows = query_all(db, mem, [mem.c[family_col] == family_id])

    return {
        "hardened": True,
        "family_id": family_id,
        "count": len(rows),
        "members": rows,
    }



# === PHASE 5B RBAC / MEMBER PERMISSION HARDENING START ===
from datetime import datetime as _phase5b_datetime
from uuid import uuid4 as _phase5b_uuid4
from typing import Any as _Phase5BAny

from fastapi import Depends as _Phase5BDepends
from fastapi import HTTPException as _Phase5BHTTPException
from pydantic import BaseModel as _Phase5BBaseModel, Field as _Phase5BField
from sqlalchemy import text as _phase5b_text
from sqlalchemy import inspect as _phase5b_inspect
from sqlalchemy.orm import Session as _Phase5BSession


class Phase5BPermissionSetRequest(_Phase5BBaseModel):
    allow: bool = _Phase5BField(...)
    scope: str | None = _Phase5BField(default="FAMILY")


class Phase5BPermissionCheckRequest(_Phase5BBaseModel):
    permission_key: str = _Phase5BField(..., min_length=1, max_length=120)


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

    row = db.execute(
        _phase5b_text(f"""
            SELECT *
            FROM member_permissions
            WHERE {member_col} = :member_id
              AND {key_col} = :permission_key
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

    row = _phase5b_permission_row(db, str(current_member.get("id")), permission_key)
    if not row:
        return False

    allow_col = "allow" if "allow" in row else None
    if not allow_col:
        return False

    return _phase5b_bool(row.get(allow_col))


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


def _phase5b_set_permission(
    db: _Phase5BSession,
    member_id: str,
    permission_key: str,
    allow: bool,
    scope: str | None = "FAMILY",
) -> dict[str, _Phase5BAny]:
    if not _phase5b_table_exists(db, "member_permissions"):
        raise _Phase5BHTTPException(status_code=500, detail="member_permissions table missing")

    cols = _phase5b_columns(db, "member_permissions")
    member_col = "member_id" if "member_id" in cols else ("family_member_id" if "family_member_id" in cols else None)
    key_col = "permission_key" if "permission_key" in cols else None
    allow_col = "allow" if "allow" in cols else None
    scope_col = "scope" if "scope" in cols else None

    if not member_col or not key_col or not allow_col:
        raise _Phase5BHTTPException(status_code=500, detail="member_permissions schema incomplete")

    existing = db.execute(
        _phase5b_text(f"""
            SELECT id
            FROM member_permissions
            WHERE {member_col} = :member_id
              AND {key_col} = :permission_key
            LIMIT 1
        """),
        {"member_id": member_id, "permission_key": permission_key},
    ).mappings().first()

    now = _phase5b_now()

    if existing:
        set_parts = [f"{allow_col} = :allow"]
        values: dict[str, _Phase5BAny] = {
            "id": existing["id"],
            "allow": bool(allow),
            "permission_key": permission_key,
            "member_id": member_id,
        }

        if scope_col:
            set_parts.append(f"{scope_col} = :scope")
            values["scope"] = scope or "FAMILY"

        if "updated_at" in cols:
            set_parts.append("updated_at = :updated_at")
            values["updated_at"] = now

        if "deleted_at" in cols:
            set_parts.append("deleted_at = NULL")

        db.execute(
            _phase5b_text(f"""
                UPDATE member_permissions
                SET {", ".join(set_parts)}
                WHERE id = :id
            """),
            values,
        )
    else:
        insert_cols = []
        insert_vals = []
        values = {}

        if "id" in cols:
            insert_cols.append("id")
            insert_vals.append(":id")
            values["id"] = str(_phase5b_uuid4())

        insert_cols.extend([member_col, key_col, allow_col])
        insert_vals.extend([":member_id", ":permission_key", ":allow"])
        values.update({
            "member_id": member_id,
            "permission_key": permission_key,
            "allow": bool(allow),
        })

        if scope_col:
            insert_cols.append(scope_col)
            insert_vals.append(":scope")
            values["scope"] = scope or "FAMILY"

        if "created_at" in cols:
            insert_cols.append("created_at")
            insert_vals.append(":created_at")
            values["created_at"] = now

        if "updated_at" in cols:
            insert_cols.append("updated_at")
            insert_vals.append(":updated_at")
            values["updated_at"] = now

        db.execute(
            _phase5b_text(f"""
                INSERT INTO member_permissions ({", ".join(insert_cols)})
                VALUES ({", ".join(insert_vals)})
            """),
            values,
        )

    db.commit()

    row = _phase5b_permission_row(db, member_id, permission_key)
    if not row:
        raise _Phase5BHTTPException(status_code=500, detail="Permission row not saved")

    return row


@router.get("/families/{family_id}/permissions/me")
def phase5b_my_family_permissions(
    family_id: str,
    db: _Phase5BSession = _Phase5BDepends(get_db),
    current_user: _Phase5BAny = _Phase5BDepends(get_current_user),
):
    member = _phase5b_require_family_member(db, family_id, current_user)
    cols = _phase5b_columns(db, "member_permissions")
    member_col = "member_id" if "member_id" in cols else ("family_member_id" if "family_member_id" in cols else None)

    rows = []
    if member_col:
        rows = db.execute(
            _phase5b_text(f"""
                SELECT *
                FROM member_permissions
                WHERE {member_col} = :member_id
                ORDER BY permission_key
            """),
            {"member_id": member["id"]},
        ).mappings().all()

    permissions = {}
    for row in rows:
        d = dict(row)
        permissions[str(d.get("permission_key"))] = _phase5b_bool(d.get("allow"))

    return {
        "hardened": True,
        "phase": "5B",
        "family_id": family_id,
        "member_id": member["id"],
        "role": member.get("role"),
        "is_owner": _phase5b_is_owner(member),
        "permissions": permissions,
    }


@router.get("/families/{family_id}/members/{member_id}/permissions")
def phase5b_get_member_permissions(
    family_id: str,
    member_id: str,
    db: _Phase5BSession = _Phase5BDepends(get_db),
    current_user: _Phase5BAny = _Phase5BDepends(get_current_user),
):
    _phase5b_require_owner(db, family_id, current_user)

    target_member = _phase5b_member_by_id(db, family_id, member_id)
    if not target_member:
        raise _Phase5BHTTPException(status_code=404, detail="Family member not found")

    cols = _phase5b_columns(db, "member_permissions")
    member_col = "member_id" if "member_id" in cols else ("family_member_id" if "family_member_id" in cols else None)

    rows = []
    if member_col:
        rows = db.execute(
            _phase5b_text(f"""
                SELECT *
                FROM member_permissions
                WHERE {member_col} = :member_id
                ORDER BY permission_key
            """),
            {"member_id": member_id},
        ).mappings().all()

    return {
        "hardened": True,
        "phase": "5B",
        "family_id": family_id,
        "member_id": member_id,
        "count": len(rows),
        "permissions": [dict(r) for r in rows],
    }


@router.put("/families/{family_id}/members/{member_id}/permissions/{permission_key}")
def phase5b_set_member_permission(
    family_id: str,
    member_id: str,
    permission_key: str,
    payload: Phase5BPermissionSetRequest,
    db: _Phase5BSession = _Phase5BDepends(get_db),
    current_user: _Phase5BAny = _Phase5BDepends(get_current_user),
):
    _phase5b_require_owner(db, family_id, current_user)

    target_member = _phase5b_member_by_id(db, family_id, member_id)
    if not target_member:
        raise _Phase5BHTTPException(status_code=404, detail="Family member not found")

    row = _phase5b_set_permission(
        db=db,
        member_id=member_id,
        permission_key=permission_key,
        allow=payload.allow,
        scope=payload.scope,
    )

    return {
        "hardened": True,
        "phase": "5B",
        "family_id": family_id,
        "member_id": member_id,
        "permission_key": permission_key,
        "allow": _phase5b_bool(row.get("allow")),
        "scope": row.get("scope"),
    }


@router.post("/families/{family_id}/permissions/check")
def phase5b_check_permission(
    family_id: str,
    payload: Phase5BPermissionCheckRequest,
    db: _Phase5BSession = _Phase5BDepends(get_db),
    current_user: _Phase5BAny = _Phase5BDepends(get_current_user),
):
    member = _phase5b_require_family_member(db, family_id, current_user)
    allowed = _phase5b_has_permission(db, family_id, member, payload.permission_key)

    return {
        "hardened": True,
        "phase": "5B",
        "family_id": family_id,
        "member_id": member["id"],
        "permission_key": payload.permission_key,
        "allowed": allowed,
        "is_owner": _phase5b_is_owner(member),
    }


@router.post("/families/{family_id}/permissions/protected-action")
def phase5b_protected_action(
    family_id: str,
    payload: Phase5BPermissionCheckRequest,
    db: _Phase5BSession = _Phase5BDepends(get_db),
    current_user: _Phase5BAny = _Phase5BDepends(get_current_user),
):
    member = _phase5b_require_permission(db, family_id, current_user, payload.permission_key)

    return {
        "hardened": True,
        "phase": "5B",
        "family_id": family_id,
        "member_id": member["id"],
        "permission_key": payload.permission_key,
        "allowed": True,
    }

# === PHASE 5B RBAC / MEMBER PERMISSION HARDENING END ===

