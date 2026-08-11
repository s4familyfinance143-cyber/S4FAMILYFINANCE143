from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.zakat import ZakatRecord
from app.models.missing_features import MetalRate
from app.schemas.zakat import ZakatCalculateRequest
from app.services.audit_service import write_audit_log
from app.services.permission_service import require_permission

router = APIRouter(prefix="/zakat", tags=["Zakat"])

MONEY_SCALE = Decimal("0.0001")
ZAKAT_RATE = Decimal("0.025")
GOLD_NISAB_GRAMS = Decimal("87.48")
SILVER_NISAB_GRAMS = Decimal("612.36")


def money(value) -> str:
    return str(Decimal(value or 0).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP))


def clean_currency(value: str | None) -> str:
    return str(value or "BDT").strip().upper()[:10]


def _latest_metal_rate(db: Session, metal: str) -> MetalRate | None:
    return (
        db.query(MetalRate)
        .filter(MetalRate.metal == metal.upper(), MetalRate.deleted_at.is_(None))
        .order_by(MetalRate.effective_date.desc(), MetalRate.created_at.desc())
        .first()
    )


def resolve_metal_values(db: Session, payload: ZakatCalculateRequest) -> tuple[Decimal, Decimal, Decimal]:
    """Return (gold_value, silver_value, nisab_amount), filling from rates when grams given."""
    gold_value = Decimal(payload.gold_value or 0)
    silver_value = Decimal(payload.silver_value or 0)

    if payload.gold_grams is not None:
        rate = _latest_metal_rate(db, "GOLD")
        if not rate:
            raise HTTPException(400, "Gold rate not configured; set /zakat/metal-rates first")
        gold_value = (Decimal(payload.gold_grams) * Decimal(rate.rate_bdt)).quantize(
            MONEY_SCALE, rounding=ROUND_HALF_UP
        )

    if payload.silver_grams is not None:
        rate = _latest_metal_rate(db, "SILVER")
        if not rate:
            raise HTTPException(400, "Silver rate not configured; set /zakat/metal-rates first")
        silver_value = (Decimal(payload.silver_grams) * Decimal(rate.rate_bdt)).quantize(
            MONEY_SCALE, rounding=ROUND_HALF_UP
        )

    if payload.nisab_amount is not None and Decimal(payload.nisab_amount) > 0:
        nisab = Decimal(payload.nisab_amount)
    else:
        metal = (payload.nisab_metal or "SILVER").upper()
        rate = _latest_metal_rate(db, metal)
        if not rate:
            raise HTTPException(400, f"{metal} rate not configured for auto nisab")
        grams = GOLD_NISAB_GRAMS if metal == "GOLD" else SILVER_NISAB_GRAMS
        nisab = (Decimal(rate.rate_bdt) * grams).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)

    return gold_value, silver_value, nisab


def apply_zakat_values(
    record: ZakatRecord,
    payload: ZakatCalculateRequest,
    member_id: str,
    zakatable_amount: Decimal,
    zakat_due: Decimal,
    *,
    gold_value: Decimal,
    silver_value: Decimal,
    nisab_amount: Decimal,
) -> None:
    record.created_by_member_id = member_id
    record.calculation_year = payload.calculation_year.strip()
    record.currency = clean_currency(payload.currency)
    record.cash_amount = payload.cash_amount
    record.gold_value = gold_value
    record.silver_value = silver_value
    record.investment_value = payload.investment_value
    record.business_assets = payload.business_assets
    record.receivables = payload.receivables
    record.deductible_debts = payload.deductible_debts
    record.nisab_amount = nisab_amount
    record.zakatable_amount = zakatable_amount
    record.zakat_due = zakat_due
    record.status = "CALCULATED"
    record.note = payload.note.strip() if payload.note else None


def zakat_response(record: ZakatRecord) -> dict:
    return {
        "id": record.id,
        "family_id": record.family_id,
        "calculation_year": record.calculation_year,
        "currency": record.currency,
        "cash_amount": money(record.cash_amount),
        "gold_value": money(record.gold_value),
        "silver_value": money(record.silver_value),
        "investment_value": money(record.investment_value),
        "business_assets": money(record.business_assets),
        "receivables": money(record.receivables),
        "deductible_debts": money(record.deductible_debts),
        "nisab_amount": money(record.nisab_amount),
        "zakatable_amount": money(record.zakatable_amount),
        "zakat_due": money(record.zakat_due),
        "is_zakat_due": Decimal(record.zakatable_amount or 0) >= Decimal(record.nisab_amount or 0),
        "rate_percent": "2.50",
        "status": record.status,
        "note": record.note,
        "created_at": record.created_at,
    }


@router.post("/calculate")
def calculate_zakat(
    payload: ZakatCalculateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = require_permission(db, payload.family_id, current_user.id, "report.read")

    gold_value, silver_value, nisab_amount = resolve_metal_values(db, payload)

    assets = (
        payload.cash_amount
        + gold_value
        + silver_value
        + payload.investment_value
        + payload.business_assets
        + payload.receivables
    )
    zakatable_amount = max(assets - payload.deductible_debts, Decimal("0"))
    zakat_due = zakatable_amount * ZAKAT_RATE if zakatable_amount >= nisab_amount else Decimal("0")

    calculation_year = payload.calculation_year.strip()
    currency = clean_currency(payload.currency)
    record = (
        db.query(ZakatRecord)
        .filter(
            ZakatRecord.family_id == payload.family_id,
            ZakatRecord.calculation_year == calculation_year,
            ZakatRecord.currency == currency,
            ZakatRecord.deleted_at.is_(None),
        )
        .first()
    )

    action_type = "UPDATE" if record else "CALCULATE"
    if not record:
        record = ZakatRecord(family_id=payload.family_id, created_by_member_id=member.id)
        db.add(record)

    apply_zakat_values(
        record,
        payload,
        member.id,
        zakatable_amount,
        zakat_due,
        gold_value=gold_value,
        silver_value=silver_value,
        nisab_amount=nisab_amount,
    )
    db.flush()

    write_audit_log(
        db=db,
        family_id=payload.family_id,
        member_id=member.id,
        action_type=action_type,
        entity_type="ZAKAT",
        entity_id=record.id,
        title="Zakat Calculated" if action_type == "CALCULATE" else "Zakat Updated",
        description=f"Zakat due {money(record.zakat_due)} {record.currency} for {record.calculation_year}",
    )

    db.commit()
    db.refresh(record)
    return zakat_response(record)


@router.get("/summary/{family_id}")
def zakat_summary(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")

    records = (
        db.query(ZakatRecord)
        .filter(ZakatRecord.family_id == family_id, ZakatRecord.deleted_at.is_(None))
        .order_by(ZakatRecord.created_at.desc())
        .all()
    )

    total_due = sum(Decimal(record.zakat_due or 0) for record in records)
    latest = max(records, key=lambda record: record.created_at) if records else None


    return {
        "family_id": family_id,
        "record_count": len(records),
        "total_zakat_due": money(total_due),
        "latest": zakat_response(latest) if latest else None,
    }


@router.get("/{family_id}")
def list_zakat_records(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(db, family_id, current_user.id, "report.read")

    records = (
        db.query(ZakatRecord)
        .filter(ZakatRecord.family_id == family_id, ZakatRecord.deleted_at.is_(None))
        .order_by(ZakatRecord.created_at.desc())
        .all()
    )

    return [zakat_response(record) for record in records]
