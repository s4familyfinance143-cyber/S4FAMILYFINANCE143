"""Bootstrap owner account on live Postgres API (no sqlite migrate)."""

from __future__ import annotations

import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API = "http://127.0.0.1:8000/api/v1"
EMAIL = "owner@s4family.com"
PASSWORD = "S4Family143!"
FULL_NAME = "S4 Owner"


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(API + path, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed


def main() -> None:
    code, health = call("GET", "/health") if False else (200, {})
    # health is root path; probe email-status instead
    code, _ = call("GET", "/auth/email-status")
    if code != 200:
        raise RuntimeError(f"API not up ({code})")

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
    if token:
        code, verified = call("POST", "/auth/verify-email", {"token": token})
        if code != 200:
            raise RuntimeError(f"verify failed {code}: {verified}")
        print("PASS verify_email")
    else:
        print("OK already verified / no token returned")

    code, login = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    if code != 200 or not isinstance(login, dict) or not login.get("access_token"):
        raise RuntimeError(f"login failed {code}: {login}")
    access = login["access_token"]
    print("PASS login", EMAIL)

    code, families = call("GET", "/families", token=access)
    if code != 200:
        raise RuntimeError(f"families failed {code}: {families}")
    items = families if isinstance(families, list) else families.get("families") or families.get("items") or []
    family_id = items[0]["id"] if items else None

    if not family_id:
        code, created = call(
            "POST",
            "/families",
            {"name": "S4 Home", "currency": "BDT", "timezone": "Asia/Dhaka"},
            token=access,
        )
        if code not in (200, 201):
            # try alternate payload keys
            code, created = call(
                "POST",
                "/families",
                {"name": "S4 Home", "default_currency": "BDT", "timezone": "Asia/Dhaka"},
                token=access,
            )
        if code not in (200, 201):
            raise RuntimeError(f"create family failed {code}: {created}")
        family_id = (
            created.get("id")
            or created.get("family_id")
            or (created.get("family") or {}).get("id")
        )
        print("PASS create_family", family_id)
    else:
        print("PASS family_exists", family_id)

    code, me = call("GET", "/auth/me", token=access)
    print("PASS me", me.get("email") if isinstance(me, dict) else me)
    print("PASS owner_bootstrap_postgres")
    print(f"LOGIN {EMAIL} / {PASSWORD}")
    print(f"FAMILY {family_id}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc)
        sys.exit(1)
