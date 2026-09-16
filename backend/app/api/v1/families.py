from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.user import User
from app.services.permission_service import require_permission

router = APIRouter(prefix="/families", tags=["Families"])


class FamilyCurrencyUpdate(BaseModel):
    default_currency: str


class FamilySettingsUpdate(BaseModel):
    default_currency: str | None = None
    timezone: str | None = None


@router.get("/my-memberships")
def get_my_memberships(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    memberships = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.user_id == current_user.id,
            FamilyMember.deleted_at.is_(None),
        )
        .all()
    )

    return memberships


@router.patch("/{family_id}/currency")
def update_family_currency(
    family_id: str,
    payload: FamilyCurrencyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _role=Depends(require_role("ADMIN")),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="settings.manage",
    )

    family = db.get(Family, family_id)

    if not family or family.deleted_at is not None:
        raise HTTPException(404, "Family not found")

    currency = payload.default_currency.upper().strip()

    if len(currency) < 3 or len(currency) > 10:
        raise HTTPException(400, "Invalid currency code")

    old_currency = family.default_currency
    family.default_currency = currency

    db.commit()
    db.refresh(family)

    return {
        "success": True,
        "family_id": family.id,
        "old_currency": old_currency,
        "new_currency": family.default_currency,
    }


@router.patch("/{family_id}/settings")
def update_family_settings(
    family_id: str,
    payload: FamilySettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="settings.manage",
    )

    family = db.get(Family, family_id)

    if not family or family.deleted_at is not None:
        raise HTTPException(404, "Family not found")

    if payload.default_currency is None and payload.timezone is None:
        raise HTTPException(400, "No settings provided")

    old_currency = family.default_currency
    old_timezone = family.timezone

    if payload.default_currency is not None:
        currency = payload.default_currency.upper().strip()
        if len(currency) < 3 or len(currency) > 10:
            raise HTTPException(400, "Invalid currency code")
        family.default_currency = currency

    if payload.timezone is not None:
        timezone = payload.timezone.strip()
        if len(timezone) < 2 or len(timezone) > 64:
            raise HTTPException(400, "Invalid timezone")
        family.timezone = timezone

    db.commit()
    db.refresh(family)

    return {
        "success": True,
        "family_id": family.id,
        "old_currency": old_currency,
        "new_currency": family.default_currency,
        "old_timezone": old_timezone,
        "new_timezone": family.timezone,
    }

