from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family_member import FamilyMember
from app.models.phase16 import Phase16Item
from app.models.user import User
from app.schemas.phase16 import Phase16ItemCloseRequest, Phase16ItemCreateRequest, Phase16ItemUpdateRequest
from app.services.audit_service import write_audit_log
from app.services.document_vault_service import (
    delete_document_file,
    ensure_s3_bucket,
    load_document_file,
    object_storage_status,
    store_document_file,
)
from app.services.permission_service import require_permission

router = APIRouter(prefix="/phase16", tags=["Phase 16 Modules (deprecated)"])

MONEY_SCALE = Decimal("0.0001")
VALID_MODULES = {"SUBSCRIPTION", "DOCUMENT", "PROPERTY"}
VALID_BILLING_CYCLES = {"MONTHLY", "YEARLY"}
DUE_SOON_DAYS = 30


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def clean_module(value: str) -> str:
    module_type = str(value or "").strip().upper()
    if module_type not in VALID_MODULES:
        raise HTTPException(400, "Invalid Phase 16 module type")
    return module_type


def clean_text(value: str | None, fallback: str | None = None) -> str | None:
    text = str(value or fallback or "").strip()
    return text if text else None


def clean_currency(value: str | None) -> str:
    return str(value or "BDT").strip().upper()[:10]


def clean_billing_cycle(value: str | None) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    cycle = text.upper()
    if cycle not in VALID_BILLING_CYCLES:
        raise HTTPException(400, "Invalid billing cycle")
    return cycle


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


def validate_phase16_payload(module_type: str, payload) -> None:
    if module_type == "SUBSCRIPTION":
        if not clean_billing_cycle(payload.billing_cycle):
            raise HTTPException(400, "Subscription billing_cycle is required")
        if not clean_text(payload.renewal_or_expiry_date):
            raise HTTPException(400, "Subscription renewal_or_expiry_date is required")
    if module_type == "DOCUMENT":
        if not clean_text(payload.sub_type):
            raise HTTPException(400, "Document sub_type is required")
        if not clean_text(payload.renewal_or_expiry_date):
            raise HTTPException(400, "Document renewal_or_expiry_date is required")
    if module_type == "PROPERTY" and not clean_text(payload.sub_type):
        raise HTTPException(400, "Property sub_type is required")


def apply_phase16_fields(item: Phase16Item, payload, db: Session, family_id: str) -> None:
    item.name = payload.name.strip()
    item.category = clean_text(payload.category, "GENERAL") or "GENERAL"
    item.sub_type = clean_text(payload.sub_type)
    item.provider = clean_text(payload.provider)
    item.member_id = ensure_member(db, family_id, clean_text(payload.member_id))
    item.amount = payload.amount
    item.secondary_amount = payload.secondary_amount
    item.renewal_or_expiry_date = clean_text(payload.renewal_or_expiry_date)
    item.secondary_date = clean_text(payload.secondary_date)
    item.billing_cycle = clean_billing_cycle(payload.billing_cycle)
    item.payment_account_id = clean_text(payload.payment_account_id)
    item.reference = clean_text(payload.reference)
    item.note = clean_text(payload.note)


def monthly_subscription_amount(item: Phase16Item) -> Decimal:
    amount = Decimal(item.amount or 0)
    if item.billing_cycle == "YEARLY":
        return amount / Decimal("12")
    return amount


def item_response(item: Phase16Item) -> dict:
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
        "renewal_or_expiry_date": item.renewal_or_expiry_date,
        "secondary_date": item.secondary_date,
        "billing_cycle": item.billing_cycle,
        "payment_account_id": item.payment_account_id,
        "reference": item.reference,
        "status": item.status,
        "note": item.note,
        "file_name": getattr(item, "file_name", None),
        "file_mime": getattr(item, "file_mime", None),
        "file_size": getattr(item, "file_size", None),
        "file_sha256": getattr(item, "file_sha256", None),
        "file_encrypted": bool(getattr(item, "file_encrypted", False)),
        "has_file": bool(getattr(item, "file_path", None)),
        "created_at": item.created_at,
    }


def module_summary_rows(items: list[Phase16Item], module_type: str) -> list[Phase16Item]:
    return [item for item in items if item.module_type == module_type and item.status == "ACTIVE"]


def build_module_summary(items: list[Phase16Item]) -> dict:
    modules = {}
    for module_type in VALID_MODULES:
        rows = module_summary_rows(items, module_type)
        summary = {
            "active_count": len(rows),
            "total_amount": money(sum(Decimal(item.amount or 0) for item in rows)),
            "due_soon_count": sum(
                1 for item in rows if is_due_soon(item.renewal_or_expiry_date, item.secondary_date)
            ),
        }
        if module_type == "SUBSCRIPTION":
            summary["monthly_cost_total"] = money(sum(monthly_subscription_amount(item) for item in rows))
        modules[module_type] = summary
    return modules


def build_upcoming(items: list[Phase16Item]) -> list[dict]:
    upcoming = []
    for item in items:
        if item.status != "ACTIVE":
            continue
        due_date = item.renewal_or_expiry_date or item.secondary_date
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


def get_item(db: Session, family_id: str, item_id: str) -> Phase16Item:
    item = (
        db.query(Phase16Item)
        .filter(Phase16Item.id == item_id, Phase16Item.family_id == family_id, Phase16Item.deleted_at.is_(None))
        .first()
    )
    if not item:
        raise HTTPException(404, "Phase 16 item not found")
    return item


