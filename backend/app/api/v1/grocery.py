from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.dependencies import get_current_user
from app.core.security import decode_token
from app.models.grocery import GroceryItem, GroceryList, GroceryVendor
from app.models.architecture_feature import GroceryListItem, VendorContact
from app.models.audit_log import AuditLog
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.grocery import (
    GroceryItemBuyRequest,
    GroceryItemCreateRequest,
    GroceryItemUpdateRequest,
    GroceryListCreateRequest,
    GroceryListUpdateRequest,
    GroceryOcrParseRequest,
    GroceryPostExpenseRequest,
    GroceryVendorCreateRequest,
    GroceryVendorUpdateRequest,
)
from app.api.v1.transactions import (
    get_account_or_404,
    get_category_or_404,
    normalize_currency,
    require_same_currency,
    require_wallet_access,
    validate_amount,
)
from app.services.audit_service import write_audit_log
from app.services import accounting_service
from app.services.grocery_realtime import grocery_realtime_hub, publish_grocery_event
from app.services.permission_service import require_permission

router = APIRouter(prefix="/grocery", tags=["Grocery"])

MONEY_SCALE = Decimal("0.0001")


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def clean_text(value: str | None, fallback: str | None = None) -> str | None:
    text = str(value or fallback or "").strip()
    return text if text else None


def clean_currency(value: str | None) -> str:
    return str(value or "BDT").strip().upper()[:10]


