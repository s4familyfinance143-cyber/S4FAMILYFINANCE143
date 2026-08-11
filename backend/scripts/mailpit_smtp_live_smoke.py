"""Live smoke: API SMTP via Mailpit — email-status + forgot-password + Mailpit API."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8000/api/v1"
MAILPIT = "http://127.0.0.1:8025/api/v1"
EMAIL = "owner@s4family.com"


def http_json(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        raise RuntimeError(f"{method} {url} -> {exc.code}: {payload}") from exc


def main() -> int:
    status = http_json("GET", f"{API}/auth/email-status")
    assert status.get("can_send") is True, status
    assert status.get("smtp", {}).get("host") == "127.0.0.1", status
    print("PASS email-status can_send=true")

    before = http_json("GET", f"{MAILPIT}/messages")
    before_total = int(before.get("total") or 0)

    reset = http_json("POST", f"{API}/auth/forgot-password", body={"email": EMAIL})
    delivery = reset.get("email_delivery") or {}
    assert delivery.get("sent") is True, reset
    print("PASS forgot-password sent", delivery.get("reason"))

    after = http_json("GET", f"{MAILPIT}/messages")
    after_total = int(after.get("total") or 0)
    assert after_total >= before_total + 1, {"before": before_total, "after": after_total, "after": after}

    messages = after.get("messages") or []
    assert messages, after
    top = messages[0]
    subject = (top.get("Subject") or "")
    assert "Password reset" in subject or "reset" in subject.lower(), top
    print("PASS mailpit received", subject)
    print("Inbox UI: http://127.0.0.1:8025")
    print("PASS mailpit_smtp_live_smoke")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc, file=sys.stderr)
        raise SystemExit(1) from exc
