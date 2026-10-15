from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import json
import os
import shutil
import sqlite3
import subprocess
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text
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

# Family backups are a logical, family-scoped JSON export. The whole-database
# copy (sqlite file copy / pg_dump) used to be zipped here and handed to the
# requesting family OWNER -- but registration is public, so any stranger could
# register, create a family, become its OWNER and download every family's data
# plus every user's password hash. Whole-database dumps belong to the server
# operator only (deploy/scripts, auto_backup_worker), never to an API caller.
FAMILY_EXPORT_FORMAT = "s4-family-export"
FAMILY_EXPORT_VERSION = 1

# Never exported, even when the table carries a family_id.
_EXPORT_EXCLUDED_TABLES = {
    "alembic_version",
    "users",
    "auth_session",
    "auth_sessions",
    "refresh_tokens",
    "otp_codes",
    "password_reset_tokens",
    "email_verification_tokens",
}
# Column names containing any of these fragments are stripped from every row.
_EXPORT_SENSITIVE_COLUMN_FRAGMENTS = ("password", "secret", "token", "otp", "api_key")
_USER_EXPORT_COLUMNS = ("id", "full_name", "email", "phone", "preferred_language")


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
    # Accept driver-qualified URLs too ("sqlite+pysqlite:///...").
    if not url.startswith("sqlite") or ":///" not in url:
        raise HTTPException(
            status_code=400,
            detail="Active database is not SQLite.",
        )

    raw_path = url.split(":///", 1)[1]
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
    """Write a custom-format pg_dump to dest. Returns method used.

    Server-operator helper only (whole database). Not reachable from any
    family-facing endpoint -- see FAMILY_EXPORT_FORMAT above.
    """
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


