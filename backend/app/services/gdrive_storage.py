"""Google Drive storage for document vault (company service account).

Env:
  GDRIVE_SERVICE_ACCOUNT_JSON — path to SA JSON, or raw JSON string
  GDRIVE_ROOT_FOLDER_ID — shared Drive folder ID (SA must be Editor)
"""

from __future__ import annotations

import io
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import settings

GDRIVE_PATH_PREFIX = "gdrive:"
DRIVE_MIME_FOLDER = "application/vnd.google-apps.folder"


def _sa_json_raw() -> str | None:
    raw = (getattr(settings, "GDRIVE_SERVICE_ACCOUNT_JSON", None) or os.getenv("GDRIVE_SERVICE_ACCOUNT_JSON") or "").strip()
    if not raw:
        return None
    # Path to file
    if raw.startswith("{") and '"type"' in raw:
        return raw
    path = Path(raw)
    if path.is_file():
        return path.read_text(encoding="utf-8")
    # Common container mount
    alt = Path("/secrets/gdrive.json")
    if alt.is_file():
        return alt.read_text(encoding="utf-8")
    return None


def is_gdrive_configured() -> bool:
    folder = (getattr(settings, "GDRIVE_ROOT_FOLDER_ID", None) or os.getenv("GDRIVE_ROOT_FOLDER_ID") or "").strip()
    return bool(folder and _sa_json_raw())


def _gdrive_libs_available() -> bool:
    try:
        import google.auth  # noqa: F401
        from googleapiclient.discovery import build  # noqa: F401

        return True
    except ImportError:
        return False


@lru_cache(maxsize=1)
def _credentials():
    from google.oauth2 import service_account

    raw = _sa_json_raw()
    if not raw:
        raise RuntimeError("GDRIVE_SERVICE_ACCOUNT_JSON not set")
    info = json.loads(raw)
    scopes = ["https://www.googleapis.com/auth/drive"]
    return service_account.Credentials.from_service_account_info(info, scopes=scopes)


def _drive():
    if not _gdrive_libs_available():
        raise RuntimeError("google-api-python-client / google-auth not installed")
    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=_credentials(), cache_discovery=False)


def root_folder_id() -> str:
    folder = (getattr(settings, "GDRIVE_ROOT_FOLDER_ID", None) or os.getenv("GDRIVE_ROOT_FOLDER_ID") or "").strip()
    if not folder:
        raise RuntimeError("GDRIVE_ROOT_FOLDER_ID not set")
    return folder


def gdrive_status() -> dict[str, Any]:
    configured = is_gdrive_configured()
    libs = _gdrive_libs_available()
    note = "Google Drive vault ready"
    if not configured:
        note = (
            "Google Drive not configured. Set DOCUMENT_VAULT_BACKEND=gdrive, "
            "GDRIVE_SERVICE_ACCOUNT_JSON, GDRIVE_ROOT_FOLDER_ID "
            "(see deploy/GOOGLE_DRIVE_VAULT_SETUP.md)."
        )
    elif not libs:
        note = "GDrive env set but google-api-python-client not installed"
        configured = False
    return {
        "gdrive_configured": configured,
        "gdrive_libs_available": libs,
        "root_folder_id_set": bool(
            (getattr(settings, "GDRIVE_ROOT_FOLDER_ID", None) or os.getenv("GDRIVE_ROOT_FOLDER_ID") or "").strip()
        ),
        "sa_json_set": bool(_sa_json_raw()),
        "note": note,
    }


def _find_child_folder(parent_id: str, name: str) -> str | None:
    drive = _drive()
    safe = name.replace("'", "\\'")
    q = (
        f"name = '{safe}' and '{parent_id}' in parents and "
        f"mimeType = '{DRIVE_MIME_FOLDER}' and trashed = false"
    )
    res = drive.files().list(q=q, spaces="drive", fields="files(id,name)", pageSize=5).execute()
    files = res.get("files") or []
    return files[0]["id"] if files else None


def _ensure_folder(parent_id: str, name: str) -> str:
    existing = _find_child_folder(parent_id, name)
    if existing:
        return existing
    drive = _drive()
    meta = {"name": name, "mimeType": DRIVE_MIME_FOLDER, "parents": [parent_id]}
    created = drive.files().create(body=meta, fields="id").execute()
    return created["id"]


def ensure_family_folder(family_id: str) -> str:
    """Create root/families/{family_id} and return folder id."""
    root = root_folder_id()
    families = _ensure_folder(root, "families")
    return _ensure_folder(families, str(family_id))


def upload_bytes(*, family_id: str, stored_name: str, data: bytes, mime: str = "application/octet-stream") -> str:
    """Upload ciphertext blob; returns Drive file id."""
    from googleapiclient.http import MediaIoBaseUpload

    folder_id = ensure_family_folder(family_id)
    drive = _drive()
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime or "application/octet-stream", resumable=False)
    meta = {"name": stored_name, "parents": [folder_id]}
    created = drive.files().create(body=meta, media_body=media, fields="id").execute()
    file_id = created.get("id")
    if not file_id:
        raise RuntimeError("Google Drive upload returned no file id")
    return file_id


def download_bytes(file_id: str) -> bytes:
    from googleapiclient.http import MediaIoBaseDownload

    drive = _drive()
    request = drive.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


def delete_file(file_id: str) -> None:
    try:
        _drive().files().delete(fileId=file_id).execute()
    except Exception as exc:
        # Best-effort by design (the DB row is the source of truth for
        # "deleted", and the caller shouldn't block/fail a user-facing
        # delete on Drive being unreachable) — but silently swallowing this
        # meant a failed cleanup left a document (potentially an ID scan,
        # bank statement, etc.) sitting on Drive forever with zero
        # operational visibility. Log it; still doesn't raise.
        import logging

        logging.getLogger("s4.storage").warning(
            "Google Drive delete_file failed for file_id=%s: %s", file_id, exc
        )


def path_for_file_id(file_id: str) -> str:
    return f"{GDRIVE_PATH_PREFIX}{file_id}"


def file_id_from_path(relative_path: str) -> str | None:
    if not relative_path or not relative_path.startswith(GDRIVE_PATH_PREFIX):
        return None
    return relative_path[len(GDRIVE_PATH_PREFIX) :].strip() or None
