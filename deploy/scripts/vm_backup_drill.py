#!/usr/bin/env python3
"""Postgres backup drill on Ubuntu VM staging."""
from __future__ import annotations

import sys
import time

import paramiko

HOST, PORT, USER, PASSWORD = "127.0.0.1", 2222, "s4family", "root"


def main() -> int:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=25, banner_timeout=40, auth_timeout=25)
    cmd = f"""
echo {PASSWORD} | sudo -S bash -lc '
set -e
PGUSER=$(docker exec s4-family-finance-postgres printenv POSTGRES_USER)
PGDB=$(docker exec s4-family-finance-postgres printenv POSTGRES_DB)
docker exec s4-family-finance-postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc -f /tmp/s4_vm_backup_drill.backup
docker cp s4-family-finance-postgres:/tmp/s4_vm_backup_drill.backup /home/{USER}/s4_vm_backup_drill.backup
ls -la /home/{USER}/s4_vm_backup_drill.backup
# size must be > 0
SIZE=$(stat -c%s /home/{USER}/s4_vm_backup_drill.backup)
echo BACKUP_BYTES=$SIZE
test "$SIZE" -gt 1000
echo BACKUP_DRILL_PASS
'
"""
    stdin, stdout, stderr = c.exec_command(cmd, get_pty=True, timeout=180)
    time.sleep(0.3)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out)
    code = stdout.channel.recv_exit_status()
    c.close()
    print("exit", code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
