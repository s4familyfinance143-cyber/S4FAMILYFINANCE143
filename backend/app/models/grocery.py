from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class GroceryList(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "grocery_lists"
    __table_args__ = (UniqueConstraint("family_id", "mobile_sync_key", name="uq_grocery_lists_family_mobile_sync_key"),)

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="OPEN", index=True, nullable=False)
    budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="BDT", nullable=False)
    vendor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    shopping_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    mobile_sync_key: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    sync_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_client_updated_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class GroceryItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "grocery_items"
    __table_args__ = (UniqueConstraint("family_id", "mobile_sync_key", name="uq_grocery_items_family_mobile_sync_key"),)

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    grocery_list_id: Mapped[str] = mapped_column(ForeignKey("grocery_lists.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    posted_transaction_id: Mapped[str | None] = mapped_column(ForeignKey("transactions.id"), index=True, nullable=True)

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("1"), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), default="pcs", nullable=False)
    estimated_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    actual_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    vendor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mobile_sync_key: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    sync_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_client_updated_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_bought: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class GroceryVendor(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "grocery_vendors"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)

    name: Mapped[str] = mapped_column(String(150), index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
