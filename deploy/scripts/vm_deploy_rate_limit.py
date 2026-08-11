#!/usr/bin/env python3
"""Upload rate-limit code and rebuild backend on VM."""
from __future__ import annotations

import sys
import time

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PWD = "root"
ROOT = r"S:\S4-FAMILY-FINANCE-143-FINAL"
REMOTE = "/home/s4family/s4"
FILES = [
    ("backend/requirements.txt", f"{REMOTE}/backend/requirements.txt"),
    ("backend/app/main.py", f"{REMOTE}/backend/app/main.py"),
    ("backend/app/core/rate_limit.py", f"{REMOTE}/backend/app/core/rate_limit.py"),
    ("backend/app/api/v1/auth.py", f"{REMOTE}/backend/app/api/v1/auth.py"),
]
COMPOSE = (
    "cd /home/s4family/s4/deploy/docker && "
    "docker compose --profile staging --env-file .env.production -f docker-compose.production.yml"
)


def run(c, cmd, sudo=False, timeout=1200):
    full = f"sudo -S {cmd}" if sudo else cmd
    print(f"\n>>> {full[:140]}")
    stdin, stdout, _ = c.exec_command(full, get_pty=True, timeout=timeout)
    if sudo:
        time.sleep(0.3)
        stdin.write(PWD + "\n")
        stdin.flush()
    out = stdout.read().decode("utf-8", errors="replace")
    print(out[-3000:] if len(out) > 3000 else out, end="")
    return stdout.channel.recv_exit_status()


def main():
    for attempt in range(4):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect("127.0.0.1", port=2222, username="s4family", password=PWD, timeout=30, banner_timeout=30, auth_timeout=30)
            break
        except Exception as e:
            print(f"ssh retry {attempt+1}: {e}")
            time.sleep(5)
    else:
        return 1

    with c.open_sftp() as sftp:
        for rel, remote in FILES:
            local = f"{ROOT}\\{rel.replace('/', chr(92))}"
            print("put", local, "->", remote)
            sftp.put(local, remote)

    code = run(c, f"bash -lc '{COMPOSE} build backend'", sudo=True, timeout=1200)
    if code != 0:
        c.close()
        return code
    code = run(c, f"bash -lc '{COMPOSE} up -d --force-recreate --no-deps backend'", sudo=True, timeout=300)
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
