#!/usr/bin/env python3
"""Ensure staging stack + Mailpit SMTP on Ubuntu VM."""
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
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

COMPOSE_LOCAL = r"S:\S4-FAMILY-FINANCE-143-FINAL\deploy\docker\docker-compose.production.yml"
COMPOSE_REMOTE = "/home/s4family/s4/deploy/docker/docker-compose.production.yml"
ENV_REMOTE = "/home/s4family/s4/deploy/docker/.env.production"
COMPOSE_DIR = "/home/s4family/s4/deploy/docker"


def run(client, cmd, sudo=False, timeout=900):
    full = sudo_shell(cmd) if sudo else cmd
    print(f"\n>>> {full[:160]}")
    stdin, stdout, _ = client.exec_command(full, get_pty=True, timeout=timeout)
    if sudo:
        time.sleep(0.3)
        write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out[-5000:] if len(out) > 5000 else out, end="")
    return stdout.channel.recv_exit_status(), out


def http_json(method, url, body=None, timeout=30):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed


def main():
    require_vm_auth(need_sudo_password=False)
    c = connect_vm(timeout=30)

    with c.open_sftp() as sftp:
        sftp.put(COMPOSE_LOCAL, COMPOSE_REMOTE)

    patch = f"""python3 - <<'PY'
from pathlib import Path
p = Path("{ENV_REMOTE}")
text = p.read_text(encoding="utf-8")
keys = {{
  "NOTIFICATION_EMAIL_ENABLED": "true",
  "NOTIFICATION_FCM_ENABLED": "false",
  "AUTH_EMAIL_ENABLED": "true",
  "SMTP_HOST": "mailpit",
  "SMTP_PORT": "1025",
  "SMTP_USERNAME": "",
  "SMTP_PASSWORD": "",
  "SMTP_FROM_EMAIL": "noreply@s4family.local",
  "SMTP_USE_TLS": "false",
  "SMTP_USE_SSL": "false",
}}
lines = []
seen = set()
for line in text.splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        # skip old commented smtp keys that we will rewrite as live keys
        stripped = line.lstrip("# ").strip()
        if any(stripped.startswith(k + "=") for k in keys):
            continue
        lines.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if key in keys:
        lines.append(f"{{key}}={{keys[key]}}")
        seen.add(key)
        continue
    lines.append(line)
for k, v in keys.items():
    if k not in seen:
        lines.append(f"{{k}}={{v}}")
p.write_text("\\n".join(lines).rstrip() + "\\n", encoding="utf-8")
print("env_ok")
PY"""
    code, _ = run(c, patch)
    if code != 0:
        return code

    compose = (
        f"cd {COMPOSE_DIR} && "
        "docker compose --profile staging --env-file .env.production -f docker-compose.production.yml"
    )
    # bring whole stack (docker may not auto-start after reboot depending on settings)
    code, _ = run(c, f"bash -lc '{compose} up -d'", sudo=True, timeout=600)
    if code != 0:
        return code
    code, _ = run(c, f"bash -lc '{compose} up -d --force-recreate --no-deps backend'", sudo=True, timeout=300)
    if code != 0:
        return code

    for _ in range(40):
        _, out = run(c, "curl -s http://127.0.0.1:8000/health || true")
        if "ok" in out:
            break
        time.sleep(3)

    run(c, f"bash -lc '{compose} ps'", sudo=True)
    _, status_out = run(c, "curl -s http://127.0.0.1:8000/auth/email-status || curl -s http://127.0.0.1:8000/api/v1/auth/email-status || true")
    c.close()

    print("\n--- host ---")
    for i in range(20):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8088/api/health", timeout=8) as r:
                print("health", r.read().decode())
                break
        except Exception as e:
            print("wait_http", e)
            time.sleep(3)
    else:
        print("FAIL host http")
        return 1

    st, email = http_json("GET", "http://127.0.0.1:8088/api/auth/email-status")
    print("email-status", st, email)
    st2, resent = http_json("POST", "http://127.0.0.1:8088/api/auth/resend-verification", {"email": "owner@s4family.com"})
    print("resend", st2, resent)
    try:
        with urllib.request.urlopen("http://127.0.0.1:8025/api/v1/messages", timeout=10) as r:
            mail = json.loads(r.read().decode())
            print("mailpit_total", mail.get("total") if isinstance(mail, dict) else mail)
    except Exception as e:
        print("mailpit", e)

    ok = isinstance(email, dict) and email.get("can_send") is True
    print("PASS" if ok else "FAIL", "mailpit_smtp")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
