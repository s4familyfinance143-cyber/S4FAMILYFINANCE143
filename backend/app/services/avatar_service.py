"""Local profile avatar storage (no DB column required)."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, UploadFile, status

ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_BYTES = 2 * 1024 * 1024  # 2 MB


def avatars_dir() -> Path:
    root = Path(__file__).resolve().parents[2] / "storage" / "avatars"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _stem(user_id: str | UUID) -> str:
    return str(user_id).strip()


def find_avatar_file(user_id: str | UUID) -> Path | None:
    stem = _stem(user_id)
    for path in avatars_dir().glob(f"{stem}.*"):
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            return path
    return None


def avatar_url_for(user_id: str | UUID) -> str | None:
    path = find_avatar_file(user_id)
    if not path:
        return None
    # Cache-bust by mtime so UI refreshes after replace
    version = int(path.stat().st_mtime)
    return f"/auth/avatar/{_stem(user_id)}?v={version}"


async def save_avatar(user_id: str | UUID, upload: UploadFile) -> str:
    content_type = (upload.content_type or "").lower().strip()
    ext = ALLOWED_TYPES.get(content_type)
    if not ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPG, PNG or WebP images allowed",
        )

    data = await upload.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image must be 2MB or smaller",
        )

    # Replace any previous extension for this user
    for old in avatars_dir().glob(f"{_stem(user_id)}.*"):
        try:
            old.unlink()
        except OSError:
            pass

    dest = avatars_dir() / f"{_stem(user_id)}{ext}"
    dest.write_bytes(data)
    return avatar_url_for(user_id) or f"/auth/avatar/{_stem(user_id)}"


def delete_avatar(user_id: str | UUID) -> bool:
    removed = False
    for path in avatars_dir().glob(f"{_stem(user_id)}.*"):
        try:
            path.unlink()
            removed = True
        except OSError:
            pass
    return removed
