#!/usr/bin/env python3
"""Deploy S4 staging stack to Ubuntu VM via SSH (port 2222)."""
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
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("S4_VM_HOST", "127.0.0.1")
PORT = int(os.environ.get("S4_VM_PORT", "2222"))
USER = os.environ.get("S4_VM_USER", "s4family")
TAR_PATH = os.environ.get("S4_STAGING_TAR", r"S:\s4-staging.tar.gz")

ENV_CONTENT = """POSTGRES_DB=s4_family_finance_production
POSTGRES_USER=s4_user
POSTGRES_PASSWORD=S4StagingPostgres2026!
DATABASE_URL=postgresql+psycopg://s4_user:S4StagingPostgres2026!@postgres:5432/s4_family_finance_production
JWT_SECRET_KEY=S4StagingJwtSecretKeyChangeMeForRealProduction1234567890
REDIS_PASSWORD=S4StagingRedis2026!
REDIS_URL=redis://:S4StagingRedis2026!@redis:6379/0
MINIO_ROOT_USER=s4minio
MINIO_ROOT_PASSWORD=S4StagingMinio2026!
S3_ENDPOINT_URL=http://minio:9000
S3_BUCKET=s4-family-finance
S3_ACCESS_KEY=s4minio
S3_SECRET_KEY=S4StagingMinio2026!
DOCUMENT_VAULT_BACKEND=s3
CORS_ORIGINS=["http://127.0.0.1","http://localhost","http://127.0.0.1:8088"]
VITE_API_BASE=/api
APP_PUBLIC_URL=http://127.0.0.1:8088
NOTIFICATION_EMAIL_ENABLED=true
NOTIFICATION_FCM_ENABLED=false
AUTH_EMAIL_ENABLED=true
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_FROM_EMAIL=noreply@s4family.local
SMTP_USE_TLS=false
SMTP_USE_SSL=false
ENABLE_RECURRING_WORKER=true
ENABLE_AUTO_BACKUP_WORKER=true
"""


def run(client: paramiko.SSHClient, cmd: str, sudo: bool = False, timeout: int = 7200) -> int:
    print(f"\n>>> {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=timeout)
    if sudo:
        time.sleep(0.3)
        write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out, end="")
    if err:
        print(err, end="", file=sys.stderr)
    return stdout.channel.recv_exit_status()


def main() -> int:
    pwd = vm_password()
    if not pwd:
        raise SystemExit("ERROR: S4_VM_PASSWORD is required for sudo during staging deploy.")
    if not os.path.isfile(TAR_PATH):
        print(f"Missing tar: {TAR_PATH}", file=sys.stderr)
        return 1

    print(f"Connecting {USER}@{HOST}:{PORT} ...")
    client = connect_vm(timeout=30)

    remote_tar = "/home/s4family/s4-staging.tar.gz"
    print(f"Uploading {TAR_PATH} ...")
    with client.open_sftp() as sftp:
        sftp.put(TAR_PATH, remote_tar)

    env_b64 = __import__("base64").b64encode(ENV_CONTENT.encode()).decode()
    compose = (
        "cd /home/s4family/s4/deploy/docker && "
        "docker compose --env-file .env.production -f docker-compose.production.yml"
    )

    steps: list[tuple[str, bool]] = [
        ("mkdir -p ~/s4", False),
        ("tar -xzf ~/s4-staging.tar.gz -C ~/s4", False),
        (f"echo {env_b64} | base64 -d > ~/s4/deploy/docker/.env.production", False),
        ("groups", False),
        (f"bash -lc '{compose} up -d --build'", True),
        (f"bash -lc '{compose} ps'", True),
        ("curl -s http://127.0.0.1:8000/health || true", False),
        ("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || true", False),
    ]

    for cmd, sudo in steps:
        full = f"sudo -S {cmd}" if sudo else cmd
        code = run(client, full, sudo=sudo)
        if code != 0 and "curl" not in cmd:
            print(f"Failed ({code}): {cmd}", file=sys.stderr)
            client.close()
            return code

    client.close()
    print("\nDone. Open http://127.0.0.1:8088 on Windows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
