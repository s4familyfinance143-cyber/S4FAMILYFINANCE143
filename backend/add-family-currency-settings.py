from pathlib import Path

p = Path("app/api/v1/families.py")
text = p.read_text(encoding="utf-8")

if "from pydantic import BaseModel" not in text:
    text = text.replace(
        "from fastapi import APIRouter, Depends, HTTPException, status",
        "from fastapi import APIRouter, Depends, HTTPException, status\nfrom pydantic import BaseModel",
        1,
    )

if "require_permission" not in text:
    text = text.replace(
        "from app.schemas.family import FamilyCreateRequest, FamilyResponse",
        "from app.schemas.family import FamilyCreateRequest, FamilyResponse\nfrom app.services.permission_service import require_permission",
        1,
    )

if "class FamilyCurrencyUpdate" not in text:
    text = text.replace(
        "router = APIRouter(prefix=\"/families\", tags=[\"Families\"])",
        "router = APIRouter(prefix=\"/families\", tags=[\"Families\"])\n\n\nclass FamilyCurrencyUpdate(BaseModel):\n    default_currency: str",
        1,
    )

if '@router.patch("/{family_id}/currency")' not in text:
    text += '''

@router.patch("/{family_id}/currency")
def update_family_currency(
    family_id: str,
    payload: FamilyCurrencyUpdate,
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

'''

p.write_text(text, encoding="utf-8")
print("FAMILY CURRENCY SETTINGS ADDED")
