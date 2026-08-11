#!/usr/bin/env python3
"""Sync latest release tarball to Ubuntu VM and rebuild staging stack (keep .env)."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, vm_password, write_sudo_password

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("S4_VM_HOST", "127.0.0.1")
PORT = int(os.environ.get("S4_VM_PORT", "2222"))
USER = os.environ.get("S4_VM_USER", "s4family")
ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "deploy" / "dist"


def latest_tar() -> Path:
    env = os.environ.get("S4_STAGING_TAR")
    if env and Path(env).is_file():
        return Path(env)
    cands = sorted(DIST.glob("s4-family-finance-release-*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not cands:
        raise SystemExit(f"No release tar in {DIST} — run package_release.ps1 first")
    return cands[0]


def run(client: paramiko.SSHClient, cmd: str, sudo: bool = False, timeout: int = 7200) -> tuple[int, str]:
    print(f"\n>>> {cmd[:200]}{'...' if len(cmd) > 200 else ''}")
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=timeout)
    if sudo:
        time.sleep(0.4)
        write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    text = (out or "") + (err or "")
    if text:
        # trim huge docker build logs
        lines = text.splitlines()
        if len(lines) > 80:
            print("\n".join(lines[:20]))
            print(f"... ({len(lines) - 40} lines) ...")
            print("\n".join(lines[-20:]))
        else:
            print(text, end="" if text.endswith("\n") else "\n")
    return stdout.channel.recv_exit_status(), text


def main() -> int:
    pwd = vm_password()
    if not pwd:
        raise SystemExit("ERROR: S4_VM_PASSWORD is required for sudo during staging rebuild.")
    tar = latest_tar()
    print(f"Using tar: {tar} ({tar.stat().st_size / 1e6:.1f} MB)", flush=True)

    print(f"Connecting {USER}@{HOST}:{PORT} ...", flush=True)
    client = connect_vm(timeout=30)
    print("SSH_OK", flush=True)

    remote_tar = f"/home/{USER}/s4-release-sync.tar.gz"
    print("Uploading...")
    with client.open_sftp() as sftp:
        sftp.put(str(tar), remote_tar)
    print("Upload done")

    # Preserve existing staging env; extract into ~/s4
    script = f"""
set -e
mkdir -p /home/{USER}/s4 /tmp/s4-extract
if [ -f /home/{USER}/s4/deploy/docker/.env.production ]; then
  cp /home/{USER}/s4/deploy/docker/.env.production /tmp/s4-env.production.bak
  echo ENV_BACKED_UP
fi
rm -rf /tmp/s4-extract
mkdir -p /tmp/s4-extract
tar -xzf {remote_tar} -C /tmp/s4-extract
# package roots: backend frontend deploy mobile
for d in backend frontend deploy mobile; do
  if [ -d /tmp/s4-extract/$d ]; then
    mkdir -p /home/{USER}/s4/$d
    cp -a /tmp/s4-extract/$d/. /home/{USER}/s4/$d/
    echo COPIED_$d
  fi
done
if [ -f /tmp/s4-env.production.bak ]; then
  cp /tmp/s4-env.production.bak /home/{USER}/s4/deploy/docker/.env.production
  echo ENV_RESTORED
fi
test -f /home/{USER}/s4/deploy/docker/.env.production && echo ENV_PRESENT || echo MISSING_ENV
echo SYNC_OK
"""
    code, _ = run(client, script, timeout=300)
    if code != 0:
        print("extract failed", code)
        return code

    # Ensure Mailpit SMTP block present (idempotent append check)
    ensure_smtp = f"""
python3 - <<'PY'
from pathlib import Path
p = Path('/home/{USER}/s4/deploy/docker/.env.production')
t = p.read_text(encoding='utf-8')
need = {{
  'SMTP_HOST': 'mailpit',
  'SMTP_PORT': '1025',
  'SMTP_FROM_EMAIL': 'noreply@s4family.local',
  'SMTP_USE_TLS': 'false',
  'SMTP_USE_SSL': 'false',
  'NOTIFICATION_EMAIL_ENABLED': 'true',
  'AUTH_EMAIL_ENABLED': 'true',
}}
lines = t.splitlines()
keys = {{ln.split('=',1)[0] for ln in lines if '=' in ln and not ln.strip().startswith('#')}}
changed = False
for k,v in need.items():
    if k not in keys:
        lines.append(f'{{k}}={{v}}')
        changed = True
if changed:
    p.write_text('\\n'.join(lines)+'\\n', encoding='utf-8')
    print('SMTP_KEYS_ADDED')
else:
    print('SMTP_KEYS_OK')
PY
"""
    run(client, ensure_smtp, timeout=60)

    rebuild = f"""
sudo -S bash -lc '
cd /home/{USER}/s4/deploy/docker
docker compose --env-file .env.production -f docker-compose.production.yml --profile staging build --pull=false
docker compose --env-file .env.production -f docker-compose.production.yml --profile staging up -d
docker compose --env-file .env.production -f docker-compose.production.yml --profile staging ps
'
"""
    code, _ = run(client, rebuild, sudo=True, timeout=7200)
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
