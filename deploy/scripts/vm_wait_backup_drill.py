#!/usr/bin/env python3
"""Retry SSH then run Postgres backup drill."""
from __future__ import annotations

import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm

from vm_backup_drill import main as drill_main

def wait_ssh(tries: int = 18) -> bool:
    for i in range(tries):
        try:
            c = connect_vm(timeout=15)
            _, o, _ = c.exec_command("echo OK", timeout=10)
            ok = b"OK" in o.read()
            c.close()
            if ok:
                print(f"SSH_READY attempt {i+1}")
                return True
        except Exception as ex:
            print(f"wait {i+1}: {type(ex).__name__}: {ex}")
            time.sleep(8)
    return False


if __name__ == "__main__":
    if not wait_ssh():
        raise SystemExit("SSH unavailable for backup drill")
    raise SystemExit(drill_main())
