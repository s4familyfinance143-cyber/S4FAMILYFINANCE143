"""Architecture checklist: tags, transaction_tags, loan_payments, category splits, vendors, grocery lines."""

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Tag(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("family_id", "name", name="uq_tags_family_name"),)

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)


class TransactionTag(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "transaction_tags"
    __table_args__ = (
        UniqueConstraint("transaction_id", "tag_id", name="uq_transaction_tags_pair"),
    )

    transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"), index=True, nullable=False)
    tag_id: Mapped[str] = mapped_column(ForeignKey("tags.id"), index=True, nullable=False)


class LoanPayment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "loan_payments"

    loan_id: Mapped[str] = mapped_column(ForeignKey("loans.id"), index=True, nullable=False)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    payment_date: Mapped[str] = mapped_column(String(30), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(ForeignKey("transactions.id"), index=True, nullable=True)


class ExpenseCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "expense_categories"

    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("expense_categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_bn: Mapped[str | None] = mapped_column(String(120), nullable=True)
    name_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    legacy_category_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class IncomeCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "income_categories"

    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_bn: Mapped[str | None] = mapped_column(String(120), nullable=True)
    name_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    legacy_category_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class VendorContact(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "vendor_contacts"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="GENERAL", index=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    legacy_grocery_vendor_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)


class GroceryListItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Architecture line-items table (migrated from grocery_items list rows)."""

    __tablename__ = "grocery_list_items"
    __table_args__ = (
        UniqueConstraint("family_id", "mobile_sync_key", name="uq_grocery_list_items_family_mobile_sync_key"),
    )

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), index=True, nullable=False)
    list_id: Mapped[str] = mapped_column(ForeignKey("grocery_lists.id"), index=True, nullable=False)
    item_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)  # optional catalog link
    created_by_member_id: Mapped[str] = mapped_column(ForeignKey("family_members.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("1"), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), default="pcs", nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    is_bought: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    bought_by: Mapped[str | None] = mapped_column(ForeignKey("family_members.id"), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="GENERAL", nullable=False)
    mobile_sync_key: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    legacy_grocery_item_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
