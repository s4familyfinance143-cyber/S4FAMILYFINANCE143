import paramiko
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PWD = "root"
CONF_LOCAL = r"S:\S4-FAMILY-FINANCE-143-FINAL\deploy\nginx\s4_family_finance_nginx.conf"
CONF_REMOTE = "/home/s4family/s4/deploy/nginx/s4_family_finance_nginx.conf"
UPLOADS = [
    (r"S:\S4-FAMILY-FINANCE-143-FINAL\frontend\src\styles\architecture-shell.css", "/home/s4family/s4/frontend/src/styles/architecture-shell.css"),
    (r"S:\S4-FAMILY-FINANCE-143-FINAL\frontend\src\App.css", "/home/s4family/s4/frontend/src/App.css"),
    (r"S:\S4-FAMILY-FINANCE-143-FINAL\frontend\src\App.jsx", "/home/s4family/s4/frontend/src/App.jsx"),
    (r"S:\S4-FAMILY-FINANCE-143-FINAL\frontend\src\components\layout\AppNavigation.jsx", "/home/s4family/s4/frontend/src/components/layout/AppNavigation.jsx"),
    (r"S:\S4-FAMILY-FINANCE-143-FINAL\frontend\src\components\dashboard\ExecutiveDashboard.jsx", "/home/s4family/s4/frontend/src/components/dashboard/ExecutiveDashboard.jsx"),
]
COMPOSE = (
    "cd /home/s4family/s4/deploy/docker && "
    "docker compose --profile staging --env-file .env.production -f docker-compose.production.yml"
)


def run(client, cmd, sudo=False, timeout=1800):
    full = f"sudo -S {cmd}" if sudo else cmd
    print(f"\n>>> {full}")
    stdin, stdout, _ = client.exec_command(full, get_pty=True, timeout=timeout)
    if sudo:
        time.sleep(0.3)
        stdin.write(PWD + "\n")
        stdin.flush()
    out = stdout.read().decode("utf-8", errors="replace")
    print(out, end="")
    return stdout.channel.recv_exit_status()


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("127.0.0.1", port=2222, username="s4family", password="root", timeout=30)

with c.open_sftp() as sftp:
    sftp.put(CONF_LOCAL, CONF_REMOTE)
    for local_path, remote_path in UPLOADS:
        sftp.put(local_path, remote_path)

run(c, f"bash -lc '{COMPOSE} build frontend --pull=false'", sudo=True, timeout=1800)
run(c, f"bash -lc '{COMPOSE} up -d --force-recreate --no-deps frontend'", sudo=True, timeout=300)
run(c, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || true", sudo=False)
run(c, "curl -s http://127.0.0.1/api/health || curl -s http://127.0.0.1:8000/health || true", sudo=False)
c.close()
print("\nTry http://127.0.0.1:8088 on Windows")
