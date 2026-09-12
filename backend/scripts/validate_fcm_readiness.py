#!/usr/bin/env python3
"""Firebase Admin / FCM removed — always reports disabled."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    from app.services.fcm_service import fcm_status

    status = fcm_status()
    print(status["note"])
    print("configured=", status["configured"])
    print("firebase_admin_available=", status["firebase_admin_available"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
