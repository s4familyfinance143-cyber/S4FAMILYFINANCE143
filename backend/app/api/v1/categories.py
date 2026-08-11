from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.architecture_feature import ExpenseCategory, IncomeCategory
from app.models.category import Category
from app.models.family_member import FamilyMember
from app.models.user import User
from app.schemas.category import CategoryCreateRequest, CategoryResponse

router = APIRouter(prefix="/categories", tags=["Categories"])

VALID_CATEGORY_TYPES = {"INCOME", "EXPENSE"}


DEFAULT_CATEGORIES = [
    # Income
    {"name_bn": "বেতন", "name_en": "Salary", "category_type": "INCOME", "icon": "salary", "color": "#16A34A"},
    {"name_bn": "ব্যবসা", "name_en": "Business", "category_type": "INCOME", "icon": "business", "color": "#15803D"},
    {"name_bn": "ফ্রিল্যান্স", "name_en": "Freelance", "category_type": "INCOME", "icon": "freelance", "color": "#0D9488"},
    {"name_bn": "উপহার", "name_en": "Gift", "category_type": "INCOME", "icon": "gift", "color": "#22C55E"},
    {"name_bn": "ভাড়া আয়", "name_en": "Rental Income", "category_type": "INCOME", "icon": "home", "color": "#65A30D"},
    {"name_bn": "অন্যান্য আয়", "name_en": "Other Income", "category_type": "INCOME", "icon": "other", "color": "#84CC16"},
    # Expense (10+)
    {"name_bn": "খাবার", "name_en": "Food", "category_type": "EXPENSE", "icon": "food", "color": "#DC2626"},
    {"name_bn": "মুদি", "name_en": "Grocery", "category_type": "EXPENSE", "icon": "cart", "color": "#EA580C"},
    {"name_bn": "পরিবহন", "name_en": "Transport", "category_type": "EXPENSE", "icon": "car", "color": "#D97706"},
    {"name_bn": "চিকিৎসা", "name_en": "Medical", "category_type": "EXPENSE", "icon": "medical", "color": "#BE123C"},
    {"name_bn": "শিক্ষা", "name_en": "Education", "category_type": "EXPENSE", "icon": "book", "color": "#2563EB"},
    {"name_bn": "ইউটিলিটি", "name_en": "Utility", "category_type": "EXPENSE", "icon": "bill", "color": "#7C3AED"},
    {"name_bn": "বাড়ি ভাড়া", "name_en": "Rent", "category_type": "EXPENSE", "icon": "rent", "color": "#9333EA"},
    {"name_bn": "বিনোদন", "name_en": "Entertainment", "category_type": "EXPENSE", "icon": "fun", "color": "#DB2777"},
    {"name_bn": "কেনাকাটা", "name_en": "Shopping", "category_type": "EXPENSE", "icon": "bag", "color": "#C026D3"},
    {"name_bn": "যোগাযোগ", "name_en": "Communication", "category_type": "EXPENSE", "icon": "phone", "color": "#0891B2"},
    {"name_bn": "ব্যক্তিগত যত্ন", "name_en": "Personal Care", "category_type": "EXPENSE", "icon": "care", "color": "#0E7490"},
    {"name_bn": "বীমা", "name_en": "Insurance", "category_type": "EXPENSE", "icon": "shield", "color": "#4F46E5"},
    {"name_bn": "দান/সদকা", "name_en": "Charity", "category_type": "EXPENSE", "icon": "heart", "color": "#059669"},
    {"name_bn": "অন্যান্য খরচ", "name_en": "Other Expense", "category_type": "EXPENSE", "icon": "other", "color": "#64748B"},
]


