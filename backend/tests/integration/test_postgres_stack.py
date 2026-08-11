"""PostgreSQL integration tests — CI runs with a Postgres service container."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def test_postgres_migrations_and_health():
    if os.getenv("INTEGRATION_TESTS") != "true":
        pytest.skip("Set INTEGRATION_TESTS=true for integration suite")

    subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        check=True,
        env=os.environ.copy(),
    )

    from app.main import app

    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body.get("status") == "ok"
    assert body.get("database") == "postgresql"
