from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.family import Family
from app.models.family_member import FamilyMember
from app.models.relationship_type import RelationshipType
from app.models.user import User
from app.schemas.family import FamilyCreateRequest, FamilyResponse

router = APIRouter(prefix="/families", tags=["Families"])


@router.post("", response_model=FamilyResponse, status_code=status.HTTP_201_CREATED)
def create_family(
    payload: FamilyCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing_family = (
        db.query(FamilyMember)
        .filter(
            FamilyMember.user_id == current_user.id,
            FamilyMember.role == "OWNER",
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )

    if existing_family:
        raise HTTPException(
            status_code=409,
            detail="You already own a family",
        )

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
    families = (
        db.query(Family)
        .join(FamilyMember, Family.id == FamilyMember.family_id)
        .filter(
            FamilyMember.user_id == current_user.id,
            FamilyMember.deleted_at.is_(None),
            Family.deleted_at.is_(None),
        )
        .all()
    )

    return families


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