def _dual_write_category(db: Session, category: Category) -> None:
    """Mirror a newly created Category into the architecture checklist split tables
    (expense_categories / income_categories) keyed by legacy_category_id."""
    is_expense = "EXPENSE" in (category.category_type or "").upper()
    model = ExpenseCategory if is_expense else IncomeCategory
    existing = (
        db.query(model)
        .filter(model.legacy_category_id == category.id, model.deleted_at.is_(None))
        .first()
    )
    if existing:
        return
    kwargs = dict(
        family_id=category.family_id,
        name=category.name_en or category.name_bn,
        name_bn=category.name_bn,
        name_en=category.name_en,
        icon=category.icon,
        color=category.color,
        is_system=category.is_system,
        is_active=category.is_active,
        legacy_category_id=category.id,
    )
    if is_expense:
        kwargs["parent_id"] = category.parent_id
    db.add(model(**kwargs))


def get_active_member(db: Session, family_id: str, user_id: str) -> FamilyMember | None:
    return (
        db.query(FamilyMember)
        .filter(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user_id,
            FamilyMember.status == "ACTIVE",
            FamilyMember.deleted_at.is_(None),
        )
        .first()
    )


@router.post("/seed/{family_id}")
def seed_default_categories(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = get_active_member(db, family_id, current_user.id)

    if not member or member.role not in {"OWNER", "ADMIN"}:
        raise HTTPException(403, "Owner/Admin required")

    created = 0

    for item in DEFAULT_CATEGORIES:
        exists = (
            db.query(Category)
            .filter(
                Category.family_id == family_id,
                Category.name_en == item["name_en"],
                Category.category_type == item["category_type"],
                Category.deleted_at.is_(None),
            )
            .first()
        )

        if exists:
            continue

        category = Category(
            family_id=family_id,
            name_bn=item["name_bn"],
            name_en=item["name_en"],
            category_type=item["category_type"],
            icon=item["icon"],
            color=item["color"],
            is_system=True,
            is_active=True,
        )
        db.add(category)
        db.flush()
        _dual_write_category(db, category)
        created += 1

    db.commit()

    return {
        "success": True,
        "created": created,
        "message": "Default categories seeded",
    }


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = get_active_member(db, payload.family_id, current_user.id)

    if not member or member.role not in {"OWNER", "ADMIN"}:
        raise HTTPException(403, "Owner/Admin required")

    category_type = payload.category_type.upper().strip()

    if category_type not in VALID_CATEGORY_TYPES:
        raise HTTPException(400, "Invalid category type")

    duplicate = (
        db.query(Category)
        .filter(
            Category.family_id == payload.family_id,
            Category.name_en == payload.name_en.strip(),
            Category.category_type == category_type,
            Category.deleted_at.is_(None),
        )
        .first()
    )

    if duplicate:
        raise HTTPException(409, "Category already exists")

    category = Category(
        family_id=payload.family_id,
        parent_id=payload.parent_id,
        name_bn=payload.name_bn.strip(),
        name_en=payload.name_en.strip(),
        category_type=category_type,
        icon=payload.icon,
        color=payload.color,
        is_system=False,
        is_active=True,
    )

    db.add(category)
    db.flush()
    _dual_write_category(db, category)
    db.commit()
    db.refresh(category)

    return category


@router.get("/family/{family_id}", response_model=list[CategoryResponse])
def list_categories(
    family_id: str,
    category_type: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = get_active_member(db, family_id, current_user.id)

    if not member:
        raise HTTPException(403, "You are not an active family member")

    query = (
        db.query(Category)
        .filter(
            Category.family_id == family_id,
            Category.is_active.is_(True),
            Category.deleted_at.is_(None),
        )
        .order_by(Category.category_type.asc(), Category.name_en.asc())
    )

    if category_type:
        query = query.filter(Category.category_type == category_type.upper().strip())

    return query.all()


@router.delete("/{category_id}")
def delete_category(
    category_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    category = db.get(Category, category_id)

    if not category or category.deleted_at is not None:
        raise HTTPException(404, "Category not found")

    member = get_active_member(db, category.family_id, current_user.id)

    if not member or member.role not in {"OWNER", "ADMIN"}:
        raise HTTPException(403, "Owner/Admin required")

    if category.is_system:
        raise HTTPException(400, "System category cannot be deleted")

    from datetime import datetime, timezone
    category.is_active = False
    category.deleted_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "success": True,
        "message": "Category deleted",
    }
