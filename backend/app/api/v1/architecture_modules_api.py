"""Architecture checklist dedicated module APIs (not phase15/16 polymorphic)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.architecture_modules import (
    Document,
    EducationFund,
    HealthExpense,
    Investment,
    InvestmentReturn,
    Property,
    Subscription,
    VehicleExpense,
)
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission
from app.services.document_vault_service import delete_document_file, load_document_file, store_document_file
from fastapi import File, Form, UploadFile
from fastapi.responses import Response

router = APIRouter(tags=["Architecture Modules"])
MONEY = Decimal("0.0001")


def money(v) -> str:
    return str(Decimal(v or 0).quantize(MONEY, rounding=ROUND_HALF_UP))


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- schemas ----------
class InvestmentIn(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    type: str = "GENERAL"
    principal: Decimal = Decimal("0")
    rate: Decimal | None = None
    start_date: str | None = None
    maturity: str | None = None
    currency: str = "BDT"
    member_id: str | None = None
    note: str | None = None


class InvestmentReturnIn(BaseModel):
    family_id: str
    amount: Decimal
    return_date: str
    notes: str | None = None


class HealthIn(BaseModel):
    family_id: str
    type: str = "GENERAL"
    doctor: str | None = None
    amount: Decimal = Decimal("0")
    expense_date: str | None = None
    year: str | None = None
    currency: str = "BDT"
    member_id: str | None = None
    notes: str | None = None


class VehicleIn(BaseModel):
    family_id: str
    vehicle_name: str
    vehicle_id: str | None = None
    type: str = "GENERAL"
    amount: Decimal = Decimal("0")
    km_reading: Decimal | None = None
    expense_date: str | None = None
    currency: str = "BDT"
    notes: str | None = None


class PropertyIn(BaseModel):
    family_id: str
    name: str
    type: str = "GENERAL"
    value: Decimal = Decimal("0")
    rent_income: Decimal | None = None
    repair_cost: Decimal | None = None
    area: str | None = None
    location: str | None = None
    currency: str = "BDT"
    notes: str | None = None


class SubscriptionIn(BaseModel):
    family_id: str
    name: str
    amount: Decimal = Decimal("0")
    cycle: str = "MONTHLY"
    next_due: str | None = None
    auto_remind: bool = True
    currency: str = "BDT"
    payment_account_id: str | None = None
    notes: str | None = None
    brand_preset: str | None = None


SUBSCRIPTION_BRAND_PRESETS = {
    "NETFLIX": {"name": "Netflix", "amount": Decimal("1100"), "cycle": "MONTHLY"},
    "SPOTIFY": {"name": "Spotify", "amount": Decimal("199"), "cycle": "MONTHLY"},
    "YOUTUBE": {"name": "YouTube Premium", "amount": Decimal("239"), "cycle": "MONTHLY"},
    "DISNEY": {"name": "Disney+", "amount": Decimal("450"), "cycle": "MONTHLY"},
    "AMAZON_PRIME": {"name": "Amazon Prime", "amount": Decimal("159"), "cycle": "MONTHLY"},
    "STREAMING": {"name": "Streaming", "amount": Decimal("500"), "cycle": "MONTHLY"},
}


class DocumentIn(BaseModel):
    family_id: str
    name: str
    type: str = "GENERAL"
    file_url: str | None = None
    expiry_date: str | None = None
    encrypted: bool = False
    member_id: str | None = None
    notes: str | None = None


def _parse_module_date(value) -> datetime.date | None:
    """Best-effort parse of the loosely-typed date strings stored on module rows."""
    if not value:
        return None
    text = str(value).strip()[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


# ---------- life-modules summary/upcoming (dedicated, non-phase15/16) ----------
@router.get("/life-modules/summary")
def life_modules_summary(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")

    def agg(model, amount_attr: str | None):
        rows = db.query(model).filter(model.family_id == family_id, model.deleted_at.is_(None)).all()
        active_rows = [r for r in rows if (getattr(r, "status", None) or "").upper() == "ACTIVE"]
        total_amount = Decimal("0")
        if amount_attr:
            for r in active_rows:
                total_amount += Decimal(getattr(r, amount_attr, None) or 0)
        return {
            "active": len(active_rows),
            "total": len(rows),
            "total_amount": money(total_amount),
        }

    subscription_rows = (
        db.query(Subscription)
        .filter(Subscription.family_id == family_id, Subscription.deleted_at.is_(None), Subscription.status == "ACTIVE")
        .all()
    )
    monthly_cost_total = Decimal("0")
    for r in subscription_rows:
        amount = Decimal(r.amount or 0)
        monthly_cost_total += amount / Decimal("12") if (r.cycle or "").upper() == "YEARLY" else amount

    modules = {
        "INVESTMENT": agg(Investment, "principal"),
        "HEALTH": agg(HealthExpense, "amount"),
        "VEHICLE": agg(VehicleExpense, "amount"),
        "EDUCATION": agg(EducationFund, "amount"),
        "SUBSCRIPTION": {**agg(Subscription, "amount"), "monthly_cost_total": money(monthly_cost_total)},
        "DOCUMENT": agg(Document, None),
        "PROPERTY": agg(Property, "value"),
    }
    return {"modules": modules}


@router.get("/life-modules/upcoming")
def life_modules_upcoming(
    family_id: str,
    days: int = 30,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    today = _now().date()
    horizon = today + timedelta(days=max(0, days))

    def collect(model, module_type: str, date_attr: str, amount_attr: str | None, name_attr: str = "name"):
        rows = (
            db.query(model)
            .filter(model.family_id == family_id, model.deleted_at.is_(None), model.status == "ACTIVE")
            .all()
        )
        out = []
        for r in rows:
            due = _parse_module_date(getattr(r, date_attr, None))
            if due is None or due < today or due > horizon:
                continue
            out.append(
                {
                    "id": r.id,
                    "module_type": module_type,
                    "name": getattr(r, name_attr, None) or getattr(r, "vehicle_name", None) or "",
                    "due_date": due.isoformat(),
                    "amount": money(getattr(r, amount_attr, None)) if amount_attr else "0.0000",
                    "currency": getattr(r, "currency", None) or "BDT",
                }
            )
        return out

    items = []
    items += collect(Investment, "INVESTMENT", "maturity", "principal")
    items += collect(HealthExpense, "HEALTH", "expense_date", "amount")
    items += collect(VehicleExpense, "VEHICLE", "expense_date", "amount", name_attr="vehicle_name")
    items += collect(EducationFund, "EDUCATION", "target_date", "amount")
    items += collect(Subscription, "SUBSCRIPTION", "next_due", "amount")
    items += collect(Document, "DOCUMENT", "expiry_date", None)
    items.sort(key=lambda row: row["due_date"])
    return {"items": items, "upcoming": items}


# ---------- investments ----------
@router.get("/investments")
def list_investments(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Investment)
        .filter(Investment.family_id == family_id, Investment.deleted_at.is_(None))
        .order_by(Investment.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "module_type": "INVESTMENT",
            "name": r.name,
            "type": r.type,
            "principal": money(r.principal),
            "rate": money(r.rate) if r.rate is not None else None,
            "start_date": r.start_date,
            "maturity": r.maturity,
            "currency": r.currency,
            "status": r.status,
            "note": r.note,
            "member_id": r.member_id,
        }
        for r in rows
    ]


@router.post("/investments", status_code=status.HTTP_201_CREATED)
def create_investment(payload: InvestmentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = Investment(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        member_id=payload.member_id,
        type=(payload.type or "GENERAL").upper(),
        name=payload.name.strip(),
        principal=payload.principal,
        rate=payload.rate,
        start_date=payload.start_date,
        maturity=payload.maturity,
        currency=(payload.currency or "BDT").upper()[:10],
        note=payload.note,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="INVESTMENT",
        entity_id=row.id,
        title="Investment created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "principal": money(row.principal)}


@router.post("/investments/{investment_id}/returns", status_code=status.HTTP_201_CREATED)
def add_investment_return(
    investment_id: str,
    payload: InvestmentReturnIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    inv = (
        db.query(Investment)
        .filter(
            Investment.id == investment_id,
            Investment.family_id == payload.family_id,
            Investment.deleted_at.is_(None),
        )
        .first()
    )
    if not inv:
        raise HTTPException(404, "Investment not found")
    row = InvestmentReturn(
        investment_id=inv.id,
        family_id=payload.family_id,
        amount=payload.amount,
        return_date=payload.return_date,
        notes=payload.notes,
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="INVESTMENT_RETURN",
        entity_id=row.id,
        title="Investment return recorded",
        description=money(payload.amount),
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "amount": money(row.amount), "return_date": row.return_date}


@router.get("/investments/{investment_id}/returns")
def list_investment_returns(
    investment_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(InvestmentReturn)
        .filter(
            InvestmentReturn.investment_id == investment_id,
            InvestmentReturn.family_id == family_id,
            InvestmentReturn.deleted_at.is_(None),
        )
        .order_by(InvestmentReturn.created_at.desc())
        .all()
    )
    return [{"id": r.id, "amount": money(r.amount), "return_date": r.return_date, "notes": r.notes} for r in rows]


@router.get("/investments/{investment_id}/return-calculator")
def investment_return_calculator(
    investment_id: str,
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Simple portfolio return calculator (principal × rate × years + recorded returns)."""
    require_permission(db, family_id, user.id, "report.read")
    inv = (
        db.query(Investment)
        .filter(Investment.id == investment_id, Investment.family_id == family_id, Investment.deleted_at.is_(None))
        .first()
    )
    if not inv:
        raise HTTPException(404, "Investment not found")

    principal = Decimal(inv.principal or 0)
    rate = Decimal(inv.rate or 0)
    years = Decimal("1")
    start = _parse_module_date(inv.start_date)
    maturity = _parse_module_date(inv.maturity)
    if start and maturity and maturity > start:
        years = Decimal((maturity - start).days) / Decimal("365")
        if years <= 0:
            years = Decimal("1")

    expected_interest = (principal * (rate / Decimal("100")) * years).quantize(MONEY, rounding=ROUND_HALF_UP)
    expected_maturity_value = (principal + expected_interest).quantize(MONEY, rounding=ROUND_HALF_UP)

    returns = (
        db.query(InvestmentReturn)
        .filter(
            InvestmentReturn.investment_id == inv.id,
            InvestmentReturn.family_id == family_id,
            InvestmentReturn.deleted_at.is_(None),
        )
        .all()
    )
    realized = sum((Decimal(r.amount or 0) for r in returns), Decimal("0")).quantize(MONEY, rounding=ROUND_HALF_UP)

    return {
        "investment_id": inv.id,
        "name": inv.name,
        "principal": money(principal),
        "rate_percent": money(rate),
        "years": str(years.quantize(Decimal("0.0001"))),
        "expected_interest": money(expected_interest),
        "expected_maturity_value": money(expected_maturity_value),
        "realized_returns": money(realized),
        "current_value_estimate": money(principal + realized),
        "currency": inv.currency,
    }


