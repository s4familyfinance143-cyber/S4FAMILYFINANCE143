"""Family-wide live updates over the VPS WebSocket (no third-party push).

Writes queue a small event on the SQLAlchemy session; it is broadcast only
after that session commits (a rolled-back write never reaches clients).
Events carry no amounts or names — just "what changed" — and clients refetch
through the normal REST endpoints, so every permission check still applies.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

_QUEUE_KEY = "family_realtime_events"
_log = logging.getLogger("s4.realtime")


def queue_family_event(
    db: Any,
    family_id: str | None,
    *,
    entity_type: str | None,
    action: str | None,
    entity_id: str | None = None,
    actor_member_id: str | None = None,
) -> None:
    """Remember a change; it is published after db commits."""
    info = getattr(db, "info", None)
    if not family_id or not isinstance(info, dict):
        return
    info.setdefault(_QUEUE_KEY, []).append(
        {
            "type": "family.changed",
            "family_id": str(family_id),
            "entity_type": (entity_type or "").upper() or None,
            "action": (action or "").upper() or None,
            "entity_id": str(entity_id) if entity_id else None,
            "actor_member_id": str(actor_member_id) if actor_member_id else None,
        }
    )


def _collapse(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One event per (family, entity_type, action, entity_id) per commit."""
    seen: set[tuple] = set()
    out = []
    for ev in events:
        key = (ev["family_id"], ev["entity_type"], ev["action"], ev["entity_id"])
        if key in seen:
            continue
        seen.add(key)
        out.append(ev)
    return out


@event.listens_for(Session, "after_commit")
def _publish_after_commit(session: Session) -> None:
    events = session.info.pop(_QUEUE_KEY, None)
    if not events:
        return
    from app.services.grocery_realtime import publish_family_event

    ts = datetime.now(timezone.utc).isoformat()
    for ev in _collapse(events):
        # Best effort: the data is already committed, so a broadcast failure
        # must never surface as an error on the request that wrote it.
        try:
            publish_family_event(ev["family_id"], {**ev, "ts": ts})
        except Exception:
            _log.warning("live update publish failed for family %s", ev["family_id"], exc_info=True)


@event.listens_for(Session, "after_rollback")
def _drop_after_rollback(session: Session) -> None:
    session.info.pop(_QUEUE_KEY, None)
