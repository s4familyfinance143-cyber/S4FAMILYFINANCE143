"""PostgreSQL cutover + restore drill (real DB, no demo seed).

Steps:
1) Ensure Docker Postgres is up (deploy/postgres/docker-compose.yml on :5433)
2) alembic upgrade head against DATABASE_URL
3) pg_dump -> pg_restore into a drill DB
4) Verify core tables exist and app Settings can talk to Postgres

Does NOT switch the live sqlite uvicorn process.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT.parent / "deploy" / "postgres"
ENV_FILE = ROOT / ".env.postgresql.local.cutover"
BACKUP_DIR = DEPLOY / "backups"

DATABASE_URL = "postgresql+psycopg://s4_user:s4_cutover_local_2026@127.0.0.1:5433/s4_family_finance"
DRILL_DB = "s4_family_finance_restore_drill"
CORE_TABLES = [
    "users",
    "families",
    "accounts",
    "transactions",
    "phase15_items",
    "phase16_items",
    "zakat_records",
    "alembic_version",
]


def run(cmd: list[str], *, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(">", " ".join(cmd))
    return subprocess.run(cmd, cwd=str(ROOT), env=env, check=check, text=True, capture_output=True)


def wait_for_postgres(timeout_sec: int = 90) -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    deadline = time.time() + timeout_sec
    last_err = None
    while time.time() < deadline:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("PASS postgres_ready")
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(2)
    raise RuntimeError(f"Postgres not ready: {last_err}")


def ensure_compose_up() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    result = run(["docker", "compose", "-f", str(DEPLOY / "docker-compose.yml"), "up", "-d"], check=False)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise RuntimeError("docker compose up failed — start Docker Desktop and retry")
    print("PASS compose_up")


def alembic_upgrade() -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = DATABASE_URL
    # pydantic-settings reads .env file if present; force URL via env
    result = run([sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=False)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr)
        raise RuntimeError("alembic upgrade failed")
    print("PASS alembic_upgrade")


def verify_tables(url: str = DATABASE_URL) -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(url, pool_pre_ping=True)
    with engine.connect() as conn:
        for table in CORE_TABLES:
            exists = conn.execute(
                text("SELECT to_regclass(:name)"),
                {"name": f"public.{table}"},
            ).scalar()
            if not exists:
                raise RuntimeError(f"Missing table: {table}")
            print("OK table", table)
    print("PASS verify_tables")


def restore_drill() -> None:
    dump = BACKUP_DIR / "s4_cutover_dump.dump"
    # Use docker exec for pg_dump/pg_restore (host may lack matching client tools)
    run(
        [
            "docker",
            "exec",
            "s4-family-finance-postgres",
            "pg_dump",
            "-U",
            "s4_user",
            "-d",
            "s4_family_finance",
            "-Fc",
            "-f",
            "/backups/s4_cutover_dump.dump",
        ]
    )
    if not dump.exists():
        # volume mount path on host
        pass
    run(
        [
            "docker",
            "exec",
            "s4-family-finance-postgres",
            "psql",
            "-U",
            "s4_user",
            "-d",
            "postgres",
            "-c",
            f"DROP DATABASE IF EXISTS {DRILL_DB};",
        ]
    )
    run(
        [
            "docker",
            "exec",
            "s4-family-finance-postgres",
            "psql",
            "-U",
            "s4_user",
            "-d",
            "postgres",
            "-c",
            f"CREATE DATABASE {DRILL_DB} OWNER s4_user;",
        ]
    )
    run(
        [
            "docker",
            "exec",
            "s4-family-finance-postgres",
            "pg_restore",
            "-U",
            "s4_user",
            "-d",
            DRILL_DB,
            "--clean",
            "--if-exists",
            "/backups/s4_cutover_dump.dump",
        ],
        check=False,  # pg_restore may warn on some objects
    )
    drill_url = DATABASE_URL.rsplit("/", 1)[0] + f"/{DRILL_DB}"
    verify_tables(drill_url)
    print("PASS restore_drill", DRILL_DB)


def main() -> None:
    if not ENV_FILE.exists():
        raise RuntimeError(f"Missing {ENV_FILE}")
    print("ENV_FILE", ENV_FILE)
    print("DATABASE_URL", DATABASE_URL)
    ensure_compose_up()
    wait_for_postgres()
    alembic_upgrade()
    verify_tables()
    restore_drill()
    print("PASS postgres_cutover_smoke")
    print("NOTE: Live sqlite API on :8000 was not switched. To run API on Postgres:")
    print("  copy .env.postgresql.local.cutover to .env and restart uvicorn on another port.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("FAIL", exc)
        sys.exit(1)
