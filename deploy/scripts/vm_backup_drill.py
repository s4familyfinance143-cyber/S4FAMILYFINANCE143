#!/usr/bin/env python3
"""Postgres backup drill on Ubuntu VM staging."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, vm_password, write_sudo_password

USER = os.environ.get("S4_VM_USER", "s4family")


def main() -> int:
    pwd = vm_password()
    if not pwd:
        raise SystemExit("ERROR: S4_VM_PASSWORD is required for sudo in the backup drill.")
    c = connect_vm(timeout=25)
    cmd = f"""
sudo -S bash -lc '
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
    write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out)
    code = stdout.channel.recv_exit_status()
    c.close()
    print("exit", code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
