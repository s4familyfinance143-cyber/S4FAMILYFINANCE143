"""Validate FCM readiness (honest). Exit 0 = ready, 2 = waiting on credentials, 1 = error."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = "http://127.0.0.1:8000/api/v1"
EMAIL = "owner@s4family.com"
PASSWORD = "S4Family143!"
DEFAULT_JSON = ROOT / "secrets" / "firebase-service-account.json"


def http_json(method: str, path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{API}{path}", data=data, headers=headers, method=method)
    with urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> int:
    from app.services.fcm_service import fcm_status

    svc = fcm_status()
    print("service:", json.dumps(svc, indent=2))

    login = http_json("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    api = http_json("GET", "/notifications/fcm-status", token=login["access_token"])
    print("api:", json.dumps(api, indent=2))

    json_ok = DEFAULT_JSON.is_file()
    print("secrets_json_present:", json_ok, str(DEFAULT_JSON))

    if api.get("configured"):
        print("PASS fcm_ready configured=true")
        return 0

    print("WAIT fcm_not_ready:", api.get("note"))
    print("Drop Firebase JSON at secrets/firebase-service-account.json then run:")
    print("  powershell -File scripts\\switch_live_api_fcm_when_ready.ps1")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc)
        raise SystemExit(1) from exc
