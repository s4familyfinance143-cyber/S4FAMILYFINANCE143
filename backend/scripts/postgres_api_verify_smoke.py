"""Verify FastAPI against local Docker Postgres (port 8001), without touching live :8000 sqlite."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8001/api/v1"
EMAIL = "pgcutover@s4family.com"
PASSWORD = "Test1234!"
FULL_NAME = "Postgres Cutover User"


def call(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict | list | str]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            parsed: dict | list | str
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed


def main() -> None:
    code, health = call("GET", "/health") if False else (0, {})
    # health may not exist — probe auth email-status
    code, status_body = call("GET", "/auth/email-status")
    if code != 200:
        raise RuntimeError(f"API not reachable on :8001 ({code}): {status_body}")
    print("PASS api_up", status_body.get("note", "")[:80])

    code, reg = call(
        "POST",
        "/auth/register",
        {"full_name": FULL_NAME, "email": EMAIL, "password": PASSWORD},
    )
    if code not in (201, 409):
        raise RuntimeError(f"register failed {code}: {reg}")
    print("PASS register", code)

    code, resent = call("POST", "/auth/resend-verification", {"email": EMAIL})
    if code != 200:
        raise RuntimeError(f"resend failed {code}: {resent}")
    token = resent.get("verification_token") if isinstance(resent, dict) else None
    if not token:
        # already verified from prior run
        print("OK no verification_token (maybe already verified)")
    else:
        code, verified = call("POST", "/auth/verify-email", {"token": token})
        if code != 200:
            raise RuntimeError(f"verify failed {code}: {verified}")
        print("PASS verify_email")

    code, login = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    if code != 200 or not isinstance(login, dict) or not login.get("access_token"):
        raise RuntimeError(f"login failed {code}: {login}")
    access = login["access_token"]
    print("PASS login")

    code, me = call("GET", "/auth/me", token=access)
    if code != 200:
        raise RuntimeError(f"me failed {code}: {me}")
    print("PASS me", me.get("email") if isinstance(me, dict) else me)

    code, families = call("GET", "/families", token=access)
    if code != 200:
        raise RuntimeError(f"families list failed {code}: {families}")
    family_id = None
    if isinstance(families, list) and families:
        family_id = families[0].get("id") or families[0].get("family_id")
    elif isinstance(families, dict):
        items = families.get("items") or families.get("families") or []
        if items:
            family_id = items[0].get("id") or items[0].get("family_id")

    if not family_id:
        code, created = call(
            "POST",
            "/families",
            {"name": "Postgres Cutover Family", "default_currency": "BDT", "timezone": "Asia/Dhaka"},
            token=access,
        )
        if code not in (200, 201):
            raise RuntimeError(f"create family failed {code}: {created}")
        if isinstance(created, dict):
            family_id = (
                created.get("family_id")
                or created.get("id")
                or (created.get("family") or {}).get("id")
            )
        print("PASS create_family", family_id)
    else:
        print("PASS family_exists", family_id)

    if not family_id:
        raise RuntimeError("no family_id")

    code, phase16 = call("GET", f"/phase16/{family_id}", token=access)
    if code != 200:
        raise RuntimeError(f"phase16 list failed {code}: {phase16}")
    print("PASS phase16_list")

    code, zakat = call("GET", f"/zakat/{family_id}", token=access)
    if code != 200:
        raise RuntimeError(f"zakat list failed {code}: {zakat}")
    print("PASS zakat_list")

    print("PASS postgres_api_verify")
    print("NOTE: live sqlite :8000 untouched; Postgres API on :8001")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc)
        sys.exit(1)