def list_response(row: GroceryList) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "name": row.name,
        "title": row.name,  # compat alias for older clients
        "status": row.status,
        "budget_amount": money(row.budget_amount),
        "currency": row.currency,
        "vendor_name": row.vendor_name,
        "shopping_date": row.shopping_date,
        "mobile_sync_key": row.mobile_sync_key,
        "sync_version": row.sync_version,
        "last_client_updated_at": row.last_client_updated_at,
        "note": row.note,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def item_response(row: GroceryItem) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "grocery_list_id": row.grocery_list_id,
        "posted_transaction_id": row.posted_transaction_id,
        "name": row.name,
        "category": row.category,
        "quantity": money(row.quantity),
        "unit": row.unit,
        "estimated_price": money(row.estimated_price),
        "actual_price": money(row.actual_price),
        "vendor_name": row.vendor_name,
        "barcode": row.barcode,
        "mobile_sync_key": row.mobile_sync_key,
        "sync_version": row.sync_version,
        "last_client_updated_at": row.last_client_updated_at,
        "is_bought": row.is_bought,
        "note": row.note,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def vendor_response(row: GroceryVendor) -> dict:
    return {
        "id": row.id,
        "family_id": row.family_id,
        "name": row.name,
        "phone": row.phone,
        "address": row.address,
        "category": row.category,
        "note": row.note,
        "is_active": row.is_active,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _dual_write_vendor(db: Session, vendor: GroceryVendor) -> None:
    """Mirror a newly created GroceryVendor into architecture checklist vendor_contacts."""
    existing = (
        db.query(VendorContact)
        .filter(VendorContact.legacy_grocery_vendor_id == vendor.id, VendorContact.deleted_at.is_(None))
        .first()
    )
    if existing:
        return
    db.add(
        VendorContact(
            family_id=vendor.family_id,
            name=vendor.name,
            phone=vendor.phone,
            address=vendor.address,
            category=vendor.category or "GENERAL",
            notes=vendor.note,
            is_active=vendor.is_active,
            legacy_grocery_vendor_id=vendor.id,
        )
    )


def _dual_write_grocery_item(db: Session, item: GroceryItem) -> None:
    """Mirror a newly created GroceryItem into architecture checklist grocery_list_items."""
    existing = (
        db.query(GroceryListItem)
        .filter(GroceryListItem.legacy_grocery_item_id == item.id, GroceryListItem.deleted_at.is_(None))
        .first()
    )
    if existing:
        return
    db.add(
        GroceryListItem(
            family_id=item.family_id,
            list_id=item.grocery_list_id,
            created_by_member_id=item.created_by_member_id,
            name=item.name,
            qty=item.quantity,
            unit=item.unit,
            unit_price=item.actual_price or item.estimated_price or Decimal("0"),
            is_bought=item.is_bought,
            barcode=item.barcode,
            category=item.category or "GENERAL",
            mobile_sync_key=item.mobile_sync_key,
            legacy_grocery_item_id=item.id,
        )
    )


def get_list(db: Session, family_id: str, list_id: str) -> GroceryList:
    row = (
        db.query(GroceryList)
        .filter(GroceryList.id == list_id, GroceryList.family_id == family_id, GroceryList.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Grocery list not found")
    return row


def get_item(db: Session, family_id: str, item_id: str) -> GroceryItem:
    row = (
        db.query(GroceryItem)
        .filter(GroceryItem.id == item_id, GroceryItem.family_id == family_id, GroceryItem.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Grocery item not found")
    return row


def get_vendor(db: Session, family_id: str, vendor_id: str) -> GroceryVendor:
    row = (
        db.query(GroceryVendor)
        .filter(GroceryVendor.id == vendor_id, GroceryVendor.family_id == family_id, GroceryVendor.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Grocery vendor not found")
    return row


def require_expected_version(row, expected_sync_version: int | None) -> None:
    if expected_sync_version is not None and row.sync_version != expected_sync_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SYNC_CONFLICT",
                "message": "Grocery record changed after the client copy was made.",
                "server_sync_version": row.sync_version,
                "server_updated_at": row.updated_at,
            },
        )


def bump_sync(row, client_updated_at: str | None = None) -> None:
    row.sync_version = int(row.sync_version or 0) + 1
    row.last_client_updated_at = clean_text(client_updated_at)


@router.post("/vendors", status_code=status.HTTP_201_CREATED)
def create_grocery_vendor(
    payload: GroceryVendorCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = GroceryVendor(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        name=payload.name.strip(),
        phone=clean_text(payload.phone),
        address=clean_text(payload.address),
        category=clean_text(payload.category, "GENERAL") or "GENERAL",
        note=clean_text(payload.note),
    )
    db.add(row)
    db.flush()
    _dual_write_vendor(db, row)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="GROCERY_VENDOR",
        entity_id=row.id,
        title="Grocery Vendor Created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="CREATE", entity_type="GROCERY_VENDOR", entity_id=row.id, title=row.name)
    return vendor_response(row)


@router.get("/vendors/{family_id}")
def list_grocery_vendors(
    family_id: str,
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    query = db.query(GroceryVendor).filter(GroceryVendor.family_id == family_id, GroceryVendor.deleted_at.is_(None))
    if active_only:
        query = query.filter(GroceryVendor.is_active.is_(True))
    return [vendor_response(row) for row in query.order_by(GroceryVendor.name.asc()).all()]


@router.patch("/vendors/{vendor_id}")
def update_grocery_vendor(
    vendor_id: str,
    payload: GroceryVendorUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = get_vendor(db, payload.family_id, vendor_id)
    row.name = payload.name.strip()
    row.phone = clean_text(payload.phone)
    row.address = clean_text(payload.address)
    row.category = clean_text(payload.category, "GENERAL") or "GENERAL"
    row.note = clean_text(payload.note)
    row.is_active = payload.is_active
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="GROCERY_VENDOR",
        entity_id=row.id,
        title="Grocery Vendor Updated",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="UPDATE", entity_type="GROCERY_VENDOR", entity_id=row.id, title=row.name)
    return vendor_response(row)


@router.post("/vendors/{vendor_id}/deactivate")
def deactivate_grocery_vendor(
    vendor_id: str,
    payload: GroceryVendorUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = get_vendor(db, payload.family_id, vendor_id)
    row.is_active = False
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="DEACTIVATE",
        entity_type="GROCERY_VENDOR",
        entity_id=row.id,
        title="Grocery Vendor Deactivated",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="DEACTIVATE", entity_type="GROCERY_VENDOR", entity_id=row.id, title=row.name)
    return vendor_response(row)


@router.post("/lists", status_code=status.HTTP_201_CREATED)
def create_grocery_list(
    payload: GroceryListCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    mobile_sync_key = clean_text(payload.mobile_sync_key)
    if mobile_sync_key:
        existing = (
            db.query(GroceryList)
            .filter(
                GroceryList.family_id == payload.family_id,
                GroceryList.mobile_sync_key == mobile_sync_key,
                GroceryList.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            return list_response(existing)

    try:
        list_name = payload.resolved_name()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    row = GroceryList(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        name=list_name,
        budget_amount=payload.budget_amount,
        currency=clean_currency(payload.currency),
        vendor_name=clean_text(payload.vendor_name),
        shopping_date=clean_text(payload.shopping_date),
        mobile_sync_key=mobile_sync_key,
        last_client_updated_at=clean_text(payload.client_updated_at),
        note=clean_text(payload.note),
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="GROCERY_LIST",
        entity_id=row.id,
        title="Grocery List Created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="CREATE", entity_type="GROCERY_LIST", entity_id=row.id, title=row.name)
    return list_response(row)


@router.get("/lists/{family_id}")
def list_grocery_lists(
    family_id: str,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    query = db.query(GroceryList).filter(GroceryList.family_id == family_id, GroceryList.deleted_at.is_(None))
    if status_filter:
        query = query.filter(GroceryList.status == status_filter.strip().upper())
    return [list_response(row) for row in query.order_by(GroceryList.created_at.desc()).all()]


@router.patch("/lists/{list_id}")
def update_grocery_list(
    list_id: str,
    payload: GroceryListUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = get_list(db, payload.family_id, list_id)
    require_expected_version(row, payload.expected_sync_version)
    try:
        row.name = payload.resolved_name()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row.budget_amount = payload.budget_amount
    row.currency = clean_currency(payload.currency)
    row.vendor_name = clean_text(payload.vendor_name)
    row.shopping_date = clean_text(payload.shopping_date)
    bump_sync(row, payload.client_updated_at)
    row.note = clean_text(payload.note)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="GROCERY_LIST",
        entity_id=row.id,
        title="Grocery List Updated",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="UPDATE", entity_type="GROCERY_LIST", entity_id=row.id, title=row.name)
    return list_response(row)


@router.post("/lists/{list_id}/close")
def close_grocery_list(
    list_id: str,
    payload: GroceryListUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = get_list(db, payload.family_id, list_id)
    require_expected_version(row, payload.expected_sync_version)
    row.status = "CLOSED"
    bump_sync(row, payload.client_updated_at)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CLOSE",
        entity_type="GROCERY_LIST",
        entity_id=row.id,
        title="Grocery List Closed",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="CLOSE", entity_type="GROCERY_LIST", entity_id=row.id, title=row.name)
    return list_response(row)


@router.post("/items", status_code=status.HTTP_201_CREATED)
def create_grocery_item(
    payload: GroceryItemCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    get_list(db, payload.family_id, payload.grocery_list_id)
    mobile_sync_key = clean_text(payload.mobile_sync_key)
    if mobile_sync_key:
        existing = (
            db.query(GroceryItem)
            .filter(
                GroceryItem.family_id == payload.family_id,
                GroceryItem.mobile_sync_key == mobile_sync_key,
                GroceryItem.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            return item_response(existing)

    row = GroceryItem(
        family_id=payload.family_id,
        grocery_list_id=payload.grocery_list_id,
        created_by_member_id=member.id,
        name=payload.name.strip(),
        category=clean_text(payload.category, "GENERAL") or "GENERAL",
        quantity=payload.quantity,
        unit=clean_text(payload.unit, "pcs") or "pcs",
        estimated_price=payload.estimated_price,
        actual_price=payload.actual_price,
        vendor_name=clean_text(payload.vendor_name),
        barcode=clean_text(payload.barcode),
        mobile_sync_key=mobile_sync_key,
        last_client_updated_at=clean_text(payload.client_updated_at),
        note=clean_text(payload.note),
    )
    db.add(row)
    db.flush()
    _dual_write_grocery_item(db, row)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="GROCERY_ITEM",
        entity_id=row.id,
        title="Grocery Item Created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="CREATE", entity_type="GROCERY_ITEM", entity_id=row.id, title=row.name)
    return item_response(row)


@router.get("/lists/{family_id}/{list_id}/items")
def list_grocery_items(
    family_id: str,
    list_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    get_list(db, family_id, list_id)
    rows = (
        db.query(GroceryItem)
        .filter(GroceryItem.family_id == family_id, GroceryItem.grocery_list_id == list_id, GroceryItem.deleted_at.is_(None))
        .order_by(GroceryItem.is_bought.asc(), GroceryItem.created_at.desc())
        .all()
    )
    return [item_response(row) for row in rows]


@router.get("/lists/{family_id}/{list_id}/budget-compare")
def grocery_budget_compare(
    family_id: str,
    list_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Architecture grocery: budget vs estimated/actual spend comparison."""
    require_permission(db, family_id, current_user.id, "report.read")
    glist = get_list(db, family_id, list_id)
    items = (
        db.query(GroceryItem)
        .filter(
            GroceryItem.family_id == family_id,
            GroceryItem.grocery_list_id == list_id,
            GroceryItem.deleted_at.is_(None),
        )
        .all()
    )
    estimated = Decimal("0")
    actual = Decimal("0")
    bought_count = 0
    for row in items:
        est = Decimal(row.estimated_price or 0) * Decimal(row.quantity or 1)
        estimated += est
        if row.is_bought:
            bought_count += 1
            actual += Decimal(row.actual_price or row.estimated_price or 0) * Decimal(row.quantity or 1)

    budget = Decimal(glist.budget_amount or 0)
    spent_for_compare = actual if bought_count else estimated
    remaining = budget - spent_for_compare if budget > 0 else None
    used_pct = None
    if budget > 0:
        used_pct = (spent_for_compare / budget * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "list_id": list_id,
        "family_id": family_id,
        "budget_amount": money(budget),
        "estimated_total": money(estimated),
        "actual_total": money(actual),
        "compare_amount": money(spent_for_compare),
        "remaining_amount": money(remaining) if remaining is not None else None,
        "used_percent": str(used_pct) if used_pct is not None else None,
        "over_budget": bool(budget > 0 and spent_for_compare > budget),
        "item_count": len(items),
        "bought_count": bought_count,
        "currency": glist.currency or "BDT",
    }


@router.get("/price-history/{family_id}")
def grocery_price_history(
    family_id: str,
    name: str | None = None,
    limit: int = 25,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    query = db.query(GroceryItem).filter(
        GroceryItem.family_id == family_id,
        GroceryItem.deleted_at.is_(None),
        GroceryItem.is_bought.is_(True),
    )
    if name:
        query = query.filter(func.lower(GroceryItem.name) == name.strip().lower())
    rows = query.order_by(GroceryItem.updated_at.desc()).limit(max(1, min(limit, 100))).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "category": row.category,
            "quantity": money(row.quantity),
            "unit": row.unit,
            "actual_price": money(row.actual_price),
            "vendor_name": row.vendor_name,
            "barcode": row.barcode,
            "bought_at": row.updated_at,
        }
        for row in rows
    ]


@router.get("/vendor-summary/{family_id}")
def grocery_vendor_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    rows = (
        db.query(
            GroceryItem.vendor_name,
            func.count(GroceryItem.id),
            func.sum(GroceryItem.actual_price),
        )
        .filter(
            GroceryItem.family_id == family_id,
            GroceryItem.deleted_at.is_(None),
            GroceryItem.is_bought.is_(True),
            GroceryItem.vendor_name.isnot(None),
        )
        .group_by(GroceryItem.vendor_name)
        .order_by(func.sum(GroceryItem.actual_price).desc())
        .all()
    )
    return [
        {
            "vendor_name": vendor_name,
            "bought_count": count,
            "total_spent": money(total_spent),
        }
        for vendor_name, count, total_spent in rows
    ]


@router.get("/barcode/{family_id}/{barcode}")
def grocery_barcode_lookup(
    family_id: str,
    barcode: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    code = barcode.strip()
    if not code:
        raise HTTPException(400, "Barcode required")
    rows = (
        db.query(GroceryItem)
        .filter(GroceryItem.family_id == family_id, GroceryItem.barcode == code, GroceryItem.deleted_at.is_(None))
        .order_by(GroceryItem.updated_at.desc())
        .limit(10)
        .all()
    )
    latest = rows[0] if rows else None
    return {
        "family_id": family_id,
        "barcode": code,
        "found": latest is not None,
        "latest": item_response(latest) if latest else None,
        "history": [item_response(row) for row in rows],
    }


@router.post("/ocr/parse")
def grocery_ocr_parse(
    payload: GroceryOcrParseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, payload.family_id, current_user.id, "report.read")
    from app.services.ocr_service import grocery_ocr_parse as run_ocr

    if not (payload.raw_text or "").strip():
        raise HTTPException(422, "raw_text required (or use /ocr/parse-image)")
    result = run_ocr(raw_text=payload.raw_text or "")
    return {
        "family_id": payload.family_id,
        **result,
    }


@router.post("/ocr/parse-image")
async def grocery_ocr_parse_image(
    family_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    from app.services.ocr_service import grocery_ocr_parse as run_ocr

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(422, "Empty image")
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 8MB)")
    result = run_ocr(raw_text="", image_bytes=image_bytes)
    return {
        "family_id": family_id,
        "filename": file.filename,
        **result,
    }


@router.get("/activity/{family_id}")
def grocery_activity(
    family_id: str,
    limit: int = 25,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.family_id == family_id, AuditLog.entity_type.like("GROCERY%"))
        .order_by(AuditLog.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [
        {
            "id": row.id,
            "action_type": row.action_type,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "title": row.title,
            "description": row.description,
            "member_id": row.member_id,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.get("/collaboration/status/{family_id}")
def grocery_collaboration_status(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")
    open_lists = (
        db.query(func.count(GroceryList.id))
        .filter(GroceryList.family_id == family_id, GroceryList.deleted_at.is_(None), GroceryList.status == "OPEN")
        .scalar()
        or 0
    )
    pending_items = (
        db.query(func.count(GroceryItem.id))
        .filter(GroceryItem.family_id == family_id, GroceryItem.deleted_at.is_(None), GroceryItem.is_bought.is_(False))
        .scalar()
        or 0
    )
    recent_activity = (
        db.query(func.count(AuditLog.id))
        .filter(AuditLog.family_id == family_id, AuditLog.entity_type.like("GROCERY%"))
        .scalar()
        or 0
    )
    return {
        "family_id": family_id,
        "mode": "websocket+polling",
        "realtime_transport": "websocket",
        "websocket_path": f"/grocery/ws/{family_id}",
        "subscribers": grocery_realtime_hub.subscriber_count(family_id),
        "open_lists": open_lists,
        "pending_items": pending_items,
        "activity_count": recent_activity,
    }


@router.websocket("/ws/{family_id}")
async def grocery_family_websocket(
    websocket: WebSocket,
    family_id: str,
    token: str = Query(...),
):
    db = SessionLocal()
    try:
        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                await websocket.close(code=4401)
                return
            user_id = str(payload.get("sub") or "")
            user = db.get(User, user_id) if user_id else None
            if not user or not user.is_active:
                await websocket.close(code=4401)
                return
            require_permission(db, family_id, user.id, "report.read")
        except (JWTError, HTTPException, Exception):
            await websocket.close(code=4403)
            return

        await grocery_realtime_hub.connect(family_id, websocket)
        await websocket.send_json(
            {
                "type": "grocery.subscribed",
                "family_id": family_id,
                "subscribers": grocery_realtime_hub.subscriber_count(family_id),
            }
        )
        while True:
            # Keepalive / ignore client pings; server pushes grocery.changed events
            message = await websocket.receive_text()
            if message.strip().lower() in {"ping", "heartbeat"}:
                await websocket.send_json({"type": "pong", "family_id": family_id})
    except WebSocketDisconnect:
        pass
    finally:
        await grocery_realtime_hub.disconnect(family_id, websocket)
        db.close()


@router.patch("/items/{item_id}")
def update_grocery_item(
    item_id: str,
    payload: GroceryItemUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = get_item(db, payload.family_id, item_id)
    require_expected_version(row, payload.expected_sync_version)
    row.name = payload.name.strip()
    row.category = clean_text(payload.category, "GENERAL") or "GENERAL"
    row.quantity = payload.quantity
    row.unit = clean_text(payload.unit, "pcs") or "pcs"
    row.estimated_price = payload.estimated_price
    row.actual_price = payload.actual_price
    row.vendor_name = clean_text(payload.vendor_name)
    row.barcode = clean_text(payload.barcode)
    bump_sync(row, payload.client_updated_at)
    row.note = clean_text(payload.note)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="GROCERY_ITEM",
        entity_id=row.id,
        title="Grocery Item Updated",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="UPDATE", entity_type="GROCERY_ITEM", entity_id=row.id, title=row.name)
    return item_response(row)


@router.put("/items/{item_id}/buy")
def mark_grocery_item_bought(
    item_id: str,
    payload: GroceryItemBuyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")
    row = get_item(db, payload.family_id, item_id)
    require_expected_version(row, payload.expected_sync_version)
    row.is_bought = True
    row.actual_price = payload.actual_price
    if payload.vendor_name is not None:
        row.vendor_name = clean_text(payload.vendor_name)
    bump_sync(row, payload.client_updated_at)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="UPDATE",
        entity_type="GROCERY_ITEM",
        entity_id=row.id,
        title="Grocery Item Bought",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    publish_grocery_event(payload.family_id, action="BUY", entity_type="GROCERY_ITEM", entity_id=row.id, title=row.name)
    return item_response(row)


@router.post("/items/{item_id}/post-expense", status_code=status.HTTP_201_CREATED)
def post_grocery_item_expense(
    item_id: str,
    payload: GroceryPostExpenseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(
        db=db,
        family_id=payload.family_id,
        user_id=current_user.id,
        permission="expense.create",
    )
    row = get_item(db, payload.family_id, item_id)
    if not row.is_bought:
        raise HTTPException(400, "Grocery item must be marked bought before posting expense")
    if row.posted_transaction_id:
        raise HTTPException(400, "Grocery item already posted as expense")

    amount = validate_amount(payload.amount or row.actual_price)
    if amount <= Decimal("0"):
        raise HTTPException(400, "Bought grocery item needs a positive actual price")

    account = get_account_or_404(db, payload.family_id, payload.account_id)
    require_wallet_access(member, account)
    currency = normalize_currency(account.currency)
    require_same_currency(account.currency, currency)
    category = get_category_or_404(db, payload.family_id, payload.category_id, "EXPENSE")
    current_balance = Decimal(account.current_balance or 0)
    if current_balance < amount:
        raise HTTPException(400, f"Insufficient wallet balance. Available={money(current_balance)}, Requested={money(amount)}")

    description = clean_text(payload.description) or f"Grocery expense: {row.name}"
    try:
        tx = accounting_service.post_expense(
            db,
            family_id=payload.family_id,
            member_id=member.id,
            account_id=account.id,
            category_id=category.id,
            amount=amount,
            currency=currency,
            description=description,
            expense_account_name="Grocery Expense",
            commit=False,
        )
        db.refresh(account)
        row.posted_transaction_id = tx.id
        write_audit_log(
            db=db,
            family_id=payload.family_id,
            member_id=member.id,
            action_type="CREATE",
            entity_type="GROCERY_EXPENSE",
            entity_id=tx.id,
            title="Grocery Expense Posted",
            description=f"{row.name} posted for {money(amount)} {currency}",
        )
        db.commit()
        db.refresh(tx)
        db.refresh(row)
        publish_grocery_event(payload.family_id, action="POST_EXPENSE", entity_type="GROCERY_EXPENSE", entity_id=tx.id, title=row.name)
        return {"transaction_id": tx.id, "grocery_item": item_response(row), "wallet_balance": money(account.current_balance)}
    except Exception:
        db.rollback()
        raise
