#!/usr/bin/env python3
"""Login smoke against VM :8088 without printing the token."""
from __future__ import annotations

import json
import os
import urllib.request

BASE = os.environ.get("S4_VERIFY_BASE_URL", "http://127.0.0.1:8088").rstrip("/")
EMAIL = os.environ.get("S4_VERIFY_EMAIL", "owner@s4family.com")
# Local-lab bootstrap credential; override with S4_VERIFY_PASSWORD later.
PASSWORD = os.environ.get("S4_VERIFY_PASSWORD", "S4Family143!")


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def get(path: str, token: str) -> dict:
    req = urllib.request.Request(f"{BASE}{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    login = post("/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = login.get("access_token") or ""
    if not token:
        print("FAIL login (no token)")
        return 1
    print("PASS login (token not printed)")
    me = get("/api/auth/me", token)
    print("PASS me", me.get("email"))
    families = get("/api/families", token)
    print("PASS families", len(families) if isinstance(families, list) else type(families).__name__)
    # forgot-password path (Mailpit)
    try:
        fp = post("/api/auth/forgot-password", {"email": EMAIL})
        print("PASS forgot-password", "sent=" + str(fp.get("sent", fp.get("ok", fp))))
    except Exception as ex:
        print("WARN forgot-password", type(ex).__name__, ex)
    print("PASS login_e2e")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
