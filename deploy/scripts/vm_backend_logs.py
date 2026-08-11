#!/usr/bin/env python3
import sys, time
import paramiko
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PWD="root"
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("127.0.0.1", port=2222, username="s4family", password=PWD, timeout=30)
stdin, stdout, _ = c.exec_command("echo root | sudo -S docker logs s4-family-finance-backend --tail 80 2>&1", get_pty=True, timeout=60)
print(stdout.read().decode("utf-8", errors="replace"))
c.close()
