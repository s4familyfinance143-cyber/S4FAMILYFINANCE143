from decimal import Decimal

from pydantic import BaseModel, Field


class GroceryListCreateRequest(BaseModel):
    family_id: str
    name: str | None = Field(default=None, min_length=1, max_length=150)
    title: str | None = Field(default=None, min_length=1, max_length=150)  # compat alias → name
    budget_amount: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = "BDT"
    vendor_name: str | None = Field(default=None, max_length=150)
    shopping_date: str | None = None
    mobile_sync_key: str | None = Field(default=None, max_length=120)
    expected_sync_version: int | None = Field(default=None, ge=1)
    client_updated_at: str | None = Field(default=None, max_length=40)
    note: str | None = None

    def resolved_name(self) -> str:
        value = (self.name or self.title or "").strip()
        if not value:
            raise ValueError("name/title required")
        return value


class GroceryListUpdateRequest(BaseModel):
    family_id: str
    name: str | None = Field(default=None, min_length=1, max_length=150)
    title: str | None = Field(default=None, min_length=1, max_length=150)  # compat alias → name
    budget_amount: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = "BDT"
    vendor_name: str | None = Field(default=None, max_length=150)
    shopping_date: str | None = None
    expected_sync_version: int | None = Field(default=None, ge=1)
    client_updated_at: str | None = Field(default=None, max_length=40)
    note: str | None = None

    def resolved_name(self) -> str:
        value = (self.name or self.title or "").strip()
        if not value:
            raise ValueError("name/title required")
        return value


class GroceryItemCreateRequest(BaseModel):
    family_id: str
    grocery_list_id: str
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit: str = Field(default="pcs", max_length=30)
    estimated_price: Decimal = Field(default=Decimal("0"), ge=0)
    actual_price: Decimal = Field(default=Decimal("0"), ge=0)
    vendor_name: str | None = Field(default=None, max_length=150)
    barcode: str | None = Field(default=None, max_length=120)
    mobile_sync_key: str | None = Field(default=None, max_length=120)
    expected_sync_version: int | None = Field(default=None, ge=1)
    client_updated_at: str | None = Field(default=None, max_length=40)
    note: str | None = None


class GroceryItemUpdateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(default="GENERAL", max_length=80)
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit: str = Field(default="pcs", max_length=30)
    estimated_price: Decimal = Field(default=Decimal("0"), ge=0)
    actual_price: Decimal = Field(default=Decimal("0"), ge=0)
    vendor_name: str | None = Field(default=None, max_length=150)
    barcode: str | None = Field(default=None, max_length=120)
    expected_sync_version: int | None = Field(default=None, ge=1)
    client_updated_at: str | None = Field(default=None, max_length=40)
    note: str | None = None


class GroceryItemBuyRequest(BaseModel):
    family_id: str
    actual_price: Decimal = Field(default=Decimal("0"), ge=0)
    vendor_name: str | None = Field(default=None, max_length=150)
    expected_sync_version: int | None = Field(default=None, ge=1)
    client_updated_at: str | None = Field(default=None, max_length=40)


class GroceryVendorCreateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    phone: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=255)
    category: str = Field(default="GENERAL", max_length=80)
    note: str | None = None


class GroceryVendorUpdateRequest(BaseModel):
    family_id: str
    name: str = Field(min_length=1, max_length=150)
    phone: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=255)
    category: str = Field(default="GENERAL", max_length=80)
    note: str | None = None
    is_active: bool = True


class GroceryPostExpenseRequest(BaseModel):
    family_id: str
    account_id: str
    category_id: str
    amount: Decimal | None = Field(default=None, gt=0)
    description: str | None = None


class GroceryOcrParseRequest(BaseModel):
    family_id: str
    raw_text: str = Field(default="", max_length=10000)
