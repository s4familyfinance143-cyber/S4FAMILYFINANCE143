import paramiko
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PWD = "root"

def run(client, cmd, need_sudo=False, timeout=120):
    full = f"echo {PWD} | sudo -S {cmd}" if need_sudo else cmd
    print(f"\n>>> {full}")
    _, stdout, _ = client.exec_command(full, get_pty=True, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out, end="")
    return stdout.channel.recv_exit_status()

for attempt in range(3):
    try:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect("127.0.0.1", port=2222, username="s4family", password="root", timeout=60, banner_timeout=60, auth_timeout=60)
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
