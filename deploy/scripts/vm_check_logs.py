import paramiko
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PWD = "root"

def run(client, cmd):
    print(f"\n>>> {cmd}")
    stdin, stdout, _ = client.exec_command(cmd, get_pty=True, timeout=120)
    time.sleep(0.3)
    stdin.write(PWD + "\n")
    stdin.flush()
    print(stdout.read().decode("utf-8", errors="replace"), end="")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("127.0.0.1", port=2222, username="s4family", password="root", timeout=30)
run(c, "echo root | sudo -S docker ps --format 'table {{.Names}}\t{{.Status}}'")
run(c, "echo root | sudo -S docker logs s4-family-finance-frontend --tail 15 2>&1")
run(c, "echo root | sudo -S docker exec s4-family-finance-frontend head -c 8 /etc/nginx/conf.d/default.conf | xxd")
c.close()
