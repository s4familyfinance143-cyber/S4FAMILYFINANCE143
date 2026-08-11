from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.relationship_type import RelationshipType
from app.models.user import User
from app.schemas.family import FamilyCreateRequest, FamilyResponse
from app.services.permission_service import require_permission

router = APIRouter(prefix="/families", tags=["Families"])


class FamilyCurrencyUpdate(BaseModel):
    default_currency: str


class FamilySettingsUpdate(BaseModel):
    default_currency: str | None = None
    timezone: str | None = None


@router.post("", response_model=FamilyResponse, status_code=status.HTTP_201_CREATED)
def create_family(
    payload: FamilyCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Architecture: multi-family support — owning a 2nd family is allowed.
    relationship = (
        db.query(RelationshipType)
        .filter(
            RelationshipType.name_en.ilike(payload.responsible_person_type)
        )
        .first()
    )

    if not relationship:
        relationship = RelationshipType(
            name_bn=payload.responsible_person_type,
            name_en=payload.responsible_person_type,
            group_name="RESPONSIBLE_PERSON",
            needs_serial=False,
            is_system=True,
            is_active=True,
        )
        db.add(relationship)
        db.flush()

    family = Family(
        name=payload.family_name.strip(),
        owner_user_id=current_user.id,
        default_currency=payload.currency,
        timezone=payload.timezone,
        is_active=True,
    )

    db.add(family)
    db.flush()

    owner_member = FamilyMember(
        family_id=family.id,
        user_id=current_user.id,
        role="OWNER",
        status="ACTIVE",
        relationship_type_id=relationship.id,
        relationship_display_label=payload.responsible_person_type,
        can_login_family=True,
    )

    db.add(owner_member)
    db.flush()

    family.main_responsible_member_id = owner_member.id

    db.commit()
    db.refresh(family)

    return family


@router.get("", response_model=list[FamilyResponse])
def get_my_families(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.repositories import family_repo

    return family_repo(db).list_active_for_user(current_user.id)


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

