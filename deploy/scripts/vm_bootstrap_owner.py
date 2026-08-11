import paramiko
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PWD = "root"

def run(client, cmd, timeout=300):
    print(f"\n>>> {cmd[:120]}...")
    stdin, stdout, _ = client.exec_command(cmd, get_pty=True, timeout=timeout)
    time.sleep(0.3)
    stdin.write(PWD + "\n")
    stdin.flush()
    out = stdout.read().decode("utf-8", errors="replace")
    print(out, end="")
    return stdout.channel.recv_exit_status()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("127.0.0.1", port=2222, username="s4family", password="root", timeout=30)

run(c, "echo root | sudo -S docker cp /home/s4family/s4/backend/scripts/bootstrap_owner_on_postgres.py s4-family-finance-backend:/tmp/bootstrap_owner.py")
run(c, "echo root | sudo -S docker exec s4-family-finance-backend python /tmp/bootstrap_owner.py", timeout=120)

# test via nginx path from guest host network namespace
test = r"""python3 - <<'PY'
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError
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
