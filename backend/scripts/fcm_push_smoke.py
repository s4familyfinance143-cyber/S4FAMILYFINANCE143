#!/usr/bin/env python3
"""Firebase Admin / FCM removed — smoke test always reports push disabled."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    from app.services.fcm_service import fcm_status, is_fcm_configured, send_fcm_push

    status = fcm_status()
    print(status["note"])
    print("configured=", is_fcm_configured())
    result = send_fcm_push(token="smoke-token", title="S4", body="FCM removed")
    print(result.as_dict())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
