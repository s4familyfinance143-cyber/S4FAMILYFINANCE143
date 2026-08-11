"""Shared SSH helper for local VM staging scripts (no hardcoded passwords).

Required (one of):
  S4_VM_PASSWORD   — password auth
  S4_VM_SSH_KEY    — path to private key

Optional:
  S4_VM_HOST          default 127.0.0.1
  S4_VM_PORT          default 2222
  S4_VM_USER          default s4family
  S4_VM_KNOWN_HOSTS   path to known_hosts (recommended)
  S4_VM_STRICT_HOST   if "1"/"true", reject unknown hosts (default true when known_hosts set)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko


def _env(name: str, default: str | None = None) -> str | None:
    val = os.environ.get(name)
    if val is None or str(val).strip() == "":
        return default
    return str(val).strip()


def vm_password() -> str | None:
    return _env("S4_VM_PASSWORD")


def connect_vm(*, timeout: int = 25) -> paramiko.SSHClient:
    host = _env("S4_VM_HOST", "127.0.0.1") or "127.0.0.1"
    port = int(_env("S4_VM_PORT", "2222") or "2222")
    user = _env("S4_VM_USER", "s4family") or "s4family"
    password = vm_password()
    key_path = _env("S4_VM_SSH_KEY")
    known_hosts = _env("S4_VM_KNOWN_HOSTS")
    strict = (_env("S4_VM_STRICT_HOST") or ("1" if known_hosts else "0")).lower() in {
        "1",
        "true",
        "yes",
    }

    if not password and not key_path:
        print(
            "ERROR: Set S4_VM_PASSWORD or S4_VM_SSH_KEY before running VM staging scripts.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    client = paramiko.SSHClient()
    if known_hosts and Path(known_hosts).is_file():
        client.load_host_keys(known_hosts)
        client.set_missing_host_key_policy(
            paramiko.RejectPolicy() if strict else paramiko.WarningPolicy()
        )
    elif strict:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        print(
            "ERROR: S4_VM_STRICT_HOST enabled but S4_VM_KNOWN_HOSTS missing. "
            "Provide known_hosts or set S4_VM_STRICT_HOST=0 for local lab only.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    else:
        # Local lab default: warn but do not silently AutoAdd without notice.
        client.set_missing_host_key_policy(paramiko.WarningPolicy())
        print(
            "WARN: host key not pinned (set S4_VM_KNOWN_HOSTS for safer SSH).",
            file=sys.stderr,
        )

    connect_kwargs: dict = {
        "hostname": host,
        "port": port,
        "username": user,
        "timeout": timeout,
        "banner_timeout": timeout,
        "auth_timeout": timeout,
        "allow_agent": False,
        "look_for_keys": False,
    }
    if key_path:
        connect_kwargs["key_filename"] = key_path
    if password:
        connect_kwargs["password"] = password

    client.connect(**connect_kwargs)
    return client


def sudo_prefix() -> str:
    """Return a sudo prefix that reads password from env when needed."""
    password = vm_password()
    if not password:
        return "sudo -n"
    # Avoid embedding password in process list when possible; caller may still need it for pty.
    return "sudo -S"


def write_sudo_password(stdin) -> None:
    password = vm_password()
    if not password:
        return
    stdin.write(password + "\n")
    stdin.flush()