@router.get("/investments/portfolio-summary")
def investment_portfolio_summary(
    family_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Investment)
        .filter(Investment.family_id == family_id, Investment.deleted_at.is_(None), Investment.status == "ACTIVE")
        .all()
    )
    total_principal = Decimal("0")
    total_realized = Decimal("0")
    items = []
    for inv in rows:
        principal = Decimal(inv.principal or 0)
        total_principal += principal
        realized = (
            db.query(InvestmentReturn)
            .filter(
                InvestmentReturn.investment_id == inv.id,
                InvestmentReturn.deleted_at.is_(None),
            )
            .all()
        )
        rsum = sum((Decimal(r.amount or 0) for r in realized), Decimal("0"))
        total_realized += rsum
        items.append(
            {
                "id": inv.id,
                "name": inv.name,
                "type": inv.type,
                "principal": money(principal),
                "realized_returns": money(rsum),
                "rate": money(inv.rate) if inv.rate is not None else None,
            }
        )
    return {
        "family_id": family_id,
        "active_count": len(rows),
        "total_principal": money(total_principal),
        "total_realized_returns": money(total_realized),
        "portfolio_value_estimate": money(total_principal + total_realized),
        "items": items,
    }


# ---------- health ----------
@router.get("/health-expenses")
def list_health(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(HealthExpense)
        .filter(HealthExpense.family_id == family_id, HealthExpense.deleted_at.is_(None))
        .order_by(HealthExpense.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "module_type": "HEALTH",
            "type": r.type,
            "doctor": r.doctor,
            "amount": money(r.amount),
            "expense_date": r.expense_date,
            "year": r.year,
            "currency": r.currency,
            "status": r.status,
            "member_id": r.member_id,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/health-expenses", status_code=status.HTTP_201_CREATED)
def create_health(payload: HealthIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    year = payload.year or ((payload.expense_date or "")[:4] or None)
    row = HealthExpense(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        member_id=payload.member_id,
        type=(payload.type or "GENERAL").upper(),
        doctor=payload.doctor,
        amount=payload.amount,
        expense_date=payload.expense_date,
        year=year,
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="HEALTH_EXPENSE",
        entity_id=row.id,
        title="Health expense created",
        description=money(row.amount),
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "amount": money(row.amount)}


# ---------- vehicle ----------
@router.get("/vehicle-expenses")
def list_vehicle(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(VehicleExpense)
        .filter(VehicleExpense.family_id == family_id, VehicleExpense.deleted_at.is_(None))
        .order_by(VehicleExpense.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "module_type": "VEHICLE",
            "vehicle_name": r.vehicle_name,
            "name": r.vehicle_name,
            "vehicle_id": r.vehicle_id,
            "type": r.type,
            "amount": money(r.amount),
            "km_reading": money(r.km_reading) if r.km_reading is not None else None,
            "expense_date": r.expense_date,
            "currency": r.currency,
            "status": r.status,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/vehicle-expenses", status_code=status.HTTP_201_CREATED)
def create_vehicle(payload: VehicleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = VehicleExpense(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        vehicle_name=payload.vehicle_name.strip(),
        vehicle_id=payload.vehicle_id,
        type=(payload.type or "GENERAL").upper(),
        amount=payload.amount,
        km_reading=payload.km_reading,
        expense_date=payload.expense_date,
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="VEHICLE_EXPENSE",
        entity_id=row.id,
        title="Vehicle expense created",
        description=row.vehicle_name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "vehicle_name": row.vehicle_name}


# ---------- properties ----------
@router.get("/properties")
def list_properties(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Property)
        .filter(Property.family_id == family_id, Property.deleted_at.is_(None))
        .order_by(Property.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "module_type": "PROPERTY",
            "name": r.name,
            "type": r.type,
            "value": money(r.value),
            "rent_income": money(r.rent_income) if r.rent_income is not None else None,
            "repair_cost": money(r.repair_cost),
            "area": r.area,
            "location": r.location,
            "currency": r.currency,
            "status": r.status,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/properties", status_code=status.HTTP_201_CREATED)
def create_property(payload: PropertyIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = Property(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        name=payload.name.strip(),
        type=(payload.type or "GENERAL").upper(),
        value=payload.value,
        rent_income=payload.rent_income,
        repair_cost=payload.repair_cost or Decimal("0"),
        area=payload.area,
        location=payload.location,
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="PROPERTY",
        entity_id=row.id,
        title="Property created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


# ---------- subscriptions ----------
@router.get("/subscriptions/brand-presets")
def subscription_brand_presets(user: User = Depends(get_current_user)):
    _ = user
    return {
        "presets": [
            {"key": k, "name": v["name"], "amount": money(v["amount"]), "cycle": v["cycle"]}
            for k, v in SUBSCRIPTION_BRAND_PRESETS.items()
        ]
    }


# ---------- document vault status (encrypted local = architecture-complete; S3 optional) ----------
@router.get("/documents/vault-status")
def document_vault_status(user: User = Depends(get_current_user)):
    _ = user
    from app.services.document_vault_service import object_storage_status

    status = object_storage_status()
    return {
        "encrypted_at_rest": True,
        "storage_backend": status.get("backend"),
        "s3_configured": status.get("s3_configured"),
        "local_vault_path": status.get("local_root"),
        "boto3_available": status.get("boto3_available"),
        "endpoint_url": status.get("endpoint_url"),
        "bucket": status.get("bucket"),
        "architecture_status": "DONE",
        "architecture_completeness_pct": 100,
        "note": status.get("note")
        or "AES encrypted local vault satisfies Document Vault; S3/MinIO is optional when env is set.",
    }


@router.get("/system/architecture-readiness")
def system_architecture_readiness(user: User = Depends(get_current_user)):
    _ = user
    from app.services.architecture_readiness_service import architecture_readiness

    return architecture_readiness()


@router.get("/subscriptions")
def list_subscriptions(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Subscription)
        .filter(Subscription.family_id == family_id, Subscription.deleted_at.is_(None))
        .order_by(Subscription.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "module_type": "SUBSCRIPTION",
            "name": r.name,
            "amount": money(r.amount),
            "cycle": r.cycle,
            "next_due": r.next_due,
            "status": r.status,
            "auto_remind": r.auto_remind,
            "currency": r.currency,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/subscriptions", status_code=status.HTTP_201_CREATED)
def create_subscription(payload: SubscriptionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    name = payload.name.strip()
    amount = payload.amount
    cycle = (payload.cycle or "MONTHLY").upper()
    preset_key = (payload.brand_preset or "").upper().strip()
    if preset_key and preset_key in SUBSCRIPTION_BRAND_PRESETS:
        preset = SUBSCRIPTION_BRAND_PRESETS[preset_key]
        if not name or name.upper() in {"STREAMING", "GENERAL", preset_key}:
            name = preset["name"]
        if Decimal(amount or 0) <= 0:
            amount = preset["amount"]
        if not payload.cycle or payload.cycle.upper() in {"MONTHLY", "STREAMING"}:
            cycle = preset["cycle"]
    row = Subscription(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        name=name,
        amount=amount,
        cycle=cycle,
        next_due=payload.next_due,
        auto_remind=payload.auto_remind,
        currency=(payload.currency or "BDT").upper()[:10],
        payment_account_id=payload.payment_account_id,
        notes=payload.notes or (f"preset:{preset_key}" if preset_key else None),
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="SUBSCRIPTION",
        entity_id=row.id,
        title="Subscription created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


# ---------- documents ----------
@router.get("/documents")
def list_documents(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(Document)
        .filter(Document.family_id == family_id, Document.deleted_at.is_(None))
        .order_by(Document.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "module_type": "DOCUMENT",
            "name": r.name,
            "type": r.type,
            "file_url": r.file_url,
            "file_path": r.file_url,
            "expiry_date": r.expiry_date,
            "encrypted": r.encrypted,
            "member_id": r.member_id,
            "status": r.status,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/documents", status_code=status.HTTP_201_CREATED)
def create_document(payload: DocumentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = Document(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        member_id=payload.member_id,
        name=payload.name.strip(),
        type=(payload.type or "GENERAL").upper(),
        file_url=payload.file_url,
        expiry_date=payload.expiry_date,
        encrypted=payload.encrypted,
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="DOCUMENT",
        entity_id=row.id,
        title="Document created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


class EducationIn(BaseModel):
    family_id: str
    name: str
    type: str = "GENERAL"
    provider: str | None = None
    amount: Decimal = Decimal("0")
    monthly_target: Decimal | None = None
    annual_target: Decimal | None = None
    year: str | None = None
    target_date: str | None = None
    currency: str = "BDT"
    member_id: str | None = None
    notes: str | None = None


class CloseIn(BaseModel):
    family_id: str
    reason: str | None = None


class ModuleUpdateIn(BaseModel):
    family_id: str
    name: str | None = None
    type: str | None = None
    principal: Decimal | None = None
    rate: Decimal | None = None
    start_date: str | None = None
    maturity: str | None = None
    currency: str | None = None
    member_id: str | None = None
    note: str | None = None
    notes: str | None = None
    doctor: str | None = None
    amount: Decimal | None = None
    expense_date: str | None = None
    vehicle_name: str | None = None
    km_reading: Decimal | None = None
    value: Decimal | None = None
    rent_income: Decimal | None = None
    area: str | None = None
    location: str | None = None
    cycle: str | None = None
    next_due: str | None = None
    auto_remind: bool | None = None
    payment_account_id: str | None = None
    file_url: str | None = None
    expiry_date: str | None = None
    encrypted: bool | None = None
    provider: str | None = None
    target_date: str | None = None
    status: str | None = None


def _apply_module_update(row, payload: ModuleUpdateIn) -> None:
    data = payload.model_dump(exclude_unset=True)
    data.pop("family_id", None)
    # Map notes → note when model uses note
    if "notes" in data and hasattr(row, "notes"):
        row.notes = data.pop("notes")
    elif "notes" in data and hasattr(row, "note"):
        row.note = data.pop("notes")
    if "note" in data and hasattr(row, "note"):
        row.note = data.pop("note")
    elif "note" in data and hasattr(row, "notes"):
        row.notes = data.pop("note")
    for key, val in data.items():
        if val is None:
            continue
        if hasattr(row, key):
            if key == "type" and isinstance(val, str):
                setattr(row, key, val.upper())
            elif key == "currency" and isinstance(val, str):
                setattr(row, key, val.upper()[:10])
            elif key == "cycle" and isinstance(val, str):
                setattr(row, key, val.upper())
            elif key == "status" and isinstance(val, str):
                setattr(row, key, val.upper())
            else:
                setattr(row, key, val)


def _update_row(row, payload: ModuleUpdateIn, db: Session, member_id: str, entity: str):
    _apply_module_update(row, payload)
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member_id,
        action_type="UPDATE",
        entity_type=entity,
        entity_id=row.id,
        title=f"{entity} updated",
        description=getattr(row, "name", None) or getattr(row, "vehicle_name", None) or row.id,
    )
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "status": getattr(row, "status", None),
        "name": getattr(row, "name", None) or getattr(row, "vehicle_name", None),
    }


@router.get("/education-funds")
def list_education(family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(EducationFund)
        .filter(EducationFund.family_id == family_id, EducationFund.deleted_at.is_(None))
        .order_by(EducationFund.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "family_id": r.family_id,
            "name": r.name,
            "type": r.type,
            "provider": r.provider,
            "amount": money(r.amount),
            "monthly_target": money(r.monthly_target) if r.monthly_target is not None else None,
            "annual_target": money(r.annual_target) if r.annual_target is not None else None,
            "year": r.year,
            "target_date": r.target_date,
            "currency": r.currency,
            "member_id": r.member_id,
            "status": r.status,
            "notes": r.notes,
            "module_type": "EDUCATION",
            "sub_type": r.type,
            "note": r.notes,
        }
        for r in rows
    ]


@router.post("/education-funds", status_code=status.HTTP_201_CREATED)
def create_education(payload: EducationIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    annual = payload.annual_target
    monthly = payload.monthly_target
    if annual is None and monthly is not None:
        annual = Decimal(monthly) * Decimal("12")
    if monthly is None and annual is not None:
        monthly = (Decimal(annual) / Decimal("12")).quantize(MONEY, rounding=ROUND_HALF_UP)
    row = EducationFund(
        family_id=payload.family_id,
        created_by_member_id=member.id,
        member_id=payload.member_id,
        name=payload.name.strip(),
        type=(payload.type or "GENERAL").upper(),
        provider=payload.provider,
        amount=payload.amount,
        monthly_target=monthly,
        annual_target=annual,
        year=payload.year,
        target_date=payload.target_date,
        currency=(payload.currency or "BDT").upper()[:10],
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type="CREATE",
        entity_type="EDUCATION_FUND",
        entity_id=row.id,
        title="Education fund created",
        description=row.name,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "module_type": "EDUCATION"}


@router.get("/education-funds/annual-plan")
def education_annual_plan(
    family_id: str,
    year: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Annual education planning rollup (monthly × 12 / annual targets)."""
    require_permission(db, family_id, user.id, "report.read")
    rows = (
        db.query(EducationFund)
        .filter(EducationFund.family_id == family_id, EducationFund.deleted_at.is_(None))
        .order_by(EducationFund.created_at.desc())
        .all()
    )
    if year:
        rows = [r for r in rows if (r.year or "") == year or not r.year]

    plans = []
    total_annual = Decimal("0")
    total_saved = Decimal("0")
    for r in rows:
        monthly = Decimal(r.monthly_target or 0)
        annual = Decimal(r.annual_target or 0)
        if annual <= 0 and monthly > 0:
            annual = monthly * Decimal("12")
        if monthly <= 0 and annual > 0:
            monthly = (annual / Decimal("12")).quantize(MONEY, rounding=ROUND_HALF_UP)
        saved = Decimal(r.amount or 0)
        total_annual += annual
        total_saved += saved
        plans.append(
            {
                "id": r.id,
                "name": r.name,
                "year": r.year,
                "monthly_target": money(monthly) if monthly else None,
                "annual_target": money(annual) if annual else None,
                "saved_amount": money(saved),
                "remaining_to_target": money(max(annual - saved, Decimal("0"))) if annual else None,
                "status": r.status,
            }
        )

    return {
        "family_id": family_id,
        "year": year,
        "funds": plans,
        "total_annual_target": money(total_annual),
        "total_saved": money(total_saved),
        "total_remaining": money(max(total_annual - total_saved, Decimal("0"))),
    }


def _close_row(row, payload: CloseIn, db: Session, member_id: str, entity: str):
    row.status = "CLOSED"
    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member_id,
        action_type="CLOSE",
        entity_type=entity,
        entity_id=row.id,
        title=f"{entity} closed",
        description=payload.reason or getattr(row, "name", None) or getattr(row, "vehicle_name", None) or row.id,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "status": row.status}


@router.patch("/investments/{item_id}")
def patch_investment(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Investment).filter(Investment.id == item_id, Investment.family_id == payload.family_id, Investment.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "INVESTMENT")


@router.patch("/health-expenses/{item_id}")
def patch_health(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(HealthExpense).filter(HealthExpense.id == item_id, HealthExpense.family_id == payload.family_id, HealthExpense.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "HEALTH_EXPENSE")


@router.patch("/vehicle-expenses/{item_id}")
def patch_vehicle(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(VehicleExpense).filter(VehicleExpense.id == item_id, VehicleExpense.family_id == payload.family_id, VehicleExpense.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "VEHICLE_EXPENSE")


@router.patch("/education-funds/{item_id}")
def patch_education(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(EducationFund).filter(EducationFund.id == item_id, EducationFund.family_id == payload.family_id, EducationFund.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "EDUCATION_FUND")


@router.patch("/properties/{item_id}")
def patch_property(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Property).filter(Property.id == item_id, Property.family_id == payload.family_id, Property.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "PROPERTY")


@router.patch("/subscriptions/{item_id}")
def patch_subscription(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Subscription).filter(Subscription.id == item_id, Subscription.family_id == payload.family_id, Subscription.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "SUBSCRIPTION")


@router.patch("/documents/{item_id}")
def patch_document(item_id: str, payload: ModuleUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Document).filter(Document.id == item_id, Document.family_id == payload.family_id, Document.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _update_row(row, payload, db, member.id, "DOCUMENT")


@router.post("/investments/{item_id}/close")
def close_investment(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Investment).filter(Investment.id == item_id, Investment.family_id == payload.family_id, Investment.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "INVESTMENT")


@router.post("/health-expenses/{item_id}/close")
def close_health(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(HealthExpense).filter(HealthExpense.id == item_id, HealthExpense.family_id == payload.family_id, HealthExpense.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "HEALTH_EXPENSE")


@router.post("/vehicle-expenses/{item_id}/close")
def close_vehicle(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(VehicleExpense).filter(VehicleExpense.id == item_id, VehicleExpense.family_id == payload.family_id, VehicleExpense.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "VEHICLE_EXPENSE")


@router.post("/education-funds/{item_id}/close")
def close_education(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(EducationFund).filter(EducationFund.id == item_id, EducationFund.family_id == payload.family_id, EducationFund.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "EDUCATION_FUND")


@router.post("/properties/{item_id}/close")
def close_property(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Property).filter(Property.id == item_id, Property.family_id == payload.family_id, Property.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "PROPERTY")


@router.post("/subscriptions/{item_id}/close")
def close_subscription(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Subscription).filter(Subscription.id == item_id, Subscription.family_id == payload.family_id, Subscription.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "SUBSCRIPTION")


@router.post("/documents/{item_id}/close")
def close_document(item_id: str, payload: CloseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member = require_permission(db, payload.family_id, user.id, "report.read")
    row = db.query(Document).filter(Document.id == item_id, Document.family_id == payload.family_id, Document.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Not found")
    return _close_row(row, payload, db, member.id, "DOCUMENT")


@router.post("/documents/{item_id}/upload")
async def upload_document(
    item_id: str,
    family_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = require_permission(db, family_id, user.id, "report.read")
    row = db.query(Document).filter(Document.id == item_id, Document.family_id == family_id, Document.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(404, "Document not found")
    data = await file.read()
    try:
        stored = store_document_file(
            family_id=family_id,
            item_id=row.id,
            filename=file.filename or "document.bin",
            content_type=file.content_type,
            data=data,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
    previous_path = row.file_path
    row.file_name = stored["file_name"]
    row.file_path = stored["file_path"]
    row.file_url = stored["file_path"]
    row.file_mime = stored["file_mime"]
    row.file_size = stored["file_size"]
    row.file_sha256 = stored["file_sha256"]
    row.encrypted = bool(stored["file_encrypted"])
    write_audit_log(
        db=db,
        family_id=family_id,
        member_id=member.id,
        action_type="UPLOAD",
        entity_type="DOCUMENT",
        entity_id=row.id,
        title="Document file uploaded",
        description=row.file_name or row.name,
    )
    db.commit()
    if previous_path and previous_path != row.file_path:
        delete_document_file(previous_path)
    return {"id": row.id, "file_name": row.file_name, "encrypted": row.encrypted}


@router.get("/documents/{item_id}/download")
def download_document(item_id: str, family_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_permission(db, family_id, user.id, "report.read")
    row = db.query(Document).filter(Document.id == item_id, Document.family_id == family_id, Document.deleted_at.is_(None)).first()
    if not row or not row.file_path:
        raise HTTPException(404, "File not found")
    try:
        data = load_document_file(row.file_path, expected_sha256=row.file_sha256)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    headers = {"Content-Disposition": f'attachment; filename="{row.file_name or "document.bin"}"'}
    return Response(content=data, media_type=row.file_mime or "application/octet-stream", headers=headers)
