"""Pytest bootstrap — force isolated SQLite and disable background workers.

Must run before any `app.*` import so settings/engine bind correctly.
Integration job sets INTEGRATION_TESTS=true and uses PostgreSQL instead.
"""

from __future__ import annotations

import os
from pathlib import Path

if os.getenv("INTEGRATION_TESTS") == "true":
    os.environ.setdefault(
        "DATABASE_URL",
        "postgresql+psycopg://s4_ci:ci_postgres_password@localhost:5432/s4_family_finance_ci",
    )
    os.environ["AUTO_CREATE_TABLES"] = "false"
    os.environ.setdefault("CELERY_ENABLED", "false")
else:
    # Isolate unit tests from live Postgres / Mailpit / MinIO cutover .env
    _TEST_DB = Path(__file__).resolve().parent.parent / "storage" / "pytest_tmp.db"
    _TEST_DB.parent.mkdir(parents=True, exist_ok=True)
    # Fresh schema each pytest process so model columns always match.
    if _TEST_DB.exists():
        try:
            _TEST_DB.unlink()
        except OSError:
            pass

    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{_TEST_DB.as_posix()}"
    os.environ["AUTO_CREATE_TABLES"] = "true"
    os.environ["ENABLE_RECURRING_WORKER"] = "false"
    os.environ["ENABLE_AUTO_BACKUP_WORKER"] = "false"
    os.environ["NOTIFICATION_FCM_ENABLED"] = "false"
    os.environ["NOTIFICATION_EMAIL_ENABLED"] = "false"
    os.environ["DOCUMENT_VAULT_BACKEND"] = "local"
    os.environ.pop("S3_ENDPOINT_URL", None)
    os.environ.pop("S3_BUCKET", None)
    os.environ.pop("S3_ACCESS_KEY", None)
    os.environ.pop("S3_SECRET_KEY", None)
    os.environ.pop("SMTP_HOST", None)
    os.environ.pop("SMTP_FROM_EMAIL", None)
    os.environ.pop("REDIS_URL", None)
    os.environ["CELERY_ENABLED"] = "false"
