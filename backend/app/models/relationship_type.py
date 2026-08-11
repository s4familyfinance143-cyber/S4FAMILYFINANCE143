from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RelationshipType(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "relationship_types"

    name_bn: Mapped[str] = mapped_column(String(80), nullable=False)
    name_en: Mapped[str] = mapped_column(String(80), nullable=False)
    group_name: Mapped[str] = mapped_column(String(80), index=True, nullable=False)

    needs_serial: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
