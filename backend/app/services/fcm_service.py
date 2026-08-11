"""FCM / push delivery (no fake send).

If FCM is not configured, returns sent=False with an honest reason.
Real send uses firebase-admin when credentials file exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings

_firebase_app = None


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


def _resolve_credentials_path() -> str | None:
    raw = (settings.FCM_CREDENTIALS_PATH or "").strip() or None
    if not raw:
        return None
    path = Path(raw)
    if path.is_file():
        return str(path.resolve())
    # Relative paths are resolved from backend package root (…/backend)
    backend_root = Path(__file__).resolve().parents[2]
    alt = (backend_root / raw).resolve()
    if alt.is_file():
        return str(alt)
    return str(path)


def fcm_status() -> dict:
    project_id = (settings.FCM_PROJECT_ID or "").strip() or None
    cred_path = _resolve_credentials_path()
    cred_exists = bool(cred_path and Path(cred_path).is_file())
    enabled = bool(settings.NOTIFICATION_FCM_ENABLED)
    admin_ok = _firebase_admin_available()
    configured = bool(enabled and project_id and cred_exists and admin_ok)
    note = "FCM ready" if configured else (
        "FCM not configured. Set NOTIFICATION_FCM_ENABLED=true, FCM_PROJECT_ID, "
        "and FCM_CREDENTIALS_PATH to a real Firebase service-account JSON; "
        "pip install firebase-admin (no fake send)."
    )
    if enabled and project_id and cred_path and not cred_exists:
        note = f"FCM credentials file missing: {cred_path}"
    elif enabled and project_id and cred_exists and not admin_ok:
        note = "FCM credentials present but firebase-admin is not installed (pip install firebase-admin)"
    return {
        "enabled": enabled,
        "configured": configured,
        "project_id": project_id,
        "credentials_path_set": bool((settings.FCM_CREDENTIALS_PATH or "").strip()),
        "credentials_file_exists": cred_exists,
        "firebase_admin_available": admin_ok,
        "note": note,
    }


def is_fcm_configured() -> bool:
    return bool(fcm_status()["configured"])


def _firebase_admin_available() -> bool:
    try:
        import firebase_admin  # noqa: F401
        return True
    except ImportError:
        return False


def _get_firebase_app():
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    if not is_fcm_configured():
        raise RuntimeError("FCM not configured")
    if not _firebase_admin_available():
        raise RuntimeError("firebase-admin not installed. pip install firebase-admin")

    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred_path = _resolve_credentials_path()
        if not cred_path:
            raise RuntimeError("FCM credentials path missing")
        cred = credentials.Certificate(cred_path)
        options = {}
        project_id = (settings.FCM_PROJECT_ID or "").strip()
        if project_id:
            options["projectId"] = project_id
        _firebase_app = firebase_admin.initialize_app(cred, options or None)
    else:
        _firebase_app = firebase_admin.get_app()
    return _firebase_app


def send_fcm_push(*, token: str, title: str, body: str, data: dict | None = None) -> PushSendResult:
    token = str(token or "").strip()
    title = str(title or "").strip()
    body = str(body or "").strip()
    if not token:
        return PushSendResult(False, "Push token missing", title=title)
    if not title:
        return PushSendResult(False, "Title missing", token=token)
    if not is_fcm_configured():
        return PushSendResult(False, fcm_status()["note"], token=token, title=title)

    try:
        _get_firebase_app()
        from firebase_admin import messaging

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={str(k): str(v) for k, v in (data or {}).items()},
            token=token,
        )
        messaging.send(message)
    except Exception as exc:  # noqa: BLE001 - surface real FCM failure honestly
        return PushSendResult(False, f"FCM send failed: {exc}", token=token, title=title)

    return PushSendResult(True, "sent", token=token, title=title)
