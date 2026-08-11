"""Smoke: real SMTP path — honest no-config + real local SMTP send (no fake success)."""

from __future__ import annotations

import json
import sys
import threading
import time
from email import message_from_bytes
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = "http://127.0.0.1:8000"
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


def test_api_honest_no_smtp() -> None:
    status = http_json("GET", "/auth/email-status")
    assert status["can_send"] is False or status["smtp"]["configured"] is True
    # If SMTP already configured in this environment, skip honest-fail asserts
    if not status["smtp"]["configured"]:
        assert status["can_send"] is False
        login = http_json("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
        token = login["access_token"]
        reset = http_json("POST", "/auth/forgot-password", body={"email": EMAIL})
        assert reset["email_delivery"]["sent"] is False
        assert "SMTP not configured" in reset["email_delivery"]["reason"]
        print("PASS api_honest_no_smtp", reset["message"])
        # keep token unused warning quiet
        _ = token
    else:
        print("SKIP api_honest_no_smtp (SMTP already configured)")


class _CaptureSMTP:
    def __init__(self):
        self.messages: list[bytes] = []
        self._ready = threading.Event()
        self.port = 0

    def start(self):
        try:
            from aiosmtpd.controller import Controller
        except ImportError:
            raise RuntimeError("aiosmtpd required for local SMTP smoke") from None

        handler = self

        class Handler:
            async def handle_DATA(self, server, session, envelope):
                handler.messages.append(envelope.content)
                return "250 Message accepted"

        # Fixed local port avoids WinError 10049 with port=0 on some Windows setups
        self.port = 2525
        self.controller = Controller(Handler(), hostname="127.0.0.1", port=self.port)
        self.controller.start()
        self._ready.set()
        return self.port

    def stop(self):
        self.controller.stop()


def test_real_local_smtp_send() -> None:
    from app.core.config import settings
    from app.services import email_service

    capture = _CaptureSMTP()
    try:
        port = capture.start()
    except RuntimeError as exc:
        print("SKIP real_local_smtp_send:", exc)
        return

    old = {
        "SMTP_HOST": settings.SMTP_HOST,
        "SMTP_PORT": settings.SMTP_PORT,
        "SMTP_FROM_EMAIL": settings.SMTP_FROM_EMAIL,
        "SMTP_USE_TLS": settings.SMTP_USE_TLS,
        "SMTP_USE_SSL": settings.SMTP_USE_SSL,
        "SMTP_USERNAME": settings.SMTP_USERNAME,
        "SMTP_PASSWORD": settings.SMTP_PASSWORD,
        "AUTH_EMAIL_ENABLED": settings.AUTH_EMAIL_ENABLED,
    }
    try:
        settings.SMTP_HOST = "127.0.0.1"
        settings.SMTP_PORT = port
        settings.SMTP_FROM_EMAIL = "noreply@s4.local"
        settings.SMTP_USE_TLS = False
        settings.SMTP_USE_SSL = False
        settings.SMTP_USERNAME = None
        settings.SMTP_PASSWORD = None
        settings.AUTH_EMAIL_ENABLED = True

        result = email_service.send_password_reset_email(to_email=EMAIL, token="smoke-token-real-123456")
        assert result.sent is True, result
        deadline = time.time() + 5
        while time.time() < deadline and not capture.messages:
            time.sleep(0.05)
        assert capture.messages, "SMTP server received no message"
        msg = message_from_bytes(capture.messages[0])
        assert "Password reset" in (msg.get("Subject") or "")
        print("PASS real_local_smtp_send", f"port={port}", msg.get("Subject"))
    finally:
        for key, value in old.items():
            setattr(settings, key, value)
        capture.stop()


def main() -> None:
    # login must still work after auth wiring
    login = http_json("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    assert login.get("access_token"), "login broken"
    print("PASS login_still_works")

    test_api_honest_no_smtp()
    test_real_local_smtp_send()
    print("PASS smtp_email_smoke")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as exc:
        print("HTTP FAIL", exc.code, exc.read().decode("utf-8", errors="ignore"))
        sys.exit(1)
