from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import sqlite3
import subprocess
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.database import get_db, engine
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.permission_service import require_permission

router = APIRouter(prefix="/backup", tags=["Backup & Restore"])

BASE_DIR = Path(__file__).resolve().parents[3]
BACKUP_DIR = BASE_DIR / "backups"
POSTGRES_DOCKER_CONTAINER = os.getenv(
    "BACKUP_POSTGRES_DOCKER_CONTAINER",
    "s4-family-finance-postgres",
)


def _ensure_backup_dir():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _engine_backend() -> str:
    url = str(engine.url)
    if url.startswith("sqlite"):
        return "sqlite"
    if url.startswith("postgresql"):
        return "postgresql"
    return "unknown"


def _sqlite_db_path() -> Path:
    url = str(engine.url)
    if not url.startswith("sqlite:///"):
        raise HTTPException(
            status_code=400,
            detail="Active database is not SQLite.",
        )

    raw_path = url.replace("sqlite:///", "", 1)
    db_path = Path(raw_path)
    if not db_path.is_absolute():
        db_path = BASE_DIR / db_path
    db_path = db_path.resolve()

    if not db_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Active database file not found: {db_path}",
        )
    if db_path.stat().st_size <= 0:
        raise HTTPException(
            status_code=500,
            detail=f"Active database file is empty: {db_path}",
        )
    return db_path


def _pg_dump_available() -> bool:
    return shutil.which("pg_dump") is not None


def _docker_available() -> bool:
    return shutil.which("docker") is not None


def _create_postgres_dump_file(dest: Path) -> str:
    """Write a custom-format pg_dump to dest. Returns method used."""
    url = engine.url
    user = url.username or "s4_user"
    database = url.database or "s4_family_finance"
    host = url.host or "127.0.0.1"
    port = str(url.port or 5432)
    password = url.password or ""

    if _pg_dump_available():
        env = {**os.environ, "PGPASSWORD": password}
        cmd = [
            "pg_dump",
            "-h",
            host,
            "-p",
            port,
            "-U",
            user,
            "-d",
            database,
            "-Fc",
            "-f",
            str(dest),
        ]
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"pg_dump failed: {(proc.stderr or proc.stdout or '').strip()[:500]}",
            )
        return "pg_dump"

    if _docker_available():
        # Dump via cutover/local Postgres container (stdout → host file).
        cmd = [
            "docker",
            "exec",
            "-e",
            f"PGPASSWORD={password}",
            POSTGRES_DOCKER_CONTAINER,
            "pg_dump",
            "-U",
            user,
            "-d",
            database,
            "-Fc",
        ]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()[:500]
            raise HTTPException(
                status_code=500,
                detail=(
                    "Postgres backup via docker exec failed. "
                    f"Is container '{POSTGRES_DOCKER_CONTAINER}' running? {err}"
                ),
            )
        dest.write_bytes(proc.stdout)
        return "docker_exec_pg_dump"

    raise HTTPException(
        status_code=400,
        detail=(
            "PostgreSQL backup needs `pg_dump` on PATH or Docker with container "
            f"'{POSTGRES_DOCKER_CONTAINER}'. Install PostgreSQL client tools or start "
            "deploy/postgres docker compose."
        ),
    )


