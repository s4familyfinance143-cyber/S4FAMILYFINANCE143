#!/usr/bin/env python3
import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, require_vm_auth, sudo_shell, vm_password, write_sudo_password

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
require_vm_auth(need_sudo_password=False)
c = connect_vm(timeout=30)
cmd = sudo_shell("docker logs s4-family-finance-backend --tail 80 2>&1")
stdin, stdout, _ = c.exec_command(cmd, get_pty=True, timeout=60)
time.sleep(0.3)
write_sudo_password(stdin)
print(stdout.read().decode("utf-8", errors="replace"))
c.close()
