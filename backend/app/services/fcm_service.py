"""Push delivery stub — Firebase Admin / FCM removed from S4.

In-app notifications still work via the API/database. Device push is disabled.
"""

from __future__ import annotations

from dataclasses import dataclass

REMOVED_NOTE = (
    "Firebase Admin / FCM removed. Use in-app notifications on the VPS API. "
    "Device push is permanently disabled."
)


@dataclass
class PushSendResult:
    sent: bool
    reason: str
    token: str | None = None
    title: str | None = None

    def as_dict(self) -> dict:
        return {
            "sent": self.sent,
            "reason": self.reason,
            "token": self.token,
            "title": self.title,
        }


def fcm_status() -> dict:
    return {
        "enabled": False,
        "configured": False,
        "project_id": None,
        "credentials_path_set": False,
        "credentials_file_exists": False,
        "firebase_admin_available": False,
        "note": REMOVED_NOTE,
    }


def is_fcm_configured() -> bool:
    return False


def _resolve_credentials_path() -> str | None:
    return None


def _firebase_admin_available() -> bool:
    return False


def _get_firebase_app():
    raise RuntimeError("Firebase Admin removed — FCM is permanently disabled")


def send_fcm_push(*, token: str, title: str, body: str, data: dict | None = None) -> PushSendResult:
    del data  # unused — Firebase push removed
    token = str(token or "").strip()
    title = str(title or "").strip()
    if not token:
        return PushSendResult(False, "Push token missing", title=title)
    if not title:
        return PushSendResult(False, "Title missing", token=token)
    return PushSendResult(False, REMOVED_NOTE, token=token, title=title)