def _q(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _export_value(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return value


def _is_sensitive_column(name: str) -> bool:
    lowered = name.lower()
    return any(fragment in lowered for fragment in _EXPORT_SENSITIVE_COLUMN_FRAGMENTS)


def _clean_rows(rows) -> list[dict]:
    out = []
    for row in rows:
        out.append(
            {
                k: _export_value(v)
                for k, v in dict(row._mapping).items()
                if not _is_sensitive_column(str(k))
            }
        )
    return out


def _chunks(items: list, size: int = 500):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def build_family_export(db: Session, family_id: str) -> dict:
    """Collect only rows that belong to family_id.

    - families: the family row itself.
    - every table with a family_id column: rows WHERE family_id = :family_id.
    - tables without family_id (e.g. transaction_lines): rows whose foreign key
      points at an already-exported family row.
    - users: public profile columns of this family's members only.
    Identifiers come from the live schema (inspect()), values are bound.
    """
    insp = inspect(db.get_bind())
    table_names = sorted(insp.get_table_names())
    columns = {t: [c["name"] for c in insp.get_columns(t)] for t in table_names}

    tables: dict[str, list[dict]] = {}
    exported_ids: dict[str, set] = {}

    if "families" in columns:
        rows = db.execute(text("SELECT * FROM families WHERE id = :fid"), {"fid": family_id}).fetchall()
        tables["families"] = _clean_rows(rows)
        exported_ids["families"] = {family_id}

    for table in table_names:
        if table in _EXPORT_EXCLUDED_TABLES or table == "families":
            continue
        if "family_id" not in columns[table]:
            continue
        rows = db.execute(
            text(f"SELECT * FROM {_q(table)} WHERE {_q('family_id')} = :fid"),
            {"fid": family_id},
        ).fetchall()
        cleaned = _clean_rows(rows)
        tables[table] = cleaned
        if "id" in columns[table]:
            exported_ids[table] = {r.get("id") for r in cleaned if r.get("id") is not None}

    for table in table_names:
        if table in tables or table in _EXPORT_EXCLUDED_TABLES:
            continue
        collected: dict = {}
        for fk in insp.get_foreign_keys(table):
            parent = fk.get("referred_table")
            local_cols = fk.get("constrained_columns") or []
            if parent not in exported_ids or fk.get("referred_columns") != ["id"] or len(local_cols) != 1:
                continue
            parent_ids = sorted(str(x) for x in exported_ids[parent])
            for chunk in _chunks(parent_ids):
                params = {f"p{i}": v for i, v in enumerate(chunk)}
                placeholders = ", ".join(f":p{i}" for i in range(len(chunk)))
                rows = db.execute(
                    text(f"SELECT * FROM {_q(table)} WHERE {_q(local_cols[0])} IN ({placeholders})"),
                    params,
                ).fetchall()
                for row in _clean_rows(rows):
                    key = row.get("id") or json.dumps(row, sort_keys=True, default=str)
                    collected[key] = row
        if collected:
            tables[table] = list(collected.values())

    member_user_ids = sorted(
        {str(r.get("user_id")) for r in tables.get("family_members", []) if r.get("user_id")}
    )
    users: list[dict] = []
    if member_user_ids and "users" in columns:
        cols = [c for c in _USER_EXPORT_COLUMNS if c in columns["users"]]
        for chunk in _chunks(member_user_ids):
            params = {f"u{i}": v for i, v in enumerate(chunk)}
            placeholders = ", ".join(f":u{i}" for i in range(len(chunk)))
            rows = db.execute(
                text(f"SELECT {', '.join(_q(c) for c in cols)} FROM users WHERE id IN ({placeholders})"),
                params,
            ).fetchall()
            users.extend(_clean_rows(rows))
    tables["users"] = users

    return {
        "format": FAMILY_EXPORT_FORMAT,
        "version": FAMILY_EXPORT_VERSION,
        "family_id": family_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database_backend": _engine_backend(),
        "row_counts": {name: len(rows) for name, rows in tables.items()},
        "tables": tables,
    }


def _zip_contains_full_database(zip_path: Path) -> bool:
    """Legacy backups (before family-scoped export) hold the whole database."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        return any(not n.endswith(".json") for n in zf.namelist())


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
    payload_name = f"s4_backup_{family_id}_{ts}.json"

    export = build_family_export(db, family_id)
    payload = json.dumps(export, ensure_ascii=False, default=str).encode("utf-8")
    if not payload:
        raise HTTPException(
            status_code=500,
            detail="Backup failed: family export is empty.",
        )
    with zipfile.ZipFile(backup_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(payload_name, payload)

    return {
        "success": True,
        "family_id": family_id,
        "database_backend": backend,
        "method": "family_json_export",
        "backup_file": backup_zip_name,
        "backup_path": str(backup_zip_path),
        "row_counts": export["row_counts"],
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

    path = _validate_backup_name(family_id, file_name)
    if _zip_contains_full_database(path):
        raise HTTPException(
            status_code=410,
            detail=(
                "Legacy full-database backup: download disabled because it contains other "
                "families' data. Create a new backup, or ask the server operator."
            ),
        )

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
            # File name only: any signed-in user can call this endpoint, and
            # the absolute server path told them the host's directory layout.
            "database": source_db.name,
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
    # file_name is attacker-controlled input; the prefix/suffix check above is not
    # sufficient by itself since "/" or "\" segments (e.g. "..\\..\\secrets.zip")
    # would still pass it and let BACKUP_DIR / file_name resolve outside BACKUP_DIR.
    resolved_backup_dir = BACKUP_DIR.resolve()
    zip_path = (BACKUP_DIR / file_name).resolve()
    if resolved_backup_dir not in zip_path.parents:
        raise HTTPException(status_code=400, detail="Invalid backup file")
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
    elif any(n.endswith(".json") for n in names):
        kind = "family_export"
    return {
        "success": True,
        "family_id": family_id,
        "file_name": file_name,
        "contains_files": names,
        "backup_kind": kind,
        "restore_safe": True,
        "message": (
            "Backup file is valid. Full restore must be done with API stopped. "
            "SQLite: replace .db file. PostgreSQL: pg_restore / psql the dump. "
            "Family export (.json): rows of this family only, import manually."
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
    extracted_json = [x.name for x in restore_dir.glob("*.json")]

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
    elif extracted_json:
        next_step = (
            "Family export (JSON, this family's rows only). Review "
            f"{restore_dir / extracted_json[0]} and re-import rows table by table."
        )
    else:
        next_step = "No .db/.dump/.sql/.json found in archive — inspect prepared_dir."

    return {
        "success": True,
        "family_id": family_id,
        "file_name": file_name,
        "prepared_dir": str(restore_dir),
        "extracted_db_files": extracted_db,
        "extracted_dump_files": extracted_dump,
        "extracted_sql_files": extracted_sql,
        "extracted_json_files": extracted_json,
        "next_step": next_step,
    }


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
