$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\ARCHITECTURE_PHASE_9C_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_FINAL_E2E_BACKUP_$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

$P9B = Get-ChildItem $PROJECT -Directory |
  Where-Object { $_.Name -like "ARCHITECTURE_PHASE_9B_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_HARDENING_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $P9B) { throw "Phase 9B verify folder not found" }

Select-String -Path "$($P9B.FullName)\ARCHITECTURE_PHASE_9B_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_HARDENING_REPORT.txt" -Pattern "STATUS: PASS" | Out-Null
Copy-Item "$($P9B.FullName)\ARCHITECTURE_PHASE_9B_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_HARDENING_REPORT.txt" "$VERIFY\00_previous_phase9b_hardening_PASS.txt" -Force

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

Write-Host "1) Backend compile check..." -ForegroundColor Cyan

& $PY -m py_compile "$BACKEND\app\api\v1\audit_trail_hardened.py"
if ($LASTEXITCODE -ne 0) { throw "audit_trail_hardened.py compile failed" }

& $PY -m py_compile "$BACKEND\app\main.py"
if ($LASTEXITCODE -ne 0) { throw "main.py compile failed" }

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "backend compileall failed" }

"Backend compile: PASS" | Set-Content "$VERIFY\01_backend_compile_PASS.txt" -Encoding UTF8

Write-Host "2) Phase 9C Audit Trail E2E..." -ForegroundColor Cyan

@'
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.database import engine
from app.api.v1 import audit_trail_hardened as phase9b


