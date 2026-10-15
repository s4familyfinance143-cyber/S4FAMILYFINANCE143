"""Family-wide live updates: one WebSocket per family member device.

Pushes {"type": "family.changed", entity_type, action, entity_id, ...}
after every committed change (see services/family_realtime.py). Clients
refetch what they show through the REST API.
"""

from fastapi import APIRouter, Query, WebSocket

from app.api.v1.grocery import serve_family_socket

router = APIRouter(prefix="/realtime", tags=["Realtime"])


@router.websocket("/ws/{family_id}")
async def family_realtime_websocket(
    websocket: WebSocket,
    family_id: str,
    token: str = Query(...),
):
    # dashboard.read is held by every role (CHILD included).
    await serve_family_socket(
        websocket, family_id, token, permission="dashboard.read", subscribed_type="family.subscribed"
    )
