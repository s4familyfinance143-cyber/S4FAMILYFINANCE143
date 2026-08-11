from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family_member import FamilyMember
from app.models.phase15 import Phase15Item
from app.models.user import User
from app.schemas.phase15 import Phase15ItemCloseRequest, Phase15ItemCreateRequest, Phase15ItemUpdateRequest
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission

router = APIRouter(prefix="/phase15", tags=["Phase 15 Modules (deprecated)"])

MONEY_SCALE = Decimal("0.0001")
VALID_MODULES = {"INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"}
DUE_SOON_DAYS = 30


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def clean_module(value: str) -> str:
    module_type = str(value or "").strip().upper()
    if module_type not in VALID_MODULES:
        raise HTTPException(400, "Invalid Phase 15 module type")
    return module_type


def clean_text(value: str | None, fallback: str | None = None) -> str | None:
    text = str(value or fallback or "").strip()
    return text if text else None


def clean_currency(value: str | None) -> str:
    return str(value or "BDT").strip().upper()[:10]


def parse_date(value: str | None) -> date | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def is_due_soon(*values: str | None) -> bool:
    today = date.today()
    cutoff = today + timedelta(days=DUE_SOON_DAYS)
    for value in values:
        parsed = parse_date(value)
        if parsed and today <= parsed <= cutoff:
            return True
    return False


def ensure_member(db: Session, family_id: str, member_id: str | None) -> str | None:
    if not member_id:
        return None
    member = (
        db.query(FamilyMember)
        .filter(FamilyMember.id == member_id, FamilyMember.family_id == family_id, FamilyMember.deleted_at.is_(None))
        .first()
    )
    if not member:
        raise HTTPException(400, "Invalid family member")
    return member.id


def validate_phase15_payload(module_type: str, payload, *, is_create: bool) -> None:
    if module_type == "INVESTMENT" and not clean_text(payload.sub_type):
        raise HTTPException(400, "Investment sub_type is required")
    if module_type in {"HEALTH", "EDUCATION"} and not clean_text(payload.member_id):
        raise HTTPException(400, f"{module_type.title()} member_id is required")


def apply_phase15_fields(item: Phase15Item, payload, db: Session, family_id: str) -> None:
    item.name = payload.name.strip()
    item.category = clean_text(payload.category, "GENERAL") or "GENERAL"
    item.sub_type = clean_text(payload.sub_type)
    item.provider = clean_text(payload.provider)
    item.member_id = ensure_member(db, family_id, clean_text(payload.member_id))
    item.amount = payload.amount
    item.secondary_amount = payload.secondary_amount
    item.target_date = clean_text(payload.target_date)
    item.secondary_date = clean_text(payload.secondary_date)
    item.note = clean_text(payload.note)


def item_response(item: Phase15Item) -> dict:
    return {
        "id": item.id,
        "family_id": item.family_id,
        "module_type": item.module_type,
        "name": item.name,
        "category": item.category,
        "sub_type": item.sub_type,
        "provider": item.provider,
        "member_id": item.member_id,
        "amount": money(item.amount),
        "secondary_amount": money(item.secondary_amount) if item.secondary_amount is not None else None,
        "currency": item.currency,
        "target_date": item.target_date,
        "secondary_date": item.secondary_date,
        "status": item.status,
        "note": item.note,
        "created_at": item.created_at,
    }


def module_summary_rows(items: list[Phase15Item], module_type: str) -> list[Phase15Item]:
    return [item for item in items if item.module_type == module_type and item.status == "ACTIVE"]


def build_module_summary(items: list[Phase15Item]) -> dict:
    modules = {}
    for module_type in VALID_MODULES:
        rows = module_summary_rows(items, module_type)
        modules[module_type] = {
            "active_count": len(rows),
            "total_amount": money(sum(Decimal(item.amount or 0) for item in rows)),
            "due_soon_count": sum(1 for item in rows if is_due_soon(item.target_date, item.secondary_date)),
        }
    return modules


