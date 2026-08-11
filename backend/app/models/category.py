from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Category(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "categories"

    family_id: Mapped[str | None] = mapped_column(ForeignKey("families.id"), index=True, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)

    name_bn: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    category_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)

    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)

    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
