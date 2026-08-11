import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, vm_password, write_sudo_password

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def run(client, cmd, need_sudo=False, timeout=120):
    full = f"sudo -S {cmd}" if need_sudo else cmd
    print(f"\n>>> {full}")
    stdin, stdout, _ = client.exec_command(full, get_pty=True, timeout=timeout)
    if need_sudo:
        time.sleep(0.3)
        write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out, end="")
    return stdout.channel.recv_exit_status()

pwd = vm_password()
if not pwd:
    raise SystemExit("ERROR: S4_VM_PASSWORD is required for sudo when verifying owner email.")
for attempt in range(3):
    try:
        c = connect_vm(timeout=60)
        sql = (
            "docker exec s4-family-finance-postgres psql "
            "-U s4_user -d s4_family_finance_production "
            "-c \"UPDATE users SET is_email_verified = true WHERE email = 'owner@s4family.com';\""
        )
        run(c, sql, need_sudo=True)
        c.close()
        break
    except Exception as exc:
        print(f"attempt {attempt+1} failed: {exc}", file=sys.stderr)
        time.sleep(3)
else:
    raise SystemExit(1)
