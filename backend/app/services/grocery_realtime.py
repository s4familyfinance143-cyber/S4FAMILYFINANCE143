"""In-memory grocery realtime fan-out (WebSocket).

Process-local only — fine for single-instance deploy. Multi-worker needs Redis pub/sub later.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket


class GroceryRealtimeHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        # Which authenticated user opened each socket, so a removed member's
        # (or re-roled member's) live feed can be closed server-side.
        self._socket_users: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()
        self._main_loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._main_loop = loop

    def subscriber_count(self, family_id: str) -> int:
        return len(self._rooms.get(family_id, set()))

    async def connect(self, family_id: str, websocket: WebSocket, user_id: str | None = None) -> None:
        await websocket.accept()
        async with self._lock:
            self._rooms.setdefault(family_id, set()).add(websocket)
            if user_id:
                self._socket_users[websocket] = str(user_id)

    async def disconnect(self, family_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._socket_users.pop(websocket, None)
            sockets = self._rooms.get(family_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._rooms.pop(family_id, None)

    async def broadcast(self, family_id: str, event: dict[str, Any]) -> None:
        payload = json.dumps(event, default=str)
        async with self._lock:
            sockets = list(self._rooms.get(family_id, set()))
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(family_id, ws)


    async def close_user(self, family_id: str, user_id: str, code: int = 4403) -> int:
        """Close every socket user_id holds in family_id's room."""
        async with self._lock:
            targets = [
                ws for ws in self._rooms.get(family_id, set())
                if self._socket_users.get(ws) == str(user_id)
            ]
        for ws in targets:
            try:
                await ws.close(code=code)
            except Exception:
                pass
            await self.disconnect(family_id, ws)
        return len(targets)


grocery_realtime_hub = GroceryRealtimeHub()


def revoke_grocery_sockets(family_id: str, user_id: str | None) -> None:
    """Thread-safe: close a member's live grocery feed after removal or a role
    change. The socket checked membership only once, at connect time; on
    reconnect it is re-authorized against the current role."""
    if not user_id:
        return
    loop = grocery_realtime_hub._main_loop
    if loop is None or not loop.is_running():
        return
    asyncio.run_coroutine_threadsafe(grocery_realtime_hub.close_user(family_id, str(user_id)), loop)


def publish_grocery_event(family_id: str, *, action: str, entity_type: str, entity_id: str | None = None, title: str | None = None) -> None:
    event = {
        "type": "grocery.changed",
        "family_id": family_id,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "title": title,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    loop = grocery_realtime_hub._main_loop
    if loop is None or not loop.is_running():
        return
    asyncio.run_coroutine_threadsafe(grocery_realtime_hub.broadcast(family_id, event), loop)
