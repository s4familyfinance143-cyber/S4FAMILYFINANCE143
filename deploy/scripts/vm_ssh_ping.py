import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm

c = connect_vm(timeout=25)
_, o, _ = c.exec_command("echo SSH_OK; hostname; uptime")
print(o.read().decode())
c.close()