def build_upcoming(items: list[Phase15Item]) -> list[dict]:
    upcoming = []
    for item in items:
        if item.status != "ACTIVE":
            continue
        due_date = item.target_date or item.secondary_date
        if not is_due_soon(due_date):
            continue
        upcoming.append(
            {
                "id": item.id,
                "module_type": item.module_type,
                "name": item.name,
                "due_date": due_date,
                "amount": money(item.amount),
                "currency": item.currency,
            }
        )
    upcoming.sort(key=lambda row: row.get("due_date") or "")
    return upcoming


def get_item(db: Session, family_id: str, item_id: str) -> Phase15Item:
    item = (
        db.query(Phase15Item)
        .filter(Phase15Item.id == item_id, Phase15Item.family_id == family_id, Phase15Item.deleted_at.is_(None))
        .first()
    )
    if not item:
        raise HTTPException(404, "Phase 15 item not found")
    return item


@router.post("", status_code=status.HTTP_201_CREATED)
def create_phase15_item(
    payload: Phase15ItemCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    module_type = clean_module(payload.module_type)
    validate_phase15_payload(module_type, payload, is_create=True)
    item = Phase15Item(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        module_type=module_type,
        currency=clean_currency(payload.currency),
        status="ACTIVE",
    )
    apply_phase15_fields(item, payload, db, payload.family_id)
    db.add(item)
    db.flush()
    try:
        from app.services.architecture_bridge import mirror_phase15_item

        mirror_phase15_item(db, item)
        db.flush()
    except Exception:
        pass

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type=f"PHASE15_{module_type}",
        entity_id=item.id,
        title=f"{module_type.title()} Item Created",
        description=f"{item.name} created for {money(item.amount)} {item.currency}",
    )

    db.commit()
    db.refresh(item)
    return item_response(item)


@router.get("/summary/{family_id}")
def phase15_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    items = db.query(Phase15Item).filter(Phase15Item.family_id == family_id, Phase15Item.deleted_at.is_(None)).all()
    modules = build_module_summary(items)
    return {
        "family_id": family_id,
        "total_items": len(items),
        "modules": modules,
        "upcoming": build_upcoming(items),
    }


@router.get("/upcoming/{family_id}")
def phase15_upcoming(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    items = (
        db.query(Phase15Item)
        .filter(Phase15Item.family_id == family_id, Phase15Item.deleted_at.is_(None), Phase15Item.status == "ACTIVE")
        .all()
    )
    return {"family_id": family_id, "items": build_upcoming(items)}


@router.get("/{family_id}")
def list_phase15_items(
    family_id: str,
    module_type: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    query = db.query(Phase15Item).filter(Phase15Item.family_id == family_id, Phase15Item.deleted_at.is_(None))
    if module_type:
        query = query.filter(Phase15Item.module_type == clean_module(module_type))
    return [item_response(item) for item in query.order_by(Phase15Item.created_at.desc()).all()]


@router.patch("/{item_id}")
def update_phase15_item(
    item_id: str,
    payload: Phase15ItemUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    item = get_item(db, payload.family_id, item_id)
    validate_phase15_payload(item.module_type, payload, is_create=False)
    apply_phase15_fields(item, payload, db, payload.family_id)
    try:
        from app.services.architecture_bridge import mirror_phase15_item

        mirror_phase15_item(db, item)
    except Exception:
        pass

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type=f"PHASE15_{item.module_type}",
        entity_id=item.id,
        title=f"{item.module_type.title()} Item Updated",
        description=item.name,
    )
    db.commit()
    db.refresh(item)
    return item_response(item)


@router.post("/{item_id}/close")
def close_phase15_item(
    item_id: str,
    payload: Phase15ItemCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    item = get_item(db, payload.family_id, item_id)
    item.status = "CLOSED"
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type=f"PHASE15_{item.module_type}",
        entity_id=item.id,
        title=f"{item.module_type.title()} Item Closed",
        description=payload.reason or item.name,
    )
    db.commit()
    db.refresh(item)
    return item_response(item)
