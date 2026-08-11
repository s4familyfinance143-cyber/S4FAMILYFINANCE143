"""Repository pattern — thin DB access helpers used by services/routes."""

from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy.orm import Session

from app.models.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, db: Session):
        self.db = db

    def get(self, entity_id: str) -> ModelT | None:
        return self.db.get(self.model, entity_id)

    def add(self, entity: ModelT) -> ModelT:
        self.db.add(entity)
        return entity

    def delete_soft(self, entity: ModelT) -> ModelT:
        from datetime import datetime, timezone

        if hasattr(entity, "deleted_at"):
            entity.deleted_at = datetime.now(timezone.utc)
        return entity

    def commit(self) -> None:
        self.db.commit()

    def refresh(self, entity: ModelT) -> ModelT:
        self.db.refresh(entity)
        return entity
