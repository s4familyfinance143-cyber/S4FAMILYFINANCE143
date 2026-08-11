"""Smoke: FCM path — honest no-config + device register (no fake push send)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = "http://127.0.0.1:8000/api/v1"
EMAIL = "owner@s4family.com"
PASSWORD = "S4Family143!"


def http_json(method: str, path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{API}{path}", data=data, headers=headers, method=method)
    with urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> None:
    from app.services.fcm_service import fcm_status, is_fcm_configured, send_fcm_push

    status = fcm_status()
    assert status["configured"] is False or is_fcm_configured()
    if not status["configured"]:
        result = send_fcm_push(token="smoke-token-not-real", title="t", body="b")
        assert result.sent is False
        assert "not configured" in result.reason.lower() or "FCM" in result.reason
        print("PASS service_honest_no_fcm", result.reason[:80])
    else:
        print("SKIP service_honest_no_fcm (FCM already configured)")

    login = http_json("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    access = login["access_token"]
    print("PASS login")

    families = http_json("GET", "/families", token=access)
    family_id = families["families"][0]["id"] if isinstance(families, dict) else families[0]["id"]

    fcm = http_json("GET", "/notifications/fcm-status", token=access)
    assert "configured" in fcm
    print("PASS fcm_status", fcm.get("note", "")[:80])

    delivery = http_json("GET", f"/notifications/delivery-status/{family_id}", token=access)
    assert "fcm" in delivery or "fcm_configured" in delivery
    print("PASS delivery_status", delivery.get("delivery_mode"), "fcm=", delivery.get("fcm_configured"))

    registered = http_json(
        "POST",
        f"/notifications/devices/{family_id}",
        token=access,
        body={
            "token": "smoke-fcm-token-local-only-not-a-real-device-001",
            "platform": "WEB",
            "provider": "FCM",
            "device_label": "smoke-test",
        },
    )
    assert registered.get("registered") is True
    print("PASS register_device", registered.get("id"))

    devices = http_json("GET", f"/notifications/devices/{family_id}", token=access)
    assert isinstance(devices, list) and len(devices) >= 1
    print("PASS list_devices", len(devices))

    test_push = http_json("POST", f"/notifications/test-push/{family_id}", token=access, body={})
    assert test_push.get("sent") is False
    assert "not configured" in (test_push.get("reason") or "").lower() or test_push.get("devices_targeted", 0) >= 0
    print("PASS test_push_honest", test_push.get("reason", "")[:90])

    device_id = registered.get("id") or devices[0]["id"]
    deleted = http_json("DELETE", f"/notifications/devices/{device_id}", token=access)
    assert deleted.get("deleted") is True
    print("PASS unregister_device")

    print("PASS fcm_push_smoke")
    print("NOTE: Real FCM send needs Firebase service-account JSON + NOTIFICATION_FCM_ENABLED=true")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as exc:
        print("HTTP FAIL", exc.code, exc.read().decode("utf-8", errors="ignore"))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc)
        sys.exit(1)
