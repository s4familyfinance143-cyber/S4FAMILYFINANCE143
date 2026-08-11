"""SQLAlchemy event listeners → audit_logs for CREATE/UPDATE/DELETE (architecture).

Uses connection-level INSERT (not Session.add) so writes are safe during flush.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import event, insert
from sqlalchemy.orm import Mapper

_SKIP_TABLES = {
    "audit_logs",
    "api_logs",
    "rate_limits",
    "sync_logs",
    "sync_queue",
    "sync_outbox",
    "alembic_version",
}


def _table_name(target: Any) -> str | None:
    try:
        return str(target.__tablename__)
    except Exception:
        return None


def _pk(target: Any) -> str | None:
    val = getattr(target, "id", None)
    return str(val) if val is not None else None


def _family_id(target: Any) -> str | None:
    return getattr(target, "family_id", None)


def _write(connection, *, action: str, target: Any) -> None:
    table = _table_name(target)
    if not table or table in _SKIP_TABLES:
        return
    family_id = _family_id(target)
    if not family_id:
        # audit_logs.family_id is NOT NULL — skip non-family entities
        return
    try:
        from app.models.audit_log import AuditLog

        now = datetime.now(timezone.utc)
        connection.execute(
            insert(AuditLog.__table__).values(
                id=str(uuid4()),
                family_id=str(family_id),
                member_id=getattr(target, "created_by_member_id", None)
                or getattr(target, "member_id", None),
                action_type=action,
                entity_type=table,
                entity_id=_pk(target),
                title=f"{action} {table}",
                description=f"ORM event {action} on {table}",
                severity="INFO",
                created_at=now,
                updated_at=now,
                deleted_at=None,
            )
        )
    except Exception:
        pass


def _after_insert(mapper: Mapper, connection, target: Any) -> None:
    _write(connection, action="CREATE", target=target)


def _after_update(mapper: Mapper, connection, target: Any) -> None:
    _write(connection, action="UPDATE", target=target)


def _after_delete(mapper: Mapper, connection, target: Any) -> None:
    _write(connection, action="DELETE", target=target)


def register_audit_listeners(base) -> None:
    """Attach listeners to all mapped classes under declarative Base."""
    try:
        for mapper in base.registry.mappers:
            cls = mapper.class_
            table = getattr(cls, "__tablename__", None)
            if not table or table in _SKIP_TABLES:
                continue
            event.listen(cls, "after_insert", _after_insert)
            event.listen(cls, "after_update", _after_update)
            event.listen(cls, "after_delete", _after_delete)
    except Exception:
        pass
