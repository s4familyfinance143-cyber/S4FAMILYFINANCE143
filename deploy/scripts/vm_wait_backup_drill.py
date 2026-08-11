#!/usr/bin/env python3
"""Retry SSH then run Postgres backup drill."""
from __future__ import annotations

import time

import paramiko

from vm_backup_drill import main as drill_main

HOST, PORT, USER, PASSWORD = "127.0.0.1", 2222, "s4family", "root"


def wait_ssh(tries: int = 18) -> bool:
    for i in range(tries):
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=15, banner_timeout=30, auth_timeout=20)
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
