#!/usr/bin/env python3
"""Local Alertmanager webhook sink — no Slack/PagerDuty required.

  python deploy/scripts/local_alert_webhook_sink.py
  # listens on 0.0.0.0:9999  POST /webhook
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8", errors="replace") or "{}")
        except json.JSONDecodeError:
            body = {"raw": raw.decode("utf-8", errors="replace")}
        print("=== alert webhook ===")
        print(json.dumps(body, indent=2, ensure_ascii=False))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, fmt, *args):  # noqa: A003
        print(f"[sink] {args[0]}")


if __name__ == "__main__":
    host, port = "0.0.0.0", 9999
    print(f"Listening on http://{host}:{port}/webhook")
    HTTPServer((host, port), Handler).serve_forever()
