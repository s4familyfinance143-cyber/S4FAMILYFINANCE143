import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "127.0.0.1",
    port=2222,
    username="s4family",
    password="root",
    timeout=25,
    banner_timeout=25,
    auth_timeout=25,
)
_, o, _ = c.exec_command("echo SSH_OK; hostname; uptime")
print(o.read().decode())
c.close()
