"""Uvicorn only accepts WebSocket upgrades when a WebSocket library is
installed. Without one it logs "No supported WebSocket library detected"
and answers every /ws/ request with 404, so live updates silently stop.
The test client does not need the library, so check for it directly."""

import importlib


def test_websocket_library_installed_for_uvicorn():
    importlib.import_module("websockets")