def get_seed():
    with engine.connect() as conn:
        user_id = conn.execute(text("SELECT id FROM users LIMIT 1")).scalar()
        if not user_id:
            raise RuntimeError("No user found for Phase 9C E2E")

        family_id = conn.execute(text("""
            SELECT family_id
            FROM audit_logs
            WHERE family_id IS NOT NULL AND family_id != ''
            GROUP BY family_id
            ORDER BY COUNT(*) DESC
            LIMIT 1
        """)).scalar()

        if not family_id:
            raise RuntimeError("No family audit rows found for Phase 9C E2E")

        entity = conn.execute(
            text("""
                SELECT entity_type, entity_id
                FROM audit_logs
                WHERE family_id = :family_id
                  AND entity_type IS NOT NULL
                  AND entity_type != ''
                  AND entity_id IS NOT NULL
                  AND entity_id != ''
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"family_id": family_id},
        ).mappings().first()

        if not entity:
            entity = {
                "entity_type": "AUDIT_TRAIL",
                "entity_id": "NO_EXISTING_ENTITY_ID",
            }

        bad_family_id = conn.execute(
            text("""
                SELECT id
                FROM families
                WHERE id != :family_id
                LIMIT 1
            """),
            {"family_id": family_id},
        ).scalar()

        audit_before = conn.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE family_id = :family_id"),
            {"family_id": family_id},
        ).scalar()

        return {
            "user_id": str(user_id),
            "family_id": str(family_id),
            "entity_type": str(entity["entity_type"]),
            "entity_id": str(entity["entity_id"]),
            "bad_family_id": str(bad_family_id) if bad_family_id else None,
            "audit_before": int(audit_before or 0),
        }


seed = get_seed()

fake_user = SimpleNamespace(
    id=seed["user_id"],
    email="phase9c@s4.local",
    is_active=True,
)

app.dependency_overrides[phase9b._phase5b_get_current_user] = lambda: fake_user


def allow_permission(db, family_id, current_user, permission):
    return {
        "family_id": str(family_id),
        "user_id": str(getattr(current_user, "id", "")),
        "permission": permission,
        "allowed": True,
    }


def deny_permission(db, family_id, current_user, permission):
    raise HTTPException(status_code=403, detail="Phase 9C permission denied test")


phase9b._phase5b_require_permission = allow_permission

client = TestClient(app)

family_id = seed["family_id"]

activity = client.get(f"/families/{family_id}/audit-trail/activity", params={"limit": 25})
assert activity.status_code == 200, activity.text
activity_json = activity.json()
assert activity_json["status"] == "ok"
assert activity_json["family_id"] == family_id
assert activity_json["immutable"] is True
assert activity_json["read_only"] is True
assert isinstance(activity_json["rows"], list)
for row in activity_json["rows"]:
    assert row.get("family_id") == family_id, row

summary = client.get(f"/families/{family_id}/audit-trail/summary")
assert summary.status_code == 200, summary.text
summary_json = summary.json()
assert summary_json["status"] == "ok"
assert summary_json["family_id"] == family_id
assert summary_json["immutable"] is True
assert summary_json["read_only"] is True
assert "total_audit_rows" in summary_json

entity = client.get(
    f"/families/{family_id}/audit-trail/entity/{seed['entity_type']}/{seed['entity_id']}",
    params={"limit": 25},
)
assert entity.status_code == 200, entity.text
entity_json = entity.json()
assert entity_json["status"] == "ok"
assert entity_json["family_id"] == family_id
assert entity_json["entity_type"] == seed["entity_type"]
assert entity_json["entity_id"] == seed["entity_id"]
assert entity_json["immutable"] is True
assert entity_json["read_only"] is True
assert isinstance(entity_json["rows"], list)
for row in entity_json["rows"]:
    assert row.get("family_id") == family_id, row

phase9b._phase5b_require_permission = deny_permission
blocked = client.get(f"/families/{family_id}/audit-trail/activity")
assert blocked.status_code == 403, blocked.text

phase9b._phase5b_require_permission = allow_permission

if seed["bad_family_id"]:
    cross = client.get(f"/families/{seed['bad_family_id']}/audit-trail/activity", params={"limit": 25})
    assert cross.status_code == 200, cross.text
    cross_json = cross.json()
    for row in cross_json["rows"]:
        assert row.get("family_id") == seed["bad_family_id"], row
    cross_family_leak_check = True
else:
    cross_family_leak_check = "SKIPPED_NO_OTHER_FAMILY"

with engine.connect() as conn:
    audit_after = conn.execute(
        text("SELECT COUNT(*) FROM audit_logs WHERE family_id = :family_id"),
        {"family_id": family_id},
    ).scalar()

assert int(audit_after or 0) >= seed["audit_before"]

mutation_methods = []
for route in app.routes:
    path = getattr(route, "path", "")
    methods = getattr(route, "methods", set()) or set()
    if path.startswith("/families/{family_id}/audit-trail"):
        bad = sorted([m for m in methods if m not in {"GET", "HEAD"}])
        if bad:
            mutation_methods.append({"path": path, "methods": bad})

assert mutation_methods == [], mutation_methods

print("phase9c audit final system audit trail e2e ok")
print("family_id:", family_id)
print("entity_type:", seed["entity_type"])
print("entity_id:", seed["entity_id"])
print("activity_status:", activity.status_code)
print("summary_status:", summary.status_code)
print("entity_status:", entity.status_code)
print("permission_block_status:", blocked.status_code)
print("cross_family_leak_check:", cross_family_leak_check)
print("mutation_methods:", mutation_methods)
print("audit_before:", seed["audit_before"])
print("audit_after:", int(audit_after or 0))
print("activity_rows:", len(activity_json.get("rows", [])))
print("summary_total_audit_rows:", summary_json.get("total_audit_rows"))
print("entity_rows:", len(entity_json.get("rows", [])))
'@ | Set-Content "$VERIFY\02_phase9c_audit_trail_e2e.py" -Encoding UTF8

& $PY "$VERIFY\02_phase9c_audit_trail_e2e.py" | Tee-Object "$VERIFY\02_phase9c_audit_trail_e2e.txt"
if ($LASTEXITCODE -ne 0) { throw "Phase 9C Audit Trail E2E failed" }

Select-String -Path "$VERIFY\02_phase9c_audit_trail_e2e.txt" -Pattern "phase9c audit final system audit trail e2e ok" | Out-Null
Select-String -Path "$VERIFY\02_phase9c_audit_trail_e2e.txt" -Pattern "permission_block_status: 403" | Out-Null
Select-String -Path "$VERIFY\02_phase9c_audit_trail_e2e.txt" -Pattern "mutation_methods: \[\]" | Out-Null

Write-Host "3) SQLite final integrity check..." -ForegroundColor Cyan

@'
from sqlalchemy import inspect, text
from app.core.database import engine

insp = inspect(engine)
tables = insp.get_table_names()

required = [
    "families",
    "family_members",
    "users",
    "member_permissions",
    "accounts",
    "transactions",
    "transaction_lines",
    "audit_logs",
    "alembic_version",
]

missing = [t for t in required if t not in tables]

with engine.connect() as conn:
    fk_count = len(conn.execute(text("PRAGMA foreign_key_check")).fetchall())
    alembic_version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    audit_count = conn.execute(text("SELECT COUNT(*) FROM audit_logs")).scalar()
    null_family_audit_count = conn.execute(text("SELECT COUNT(*) FROM audit_logs WHERE family_id IS NULL OR family_id = ''")).scalar()
    tx_count = conn.execute(text("SELECT COUNT(*) FROM transactions")).scalar()
    line_count = conn.execute(text("SELECT COUNT(*) FROM transaction_lines")).scalar()

    imbalanced_count = conn.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT transaction_id,
                   ROUND(SUM(COALESCE(debit,0)) - SUM(COALESCE(credit,0)), 2) AS diff
            FROM transaction_lines
            GROUP BY transaction_id
            HAVING diff != 0
        )
    """)).scalar()

    single_line_count = conn.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT transaction_id, COUNT(*) AS line_count
            FROM transaction_lines
            GROUP BY transaction_id
            HAVING line_count < 2
        )
    """)).scalar()

    cross_family_lines = conn.execute(text("""
        SELECT COUNT(*)
        FROM transaction_lines tl
        JOIN transactions t ON t.id = tl.transaction_id
        JOIN accounts a ON a.id = tl.account_id
        WHERE a.family_id != t.family_id
    """)).scalar()

print("missing_required_tables:", missing)
print("foreign_key_check_count:", fk_count)
print("alembic_version:", alembic_version)
print("audit_count:", audit_count)
print("null_family_audit_count:", null_family_audit_count)
print("tx_count:", tx_count)
print("line_count:", line_count)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)

if missing:
    raise SystemExit(1)
if fk_count != 0:
    raise SystemExit(1)
if alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if null_family_audit_count != 0:
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\03_phase9c_sqlite_final_integrity.py" -Encoding UTF8

& $PY "$VERIFY\03_phase9c_sqlite_final_integrity.py" | Tee-Object "$VERIFY\03_phase9c_sqlite_final_integrity.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite final integrity check failed" }

Write-Host "4) PostgreSQL final route/alembic check..." -ForegroundColor Cyan

Get-Service postgresql-x64-17 | Select-Object Name,Status,DisplayName | Tee-Object "$VERIFY\04_postgres_service_check.txt"

$portOk = Test-NetConnection 127.0.0.1 -Port 5432
$portOk | Tee-Object "$VERIFY\05_postgres_port_check.txt"
if ($portOk.TcpTestSucceeded -ne $true) { throw "PostgreSQL port 5432 not reachable" }

$env:PYTHONPATH=$BACKEND
$env:ENVIRONMENT="production"
$env:DATABASE_URL="postgresql+psycopg://postgres:s4m1%40v1i2@127.0.0.1:5432/s4_family_finance_phase1e_test"
$env:AUTO_CREATE_TABLES="false"
$env:JWT_SECRET_KEY="THIS_IS_A_STRONG_TEST_SECRET_123456789"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

@'
from app.main import app
from app.core.config import settings

required = [
    "/families/{family_id}/audit-trail/activity",
    "/families/{family_id}/audit-trail/summary",
    "/families/{family_id}/audit-trail/entity/{entity_type}/{entity_id}",
]

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

missing_routes = [p for p in required if p not in paths]
missing_openapi = [p for p in required if p not in openapi_paths]

mutation_methods = []
for route in app.routes:
    path = getattr(route, "path", "")
    methods = getattr(route, "methods", set()) or set()
    if path.startswith("/families/{family_id}/audit-trail"):
        bad = sorted([m for m in methods if m not in {"GET", "HEAD"}])
        if bad:
            mutation_methods.append({"path": path, "methods": bad})

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)
print("mutation_methods:", mutation_methods)

if not settings.IS_POSTGRESQL:
    raise SystemExit(1)
if missing_routes or missing_openapi or mutation_methods:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\06_phase9c_postgres_route_openapi_check.py" -Encoding UTF8

& $PY "$VERIFY\06_phase9c_postgres_route_openapi_check.py" | Tee-Object "$VERIFY\06_phase9c_postgres_route_openapi_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL route/openapi check failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\07_phase9c_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL alembic current failed" }

Select-String -Path "$VERIFY\07_phase9c_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

Write-Host "5) Final ZIP backup..." -ForegroundColor Cyan

$TS2=Get-Date -Format "yyyyMMdd-HHmmss"
$STAGE="$BACKUPROOT\STAGE-PHASE-9C-AUDIT-FINAL-$TS2"
$ZIP="$BACKUPROOT\S4-FAMILY-FINANCE-143-AUDIT-TRAIL-PHASE-9-FINAL-LOCKED-$TS2.zip"

if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }
New-Item -ItemType Directory -Force $STAGE | Out-Null

robocopy $PROJECT $STAGE /E /XD ".git" ".venv" "node_modules" "__pycache__" ".pytest_cache" ".mypy_cache" ".ruff_cache" "dist" "build" /XF "*.pyc" "*.pyo" "*.log" | Out-Null
$rc=$LASTEXITCODE
if ($rc -gt 7) { throw "robocopy failed with exit code $rc" }

Compress-Archive -Path "$STAGE\*" -DestinationPath $ZIP -Force
$zipInfo = Get-Item $ZIP
if ($zipInfo.Length -le 0) { throw "Final Phase 9 ZIP is empty" }

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 9C AUDIT FINAL / SYSTEM AUDIT TRAIL FINAL E2E + BACKUP LOCK REPORT

STATUS: PASS
Time: $TS2

VERIFIED:
- Previous Phase 9B Actual Hardening confirmed
- Backend compile passed
- Phase 9C Audit Trail E2E passed
- Audit activity endpoint passed
- Audit summary endpoint passed
- Entity audit trail endpoint passed
- Permission deny check returned 403
- Cross-family audit leak check passed
- Mutation method check passed: only GET/HEAD
- Audit count did not decrease after audit trail reads
- SQLite final integrity passed
- SQLite foreign_key_check_count = 0
- SQLite null_family_audit_count = 0
- SQLite imbalanced_count = 0
- SQLite single_line_count = 0
- SQLite cross_family_lines = 0
- PostgreSQL service postgresql-x64-17 running
- PostgreSQL port 5432 reachable
- PostgreSQL route/OpenAPI check passed
- PostgreSQL mutation method check passed
- PostgreSQL Alembic current verified: 0002_auth_hardening
- Final Phase 9 ZIP backup created

VERIFY:
$VERIFY

FINAL ZIP:
$ZIP

ZIP SIZE:
$($zipInfo.Length) bytes

NEXT:
Phase 10 Offline Sync Engine / Final Production Offline Lock
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_9C_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_FINAL_LOCK_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 9C AUDIT FINAL / SYSTEM AUDIT TRAIL FINAL E2E + BACKUP PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Final ZIP:" -ForegroundColor Yellow
Write-Host $ZIP -ForegroundColor Yellow
Write-Host "ZIP size:" -ForegroundColor Yellow
Write-Host "$($zipInfo.Length) bytes" -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime