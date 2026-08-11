#!/usr/bin/env python3
"""Generate self-signed TLS materials on Ubuntu VM (practice only — does not break :80)."""
from __future__ import annotations

import time
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vm_ssh_common import connect_vm

USER = os.environ.get("S4_VM_USER", "s4family")


def main() -> int:
    c = connect_vm(timeout=25)
    cmd = f"""
set -e
CERT_DIR=/home/{USER}/s4/deploy/nginx/certs
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/s4-staging.crt" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT_DIR/s4-staging.key" \
    -out "$CERT_DIR/s4-staging.crt" \
    -subj "/CN=s4family.local/O=S4 Staging/C=BD"
  echo CERT_CREATED
else
  echo CERT_EXISTS
fi
ls -la "$CERT_DIR"
cat > /home/{USER}/s4/deploy/nginx/s4_staging_selfsigned.example.conf <<'EOF'
# PRACTICE ONLY — copy ideas into host nginx / Caddy.
# Compose frontend already binds host :80.
# Suggested practice: host listens :8443 → proxy_pass http://127.0.0.1:80;
#
# server {{
#   listen 8443 ssl;
#   server_name s4family.local;
#   ssl_certificate     /path/to/s4-staging.crt;
#   ssl_certificate_key /path/to/s4-staging.key;
#   location / {{
#     proxy_pass http://127.0.0.1:80;
#     proxy_set_header Host $host;
#     proxy_set_header X-Forwarded-Proto https;
#   }}
# }}
EOF
echo TLS_PRACTICE_PASS
echo NOTE: HTTP staging remains http://127.0.0.1:8088 — real public TLS needs domain+certbot on VPS
"""
    stdin, stdout, stderr = c.exec_command(cmd, get_pty=True, timeout=60)
    time.sleep(0.2)
    print(stdout.read().decode("utf-8", errors="replace"))
    code = stdout.channel.recv_exit_status()
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
