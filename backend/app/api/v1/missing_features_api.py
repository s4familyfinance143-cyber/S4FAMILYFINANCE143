"""MISSING feature APIs: split expense, metal rates, vehicles, health budget, property repair."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family_member import FamilyMember
from app.models.missing_features import (
    ExpenseSplit,
    HealthAnnualBudget,
    MetalRate,
    PropertyRepair,
    Vehicle,
)
from app.models.architecture_modules import HealthExpense, Property, VehicleExpense
from app.models.transaction import Transaction
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.services.document_vault_service import store_document_file
from app.services.permission_service import require_permission
from app.services.finance_posting import post_expense_flush

router = APIRouter(tags=["Missing Features"])
MONEY = Decimal("0.0001")

# Standard gold/silver nisab weights (grams) used when auto-computing nisab from rates
GOLD_NISAB_GRAMS = Decimal("87.48")
SILVER_NISAB_GRAMS = Decimal("612.36")


def money(v) -> str:
    return str(Decimal(v or 0).quantize(MONEY, rounding=ROUND_HALF_UP))


def _money_d(v) -> Decimal:
    return Decimal(v or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


# ---------- schemas ----------
class SplitShareIn(BaseModel):
    member_id: str
    share_amount: Decimal | None = None
    share_percent: Decimal | None = None


class SplitExpenseIn(BaseModel):
    family_id: str
    account_id: str
    category_id: str
    amount: Decimal = Field(gt=0)
    currency: str = "BDT"
    description: str | None = None
    splits: list[SplitShareIn] = Field(min_length=1)
    client_request_id: str | None = None


class MetalRateIn(BaseModel):
    metal: str = Field(pattern="^(GOLD|SILVER|gold|silver)$")
    rate_bdt: Decimal = Field(gt=0)
    unit: str = "GRAM"
    effective_date: str | None = None
    source: str | None = None


class VehicleIn(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    vehicle_type: str = "CAR"
    registration_no: str | None = None
    current_km: Decimal = Decimal("0")
    currency: str = "BDT"
    notes: str | None = None


class HealthBudgetIn(BaseModel):
    family_id: str
    year: str = Field(min_length=4, max_length=10)
    budget_amount: Decimal = Field(ge=0)
    member_id: str | None = None
    currency: str = "BDT"
    notes: str | None = None


class PropertyRepairIn(BaseModel):
    family_id: str
    property_id: str
    title: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(ge=0)
    repair_date: str | None = None
    currency: str = "BDT"
    notes: str | None = None


# ---------- split expense ----------
@router.post("/expenses/split", status_code=status.HTTP_201_CREATED)
def create_split_expense(
    payload: SplitExpenseIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "expense.create")
    total = _money_d(payload.amount)
    if not payload.splits:
        raise HTTPException(400, "At least one split share is required")

    computed: list[tuple[str, Decimal, Decimal | None]] = []
    running = Decimal("0")
    for share in payload.splits:
        mid = share.member_id.strip()
        exists = (
            db.query(FamilyMember)
            .filter(
                FamilyMember.id == mid,
                FamilyMember.family_id == payload.family_id,
                FamilyMember.deleted_at.is_(None),
            )
            .first()
        )
        if not exists:
            raise HTTPException(400, f"Invalid member_id in splits: {mid}")

        if share.share_amount is not None:
            amt = _money_d(share.share_amount)
            pct = (amt / total * Decimal("100")).quantize(Decimal("0.0001")) if total else Decimal("0")
        elif share.share_percent is not None:
            pct = Decimal(share.share_percent)
            amt = _money_d(total * pct / Decimal("100"))
        else:
            raise HTTPException(400, "Each split needs share_amount or share_percent")
        computed.append((mid, amt, pct))
        running += amt

    # Fix last share for rounding so sum == total
    diff = _money_d(total - running)
    if abs(diff) > Decimal("0.01"):
        raise HTTPException(400, f"Split amounts must sum to expense amount (diff={money(diff)})")
    if diff != 0 and computed:
        mid, amt, pct = computed[-1]
        computed[-1] = (mid, _money_d(amt + diff), pct)

    tx = post_expense_flush(
        db,
        family_id=payload.family_id,
        member_id=member.id,
        account_id=payload.account_id,
        category_id=payload.category_id,
        amount=total,
        currency=(payload.currency or "BDT").upper()[:10],
        description=payload.description,
        client_request_id=payload.client_request_id,
    )
    tx.is_split = True

    split_rows = []
    for mid, amt, pct in computed:
        row = ExpenseSplit(
            family_id=payload.family_id,
            transaction_id=tx.id,
            member_id=mid,
            share_amount=amt,
            share_percent=pct,
            is_paid=mid == member.id,
        )
        db.add(row)
        split_rows.append(row)

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="SPLIT_EXPENSE",
        entity_id=tx.id,
        title="Split expense created",
        description=f"{money(total)} across {len(computed)} members",
    )
    db.commit()
    db.refresh(tx)

    return {
        "id": tx.id,
        "transaction_id": tx.id,
        "amount": money(tx.amount),
        "is_split": True,
        "splits": [
            {
                "id": r.id,
                "member_id": r.member_id,
                "share_amount": money(r.share_amount),
                "share_percent": money(r.share_percent) if r.share_percent is not None else None,
                "is_paid": r.is_paid,
            }
            for r in split_rows
        ],
    }


@router.get("/expenses/{transaction_id}/splits")
def get_expense_splits(
    transaction_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "transaction.read")
    tx = (
        db.query(Transaction)
        .filter(
            Transaction.id == transaction_id,
            Transaction.family_id == family_id,
            Transaction.deleted_at.is_(None),
        )
        .first()
    )
    if not tx:
        raise HTTPException(404, "Transaction not found")
    rows = (
        db.query(ExpenseSplit)
        .filter(
            ExpenseSplit.transaction_id == transaction_id,
            ExpenseSplit.family_id == family_id,
            ExpenseSplit.deleted_at.is_(None),
        )
        .all()
    )
    return {
        "transaction_id": transaction_id,
        "is_split": bool(tx.is_split),
        "splits": [
            {
                "id": r.id,
                "member_id": r.member_id,
                "share_amount": money(r.share_amount),
                "share_percent": money(r.share_percent) if r.share_percent is not None else None,
                "is_paid": r.is_paid,
            }
            for r in rows
        ],
    }


# ---------- transaction attachment (income/expense) ----------
@router.post("/transactions/{transaction_id}/attachment")
async def upload_transaction_attachment(
    transaction_id: str,
    family_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, family_id, current_user.id, "transaction.create")
    tx = (
        db.query(Transaction)
        .filter(
            Transaction.id == transaction_id,
            Transaction.family_id == family_id,
            Transaction.deleted_at.is_(None),
        )
        .first()
    )
    if not tx:
        raise HTTPException(404, "Transaction not found")

    raw = await file.read()
    stored = store_document_file(
        family_id=family_id,
        item_id=tx.id,
        filename=file.filename or "attachment.bin",
        content_type=file.content_type,
        data=raw,
    )
    tx.attachment_url = stored.get("file_path")
    tx.attachment_name = stored.get("file_name") or file.filename
    tx.attachment_mime = stored.get("file_mime") or file.content_type

    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=member.id,
        action_type="UPLOAD",
        entity_type="TRANSACTION_ATTACHMENT",
        entity_id=tx.id,
        title="Transaction attachment uploaded",
        description=tx.attachment_name,
    )
    db.commit()
    db.refresh(tx)
    return {
        "id": tx.id,
        "attachment_url": tx.attachment_url,
        "attachment_name": tx.attachment_name,
        "attachment_mime": tx.attachment_mime,
    }


# ---------- zakat metal rates ----------
@router.get("/zakat/metal-rates")
def list_metal_rates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Any authenticated user can read latest published rates
    _ = current_user
    rows = (
        db.query(MetalRate)
        .filter(MetalRate.deleted_at.is_(None))
        .order_by(MetalRate.effective_date.desc(), MetalRate.created_at.desc())
        .all()
    )
    latest: dict[str, MetalRate] = {}
    for r in rows:
        key = (r.metal or "").upper()
        if key not in latest:
            latest[key] = r
    return {
        "rates": [
            {
                "id": r.id,
                "metal": (r.metal or "").upper(),
                "unit": r.unit,
                "rate_bdt": money(r.rate_bdt),
                "effective_date": r.effective_date,
                "source": r.source,
            }
            for r in latest.values()
        ],
        "gold_nisab_grams": str(GOLD_NISAB_GRAMS),
        "silver_nisab_grams": str(SILVER_NISAB_GRAMS),
    }


@router.post("/zakat/metal-rates", status_code=status.HTTP_201_CREATED)
def upsert_metal_rate(
    payload: MetalRateIn,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, family_id, current_user.id, "report.read")
    role = (member.role or "").upper()
    if role not in {"OWNER", "ADMIN"}:
        raise HTTPException(403, "Owner/Admin required to set metal rates")

    metal = payload.metal.upper()
    eff = (payload.effective_date or date.today().isoformat())[:10]
    row = MetalRate(
        metal=metal,
        unit=(payload.unit or "GRAM").upper()[:20],
        rate_bdt=_money_d(payload.rate_bdt),
        effective_date=eff,
        source=payload.source,
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="METAL_RATE",
        entity_id=row.id,
        title=f"{metal} rate set",
        description=money(row.rate_bdt),
    )
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "metal": row.metal,
        "rate_bdt": money(row.rate_bdt),
        "effective_date": row.effective_date,
        "unit": row.unit,
    }


@router.get("/zakat/nisab-from-rates")
def nisab_from_rates(
    metal: str = "SILVER",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    metal_u = metal.upper().strip()
    if metal_u not in {"GOLD", "SILVER"}:
        raise HTTPException(400, "metal must be GOLD or SILVER")
    row = (
        db.query(MetalRate)
        .filter(MetalRate.metal == metal_u, MetalRate.deleted_at.is_(None))
        .order_by(MetalRate.effective_date.desc(), MetalRate.created_at.desc())
        .first()
    )
    if not row:
        raise HTTPException(404, f"No {metal_u} rate configured")
    grams = GOLD_NISAB_GRAMS if metal_u == "GOLD" else SILVER_NISAB_GRAMS
    nisab = _money_d(Decimal(row.rate_bdt) * grams)
    return {
        "metal": metal_u,
        "unit": row.unit,
        "rate_bdt": money(row.rate_bdt),
        "nisab_grams": str(grams),
        "nisab_amount": money(nisab),
        "effective_date": row.effective_date,
    }


# ---------- vehicles + per-km ----------
@router.get("/vehicles")
def list_vehicles(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Vehicle)
        .filter(Vehicle.family_id == family_id, Vehicle.deleted_at.is_(None))
        .order_by(Vehicle.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "vehicle_type": r.vehicle_type,
            "registration_no": r.registration_no,
            "current_km": money(r.current_km),
            "currency": r.currency,
            "status": r.status,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/vehicles", status_code=status.HTTP_201_CREATED)
def create_vehicle_master(payload: VehicleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = Vehicle(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        name=payload.name.strip(),
        vehicle_type=(payload.vehicle_type or "CAR").upper()[:80],
        registration_no=payload.registration_no,
        current_km=_money_d(payload.current_km),
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


@router.get("/vehicles/{vehicle_id}/cost-per-km")
def vehicle_cost_per_km(
    vehicle_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    vehicle = (
        db.query(Vehicle)
        .filter(Vehicle.id == vehicle_id, Vehicle.family_id == family_id, Vehicle.deleted_at.is_(None))
        .first()
    )
    name = vehicle.name if vehicle else None
    q = db.query(VehicleExpense).filter(
        VehicleExpense.family_id == family_id,
        VehicleExpense.deleted_at.is_(None),
    )
    if vehicle:
        q = q.filter(
            (VehicleExpense.vehicle_id == vehicle_id)
            | (VehicleExpense.vehicle_name == vehicle.name)
        )
    else:
        # allow analysis by expenses tagged with this id string in vehicle_id even without master
        q = q.filter(VehicleExpense.vehicle_id == vehicle_id)
    rows = q.order_by(VehicleExpense.created_at.asc()).all()
    if not rows:
        raise HTTPException(404, "No vehicle expenses found")

    total_cost = sum((_money_d(r.amount) for r in rows), Decimal("0"))
    km_values = [Decimal(r.km_reading) for r in rows if r.km_reading is not None]
    if len(km_values) >= 2:
        km_span = max(km_values) - min(km_values)
    elif vehicle and Decimal(vehicle.current_km or 0) > 0 and km_values:
        km_span = Decimal(vehicle.current_km) - min(km_values)
    else:
        km_span = Decimal("0")

    if km_span <= 0:
        per_km = None
    else:
        per_km = _money_d(total_cost / km_span)

    return {
        "vehicle_id": vehicle_id,
        "vehicle_name": name or (rows[0].vehicle_name if rows else None),
        "expense_count": len(rows),
        "total_cost": money(total_cost),
        "km_span": money(km_span),
        "cost_per_km": money(per_km) if per_km is not None else None,
        "currency": rows[0].currency if rows else "BDT",
    }


@router.get("/vehicle-expenses/cost-per-km")
def vehicle_expenses_cost_per_km_by_name(
    family_id: str,
    vehicle_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(VehicleExpense)
        .filter(
            VehicleExpense.family_id == family_id,
            VehicleExpense.vehicle_name == vehicle_name,
            VehicleExpense.deleted_at.is_(None),
        )
        .order_by(VehicleExpense.created_at.asc())
        .all()
    )
    if not rows:
        raise HTTPException(404, "No expenses for vehicle_name")
    total_cost = sum((_money_d(r.amount) for r in rows), Decimal("0"))
    km_values = [Decimal(r.km_reading) for r in rows if r.km_reading is not None]
    km_span = (max(km_values) - min(km_values)) if len(km_values) >= 2 else Decimal("0")
    per_km = _money_d(total_cost / km_span) if km_span > 0 else None
    return {
        "vehicle_name": vehicle_name,
        "expense_count": len(rows),
        "total_cost": money(total_cost),
        "km_span": money(km_span),
        "cost_per_km": money(per_km) if per_km is not None else None,
    }


# ---------- health annual budget ----------
@router.get("/health-annual-budgets")
def list_health_budgets(family_id: str, year: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    q = db.query(HealthAnnualBudget).filter(
        HealthAnnualBudget.family_id == family_id,
        HealthAnnualBudget.deleted_at.is_(None),
    )
    if year:
        q = q.filter(HealthAnnualBudget.year == year)
    rows = q.order_by(HealthAnnualBudget.year.desc()).all()
    out = []
    for r in rows:
        remaining = _money_d(Decimal(r.budget_amount or 0) - Decimal(r.spent_amount or 0))
        out.append(
            {
                "id": r.id,
                "family_id": r.family_id,
                "member_id": r.member_id,
                "year": r.year,
                "budget_amount": money(r.budget_amount),
                "spent_amount": money(r.spent_amount),
                "remaining_amount": money(remaining),
                "currency": r.currency,
                "notes": r.notes,
            }
        )
    return out


@router.post("/health-annual-budgets", status_code=status.HTTP_201_CREATED)
def create_health_budget(payload: HealthBudgetIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    year = payload.year.strip()
    # sync spent from existing health expenses for year
    expenses = (
        db.query(HealthExpense)
        .filter(
            HealthExpense.family_id == payload.family_id,
            HealthExpense.deleted_at.is_(None),
            HealthExpense.status == "ACTIVE",
        )
        .all()
    )
    spent = Decimal("0")
    for e in expenses:
        y = (e.year or (e.expense_date or "")[:4] or "")
        if y == year and (payload.member_id is None or e.member_id == payload.member_id):
            spent += _money_d(e.amount)

    row = HealthAnnualBudget(
        family_id=payload.family_id,
        member_id=payload.member_id,
        year=year,
        budget_amount=_money_d(payload.budget_amount),
        spent_amount=_money_d(spent),
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "year": row.year,
        "budget_amount": money(row.budget_amount),
        "spent_amount": money(row.spent_amount),
        "remaining_amount": money(_money_d(row.budget_amount) - _money_d(row.spent_amount)),
    }


# ---------- property repairs ----------
@router.get("/properties/{property_id}/repairs")
def list_property_repairs(
    property_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(PropertyRepair)
        .filter(
            PropertyRepair.family_id == family_id,
            PropertyRepair.property_id == property_id,
            PropertyRepair.deleted_at.is_(None),
        )
        .order_by(PropertyRepair.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "title": r.title,
            "amount": money(r.amount),
            "repair_date": r.repair_date,
            "currency": r.currency,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/properties/{property_id}/repairs", status_code=status.HTTP_201_CREATED)
def create_property_repair(
    property_id: str,
    payload: PropertyRepairIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    if payload.property_id != property_id:
        raise HTTPException(400, "property_id mismatch")
    prop = (
        db.query(Property)
        .filter(Property.id == property_id, Property.family_id == payload.family_id, Property.deleted_at.is_(None))
        .first()
    )
    if not prop:
        raise HTTPException(404, "Property not found")

    amount = _money_d(payload.amount)
    row = PropertyRepair(
        family_id=payload.family_id,
        property_id=property_id,
        created_by_member_id=member.id,
        title=payload.title.strip(),
        amount=amount,
        repair_date=payload.repair_date or date.today().isoformat(),
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
    )
    db.add(row)
    prop.repair_cost = _money_d(Decimal(prop.repair_cost or 0) + amount)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "title": row.title,
        "amount": money(row.amount),
        "property_repair_cost_total": money(prop.repair_cost),
    }


# ---------- expense bill-scan OCR ----------
class ExpenseOcrTextIn(BaseModel):
    raw_text: str = ""


@router.post("/expenses/ocr/parse")
def expense_ocr_parse(
    payload: ExpenseOcrTextIn,
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "expense.create")
    from app.services.ocr_service import expense_bill_ocr_parse

    if not (payload.raw_text or "").strip():
        raise HTTPException(422, "raw_text required (or use /expenses/ocr/parse-image)")
    return expense_bill_ocr_parse(raw_text=payload.raw_text or "")


@router.post("/expenses/ocr/parse-image")
async def expense_ocr_parse_image(
    family_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "expense.create")
    from app.services.ocr_service import expense_bill_ocr_parse

    image_bytes = await file.read()
    return expense_bill_ocr_parse(raw_text="", image_bytes=image_bytes)

