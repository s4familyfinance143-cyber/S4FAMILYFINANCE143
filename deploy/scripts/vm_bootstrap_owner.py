import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm, require_vm_auth, sudo_shell, write_sudo_password

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def run(client, cmd, sudo=False, timeout=300):
    full = sudo_shell(cmd) if sudo else cmd
    print(f"\n>>> {cmd[:120]}...")
    stdin, stdout, _ = client.exec_command(full, get_pty=True, timeout=timeout)
    if sudo:
        time.sleep(0.3)
        write_sudo_password(stdin)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out, end="")
    return stdout.channel.recv_exit_status()

require_vm_auth(need_sudo_password=False)
c = connect_vm(timeout=30)

run(c, "docker cp /home/s4family/s4/backend/scripts/bootstrap_owner_on_postgres.py s4-family-finance-backend:/tmp/bootstrap_owner.py", sudo=True)
run(c, "docker exec s4-family-finance-backend python /tmp/bootstrap_owner.py", sudo=True, timeout=120)

# test via nginx path from guest host network namespace
test = r"""python3 - <<'PY'
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError
# Local-lab bootstrap credential; override it after bootstrap.
body=json.dumps({"email":"owner@s4family.com","password":"S4Family143!"}).encode()
req=Request("http://127.0.0.1/api/auth/login", data=body, headers={"Content-Type":"application/json"}, method="POST")
try:
    with urlopen(req, timeout=15) as r:
        print("nginx_login", r.status, r.read()[:120])
except HTTPError as e:
    print("nginx_login_err", e.code, e.read().decode()[:300])
PY"""
run(c, test, timeout=60)
c.close()
