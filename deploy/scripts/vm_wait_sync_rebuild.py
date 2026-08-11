#!/usr/bin/env python3
"""After VM boot: wait for SSH, then sync+rebuild staging (wrapper)."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
SYNC = ROOT / "deploy" / "scripts" / "vm_sync_rebuild_staging.py"


def ssh_ok() -> bool:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect(
            "127.0.0.1",
            port=2222,
            username="s4family",
            password="root",
            timeout=15,
            banner_timeout=30,
            auth_timeout=20,
        )
        _, o, _ = c.exec_command("echo OK", timeout=10)
        ok = b"OK" in o.read()
        c.close()
        return ok
    except Exception as ex:
        print("wait:", type(ex).__name__, ex)
        return False


def main() -> int:
    for i in range(24):
        print(f"SSH attempt {i+1}/24 ...")
        if ssh_ok():
            print("SSH_READY")
            return subprocess.call([sys.executable, "-u", str(SYNC)])
        time.sleep(10)
    print("SSH never came up")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
