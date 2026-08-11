from datetime import datetime, timezone
from pathlib import Path
import shutil
import sqlite3
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.permission_service import require_permission

router = APIRouter(prefix="/backup", tags=["Backup & Restore"])

BASE_DIR = Path(__file__).resolve().parents[3]
DB_PATH = BASE_DIR / "s4_family_finance.db"
BACKUP_DIR = BASE_DIR / "backups"


def _ensure_backup_dir():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _db_path():
    if DB_PATH.exists():
        return DB_PATH

    found = list(BASE_DIR.glob("*.db"))
    if not found:
        raise HTTPException(status_code=500, detail="Database file not found")

    return found[0]


@router.post("/create/{family_id}")
def create_backup(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.create",
    )

    _ensure_backup_dir()

    source_db = _db_path()
    ts = _timestamp()

    backup_db_name = f"s4_backup_{family_id}_{ts}.db"
    backup_zip_name = f"s4_backup_{family_id}_{ts}.zip"

    backup_db_path = BACKUP_DIR / backup_db_name
    backup_zip_path = BACKUP_DIR / backup_zip_name

    shutil.copy2(source_db, backup_db_path)

    with zipfile.ZipFile(backup_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(backup_db_path, arcname=backup_db_name)

    backup_db_path.unlink(missing_ok=True)

    return {
        "success": True,
        "family_id": family_id,
        "backup_file": backup_zip_name,
        "backup_path": str(backup_zip_path),
        "created_at": datetime.now(timezone.utc),
    }


@router.get("/list/{family_id}")
def list_backups(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.read",
    )

    _ensure_backup_dir()

    files = []

    for file in BACKUP_DIR.glob(f"s4_backup_{family_id}_*.zip"):
        stat = file.stat()
        files.append(
            {
                "file_name": file.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(
                    stat.st_mtime,
                    tz=timezone.utc,
                ),
            }
        )

    return {
        "family_id": family_id,
        "count": len(files),
        "backups": sorted(
            files,
            key=lambda x: x["created_at"],
            reverse=True,
        ),
    }


@router.get("/download/{family_id}/{file_name}")
def download_backup(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.download",
    )

    if not file_name.startswith(f"s4_backup_{family_id}_") or not file_name.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid backup file")

    path = BACKUP_DIR / file_name

    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    return FileResponse(
        path=path,
        filename=file_name,
        media_type="application/zip",
    )


@router.get("/integrity")
def database_integrity_check(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    source_db = _db_path()

    conn = sqlite3.connect(source_db)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        conn.close()

    return {
        "database": str(source_db),
        "integrity_check": result,
        "ok": result == "ok",
    }