def _zip_payload(zip_path: Path, payload_path: Path, arcname: str) -> None:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(payload_path, arcname=arcname)


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
    backend = _engine_backend()
    ts = _timestamp()
    backup_zip_name = f"s4_backup_{family_id}_{ts}.zip"
    backup_zip_path = BACKUP_DIR / backup_zip_name

    if backend == "sqlite":
        source_db = _sqlite_db_path()
        payload_name = f"s4_backup_{family_id}_{ts}.db"
        payload_path = BACKUP_DIR / payload_name
        shutil.copy2(source_db, payload_path)
        method = "sqlite_file_copy"
    elif backend == "postgresql":
        payload_name = f"s4_backup_{family_id}_{ts}.dump"
        payload_path = BACKUP_DIR / payload_name
        method = _create_postgres_dump_file(payload_path)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Backup does not support database backend: {backend}",
        )

    try:
        if payload_path.stat().st_size <= 0:
            raise HTTPException(
                status_code=500,
                detail="Backup failed: created dump/copy is empty.",
            )
        _zip_payload(backup_zip_path, payload_path, payload_name)
    finally:
        payload_path.unlink(missing_ok=True)

    return {
        "success": True,
        "family_id": family_id,
        "database_backend": backend,
        "method": method,
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
        "database_backend": _engine_backend(),
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
    backend = _engine_backend()

    if backend == "sqlite":
        source_db = _sqlite_db_path()
        conn = sqlite3.connect(source_db)
        try:
            result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            conn.close()
        return {
            "database_backend": backend,
            "database": str(source_db),
            "integrity_check": result,
            "ok": result == "ok",
        }

    if backend == "postgresql":
        public_tables = inspect(db.get_bind()).get_table_names(schema="public")
        return {
            "database_backend": backend,
            "database": engine.url.database,
            "public_table_count": len(public_tables),
            "integrity_check": "reachable",
            "ok": True,
            "note": "PostgreSQL integrity uses connectivity + public table count (not PRAGMA).",
        }

    raise HTTPException(status_code=400, detail=f"Unsupported backend: {backend}")


def _validate_backup_name(family_id: str, file_name: str) -> Path:
    if not file_name.startswith(f"s4_backup_{family_id}_") or not file_name.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid backup file")
    zip_path = BACKUP_DIR / file_name
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")
    return zip_path


def _preview_payload(family_id: str, file_name: str) -> dict:
    zip_path = _validate_backup_name(family_id, file_name)
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
    kind = "unknown"
    if any(n.endswith(".db") for n in names):
        kind = "sqlite"
    elif any(n.endswith(".dump") or n.endswith(".sql") for n in names):
        kind = "postgresql"
    return {
        "success": True,
        "family_id": family_id,
        "file_name": file_name,
        "contains_files": names,
        "backup_kind": kind,
        "restore_safe": True,
        "message": (
            "Backup file is valid. Full restore must be done with API stopped. "
            "SQLite: replace .db file. PostgreSQL: pg_restore / psql the dump."
        ),
    }


def _prepare_payload(family_id: str, file_name: str) -> dict:
    zip_path = _validate_backup_name(family_id, file_name)
    restore_dir = BACKUP_DIR / "restore_prepare"
    restore_dir.mkdir(parents=True, exist_ok=True)

    for old_file in restore_dir.glob("*"):
        if old_file.is_file():
            old_file.unlink(missing_ok=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(restore_dir)

    extracted_db = [x.name for x in restore_dir.glob("*.db")]
    extracted_dump = [x.name for x in restore_dir.glob("*.dump")]
    extracted_sql = [x.name for x in restore_dir.glob("*.sql")]

    if extracted_db:
        next_step = "Stop server, verify extracted DB, then replace current SQLite database manually."
    elif extracted_dump:
        next_step = (
            "Stop writers, then: "
            f"pg_restore -h HOST -U USER -d DB --clean --if-exists {restore_dir / extracted_dump[0]}"
        )
    elif extracted_sql:
        next_step = (
            "Stop writers, then: "
            f"psql -h HOST -U USER -d DB -f {restore_dir / extracted_sql[0]}"
        )
    else:
        next_step = "No .db/.dump/.sql found in archive — inspect prepared_dir."

    return {
        "success": True,
        "family_id": family_id,
        "file_name": file_name,
        "prepared_dir": str(restore_dir),
        "extracted_db_files": extracted_db,
        "extracted_dump_files": extracted_dump,
        "extracted_sql_files": extracted_sql,
        "next_step": next_step,
    }


@router.get("/restore/preview/{family_id}/{file_name}")
def preview_restore_backup(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.restore",
    )
    return _preview_payload(family_id, file_name)


@router.post("/restore/prepare/{family_id}/{file_name}")
def prepare_restore_backup(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.restore",
    )
    return _prepare_payload(family_id, file_name)


@router.get("/restore/preview-file/{family_id}")
def preview_restore_backup_by_query(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.restore",
    )
    return _preview_payload(family_id, file_name)


@router.post("/restore/prepare-file/{family_id}")
def prepare_restore_backup_by_query(
    family_id: str,
    file_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_permission(
        db=db,
        family_id=family_id,
        user_id=current_user.id,
        permission="backup.restore",
    )
    return _prepare_payload(family_id, file_name)
