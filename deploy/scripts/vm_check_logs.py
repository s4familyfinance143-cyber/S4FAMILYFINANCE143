import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, require_vm_auth, sudo_shell, vm_password, write_sudo_password

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def run(client, cmd):
    full = sudo_shell(cmd)
    print(f"\n>>> {full}")
    stdin, stdout, _ = client.exec_command(full, get_pty=True, timeout=120)
    time.sleep(0.3)
    write_sudo_password(stdin)
    print(stdout.read().decode("utf-8", errors="replace"), end="")

require_vm_auth(need_sudo_password=False)
c = connect_vm(timeout=30)
run(c, "docker ps --format 'table {{.Names}}\t{{.Status}}'")
run(c, "docker logs s4-family-finance-frontend --tail 15 2>&1")
run(c, "docker exec s4-family-finance-frontend head -c 8 /etc/nginx/conf.d/default.conf | xxd")
c.close()
