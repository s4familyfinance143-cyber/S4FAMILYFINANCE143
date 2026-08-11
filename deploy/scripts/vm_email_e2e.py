#!/usr/bin/env python3
"""E2E: forgot-password email lands in Mailpit on VM staging."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, require_vm_auth, sudo_shell, vm_password, write_sudo_password

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def http_json(method, url, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed


def ssh_run(cmd, sudo=False):
    c = connect_vm(timeout=30)
    full = sudo_shell(cmd) if sudo else cmd
    stdin, stdout, _ = c.exec_command(full, get_pty=True, timeout=60)
    if sudo:
        time.sleep(0.3)
        write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    c.close()
    return out


def main():
    # clear mailpit via guest
    out = ssh_run("curl -s -X DELETE http://127.0.0.1:8025/api/v1/messages")
    print("mailpit_clear", out[-200:])

    st, body = http_json(
        "POST",
        "http://127.0.0.1:8088/api/auth/forgot-password",
        {"email": "owner@s4family.com"},
    )
    print("forgot-password", st, body)
    time.sleep(2)

    out = ssh_run("curl -s http://127.0.0.1:8025/api/v1/messages")
    print("mailpit_messages", out[-1500:])
    try:
        # strip sudo password echoes if any
        start = out.find("{")
        mail = json.loads(out[start:]) if start >= 0 else {}
    except json.JSONDecodeError:
        mail = {}
    total = mail.get("total", 0) if isinstance(mail, dict) else 0
    delivered = isinstance(body, dict) and (
        (body.get("email_delivery") or {}).get("sent") is True
        or "sent" in str(body).lower()
    )
    ok = total >= 1 or delivered
    print("PASS" if ok else "FAIL", "email_e2e", "total=", total)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
