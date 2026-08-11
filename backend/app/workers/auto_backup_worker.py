from datetime import datetime, timezone
from pathlib import Path
import shutil
import zipfile

from app.core.database import engine


BASE_DIR = Path(__file__).resolve().parents[2]
BACKUP_DIR = BASE_DIR / "backups"
AUTO_BACKUP_DIR = BACKUP_DIR / "auto"


def _ensure_dirs():
    AUTO_BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _real_db_path() -> Path:
    url = str(engine.url)

    if not url.startswith("sqlite:///"):
        raise RuntimeError("Auto backup currently supports SQLite only")

    raw = url.replace("sqlite:///", "", 1)

    db_path = Path(raw)

    if not db_path.is_absolute():
        db_path = BASE_DIR / db_path

    if not db_path.exists():
        raise RuntimeError(f"Database file not found: {db_path}")

    return db_path


def create_auto_backup() -> dict:
    _ensure_dirs()

    source_db = _real_db_path()

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    temp_db = AUTO_BACKUP_DIR / f"s4_auto_backup_{ts}.db"
    zip_file = AUTO_BACKUP_DIR / f"s4_auto_backup_{ts}.zip"

    shutil.copy2(source_db, temp_db)

    with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(temp_db, arcname=temp_db.name)

    temp_db.unlink(missing_ok=True)

    return {
        "success": True,
        "backup_file": zip_file.name,
        "backup_path": str(zip_file),
        "created_at": datetime.now(timezone.utc),
    }


def cleanup_old_auto_backups(keep_last: int = 10) -> int:
    _ensure_dirs()

    backups = sorted(
        AUTO_BACKUP_DIR.glob("s4_auto_backup_*.zip"),
        key=lambda x: x.stat().st_mtime,
        reverse=True,
    )

    deleted = 0

    for old_file in backups[keep_last:]:
        old_file.unlink(missing_ok=True)
        deleted += 1

    return deleted


def process_auto_backup():
    now = datetime.now(timezone.utc)

    # এক দিনে একবার backup
    today_prefix = now.strftime("s4_auto_backup_%Y%m%d")

    already_today = list(
        AUTO_BACKUP_DIR.glob(f"{today_prefix}_*.zip")
    )

    if already_today:
        return {
            "success": True,
            "skipped": True,
            "reason": "Auto backup already created today",
        }

    result = create_auto_backup()
    deleted = cleanup_old_auto_backups(keep_last=10)

    result["deleted_old_backups"] = deleted
    result["skipped"] = False

    return result