@router.post("", status_code=status.HTTP_201_CREATED)
def create_phase16_item(payload: Phase16ItemCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    module_type = clean_module(payload.module_type)
    validate_phase16_payload(module_type, payload)
    item = Phase16Item(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        module_type=module_type,
        currency=clean_currency(payload.currency),
        status="ACTIVE",
    )
    apply_phase16_fields(item, payload, db, payload.family_id)
    db.add(item)
    db.flush()
    try:
        from app.services.architecture_bridge import mirror_phase16_item

        mirror_phase16_item(db, item)
        db.flush()
    except Exception:
        pass
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type=f"PHASE16_{module_type}",
        entity_id=item.id,
        title=f"{module_type.title()} Item Created",
        description=f"{item.name} created",
    )
    db.commit()
    db.refresh(item)
    return item_response(item)


@router.get("/summary/{family_id}")
def phase16_summary(family_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db, family_id, current_user.id, "report.read")
    items = db.query(Phase16Item).filter(Phase16Item.family_id == family_id, Phase16Item.deleted_at.is_(None)).all()
    modules = build_module_summary(items)
    return {
        "family_id": family_id,
        "total_items": len(items),
        "modules": modules,
        "upcoming": build_upcoming(items),
    }


@router.get("/upcoming/{family_id}")
def phase16_upcoming(family_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db, family_id, current_user.id, "report.read")
    items = (
        db.query(Phase16Item)
        .filter(Phase16Item.family_id == family_id, Phase16Item.deleted_at.is_(None), Phase16Item.status == "ACTIVE")
        .all()
    )
    return {"family_id": family_id, "items": build_upcoming(items)}


@router.get("/vault-status")
def phase16_vault_status(current_user: User = Depends(get_current_user)):
    _ = current_user
    return object_storage_status()


@router.post("/vault-ensure-bucket")
def phase16_vault_ensure_bucket(current_user: User = Depends(get_current_user)):
    _ = current_user
    return ensure_s3_bucket()


@router.get("/{family_id}")
def list_phase16_items(family_id: str, module_type: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_permission(db, family_id, current_user.id, "report.read")
    query = db.query(Phase16Item).filter(Phase16Item.family_id == family_id, Phase16Item.deleted_at.is_(None))
    if module_type:
        query = query.filter(Phase16Item.module_type == clean_module(module_type))
    return [item_response(item) for item in query.order_by(Phase16Item.created_at.desc()).all()]


@router.patch("/{item_id}")
def update_phase16_item(item_id: str, payload: Phase16ItemUpdateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    item = get_item(db, payload.family_id, item_id)
    validate_phase16_payload(item.module_type, payload)
    apply_phase16_fields(item, payload, db, payload.family_id)
    try:
        from app.services.architecture_bridge import mirror_phase16_item

        mirror_phase16_item(db, item)
    except Exception:
        pass
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type=f"PHASE16_{item.module_type}",
        entity_id=item.id,
        title=f"{item.module_type.title()} Item Updated",
        description=item.name,
    )
    db.commit()
    db.refresh(item)
    return item_response(item)


@router.post("/{item_id}/close")
def close_phase16_item(item_id: str, payload: Phase16ItemCloseRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    item = get_item(db, payload.family_id, item_id)
    item.status = "CLOSED"
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type=f"PHASE16_{item.module_type}",
        entity_id=item.id,
        title=f"{item.module_type.title()} Item Closed",
        description=payload.reason or item.name,
    )
    db.commit()
    db.refresh(item)
    return item_response(item)


@router.post("/{item_id}/upload")
async def upload_phase16_document(
    item_id: str,
    family_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, family_id, current_user.id, "report.read")
    item = get_item(db, family_id, item_id)
    if item.module_type != "DOCUMENT":
        raise HTTPException(400, "File upload is only allowed for DOCUMENT items")

    data = await file.read()
    try:
        stored = store_document_file(
            family_id=family_id,
            item_id=item.id,
            filename=file.filename or "document.bin",
            content_type=file.content_type,
            data=data,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc

    previous_path = item.file_path
    item.file_name = stored["file_name"]
    item.file_path = stored["file_path"]
    item.file_mime = stored["file_mime"]
    item.file_size = stored["file_size"]
    item.file_sha256 = stored["file_sha256"]
    item.file_encrypted = stored["file_encrypted"]

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=member.id,
        action_type="UPLOAD",
        entity_type="PHASE16_DOCUMENT",
        entity_id=item.id,
        title="Document File Uploaded",
        description=f"{item.name}: {item.file_name} ({item.file_size} bytes)",
    )
    db.commit()
    db.refresh(item)

    if previous_path and previous_path != item.file_path:
        delete_document_file(previous_path)

    return item_response(item)


@router.get("/{item_id}/download")
def download_phase16_document(
    item_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    item = get_item(db, family_id, item_id)
    if item.module_type != "DOCUMENT":
        raise HTTPException(400, "Download is only available for DOCUMENT items")
    if not item.file_path:
        raise HTTPException(404, "No file attached to this document")

    try:
        data = load_document_file(item.file_path, expected_sha256=item.file_sha256)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{item.file_name or "document.bin"}"',
    }
    return Response(content=data, media_type=item.file_mime or "application/octet-stream", headers=headers)
