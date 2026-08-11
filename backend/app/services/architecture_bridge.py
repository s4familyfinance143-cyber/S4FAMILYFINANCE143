"""Architecture dual-write bridges: phase15/16 → dedicated tables; auth → refresh/device/push."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.architecture_auth import PushToken, UserPreference
from app.models.architecture_modules import (
    Document,
    HealthExpense,
    Investment,
    Property,
    Subscription,
    VehicleExpense,
)
from app.models.phase15 import Phase15Item
from app.models.phase16 import Phase16Item
from app.models.push_device import PushDevice
from app.models.user import User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_user_preference(db: Session, user: User) -> UserPreference:
    pref = db.query(UserPreference).filter(UserPreference.user_id == user.id, UserPreference.deleted_at.is_(None)).first()
    if pref:
        return pref
    pref = UserPreference(
        user_id=user.id,
        language=user.preferred_language or "bn",
        theme="light",
        notification_on=True,
        currency="BDT",
    )
    db.add(pref)
    return pref


def mirror_push_device(db: Session, device: PushDevice) -> None:
    existing = (
        db.query(PushToken)
        .filter(PushToken.legacy_push_device_id == device.id, PushToken.deleted_at.is_(None))
        .first()
    )
    if existing:
        existing.fcm_token = device.token
        existing.platform = device.platform
        existing.is_active = device.is_active
        existing.family_id = device.family_id
        existing.updated_at = _now()
        return
    db.add(
        PushToken(
            user_id=device.user_id,
            device_id=device.device_label,
            fcm_token=device.token,
            platform=device.platform or "UNKNOWN",
            is_active=device.is_active,
            family_id=device.family_id,
            legacy_push_device_id=device.id,
        )
    )


def _dec(v) -> Decimal:
    try:
        return Decimal(str(v or 0))
    except Exception:
        return Decimal("0")


def mirror_phase15_item(db: Session, item: Phase15Item) -> None:
    mt = (item.module_type or "").upper()
    if mt == "INVESTMENT":
        row = db.query(Investment).filter(Investment.legacy_phase15_id == item.id).first()
        if row is None:
            row = Investment(legacy_phase15_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.member_id = item.member_id
        row.type = item.sub_type or item.category or "GENERAL"
        row.name = item.name
        row.principal = _dec(item.amount)
        row.rate = _dec(item.secondary_amount) if item.secondary_amount is not None else None
        row.start_date = item.secondary_date
        row.maturity = item.target_date
        row.currency = item.currency or "BDT"
        row.status = item.status
        row.note = item.note
        row.deleted_at = item.deleted_at
    elif mt == "HEALTH":
        row = db.query(HealthExpense).filter(HealthExpense.legacy_phase15_id == item.id).first()
        if row is None:
            row = HealthExpense(legacy_phase15_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.member_id = item.member_id
        row.type = item.sub_type or item.category or "GENERAL"
        row.doctor = item.provider
        row.amount = _dec(item.amount)
        row.expense_date = item.target_date or item.secondary_date
        row.currency = item.currency or "BDT"
        row.notes = item.note
        row.status = item.status
        row.deleted_at = item.deleted_at
    elif mt == "VEHICLE":
        row = db.query(VehicleExpense).filter(VehicleExpense.legacy_phase15_id == item.id).first()
        if row is None:
            row = VehicleExpense(legacy_phase15_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.vehicle_name = item.name
        row.type = item.sub_type or item.category or "GENERAL"
        row.amount = _dec(item.amount)
        row.km_reading = _dec(item.secondary_amount) if item.secondary_amount is not None else None
        row.expense_date = item.target_date or item.secondary_date
        row.currency = item.currency or "BDT"
        row.notes = item.note
        row.status = item.status
        row.deleted_at = item.deleted_at
    elif mt == "EDUCATION":
        from app.models.architecture_modules import EducationFund

        row = db.query(EducationFund).filter(EducationFund.legacy_phase15_id == item.id).first()
        if row is None:
            row = EducationFund(legacy_phase15_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.member_id = item.member_id
        row.name = item.name
        row.type = item.sub_type or item.category or "GENERAL"
        row.provider = item.provider
        row.amount = _dec(item.amount)
        row.target_date = item.target_date
        row.currency = item.currency or "BDT"
        row.status = item.status
        row.notes = item.note
        row.deleted_at = item.deleted_at


def mirror_phase16_item(db: Session, item: Phase16Item) -> None:
    mt = (item.module_type or "").upper()
    if mt == "PROPERTY":
        row = db.query(Property).filter(Property.legacy_phase16_id == item.id).first()
        if row is None:
            row = Property(legacy_phase16_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.name = item.name
        row.type = item.sub_type or item.category or "GENERAL"
        row.value = _dec(item.amount)
        row.rent_income = _dec(item.secondary_amount) if item.secondary_amount is not None else None
        row.location = item.provider
        row.area = item.reference
        row.currency = item.currency or "BDT"
        row.status = item.status
        row.notes = item.note
        row.deleted_at = item.deleted_at
    elif mt == "SUBSCRIPTION":
        row = db.query(Subscription).filter(Subscription.legacy_phase16_id == item.id).first()
        if row is None:
            row = Subscription(legacy_phase16_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.name = item.name
        row.amount = _dec(item.amount)
        row.cycle = item.billing_cycle or "MONTHLY"
        row.next_due = item.renewal_or_expiry_date
        row.status = item.status
        row.auto_remind = True
        row.currency = item.currency or "BDT"
        row.payment_account_id = item.payment_account_id
        row.notes = item.note
        row.deleted_at = item.deleted_at
    elif mt == "DOCUMENT":
        row = db.query(Document).filter(Document.legacy_phase16_id == item.id).first()
        if row is None:
            row = Document(legacy_phase16_id=item.id, family_id=item.family_id, created_by_member_id=item.created_by_member_id)
            db.add(row)
        row.member_id = item.member_id
        row.name = item.name
        row.type = item.sub_type or item.category or "GENERAL"
        row.file_url = item.file_path
        row.expiry_date = item.renewal_or_expiry_date
        row.encrypted = bool(item.file_encrypted)
        row.file_name = item.file_name
        row.file_path = item.file_path
        row.file_mime = item.file_mime
        row.file_size = item.file_size
        row.file_sha256 = item.file_sha256
        row.status = item.status
        row.notes = item.note
        row.deleted_at = item.deleted_at
