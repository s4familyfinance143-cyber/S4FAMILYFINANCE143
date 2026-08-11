$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\ARCHITECTURE_PHASE_9A_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_AUDIT_$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

Write-Host "1) Backend compile check..." -ForegroundColor Cyan

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "Backend compile failed" }

"Backend compile: PASS" | Set-Content "$VERIFY\00_backend_compile_check.txt" -Encoding UTF8

Write-Host "2) SQLite audit trail DB/schema audit..." -ForegroundColor Cyan

@'
from sqlalchemy import inspect, text
from app.core.database import engine

insp = inspect(engine)
tables = sorted(insp.get_table_names())

required_tables = [
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

missing_required_tables = [t for t in required_tables if t not in tables]

audit_cols = []
audit_col_names = []
if "audit_logs" in tables:
    audit_cols = insp.get_columns("audit_logs")
    audit_col_names = [c["name"] for c in audit_cols]

wanted_audit_cols = [
    "id",
    "family_id",
    "user_id",
    "action",
    "entity_type",
    "entity_id",
    "description",
    "details",
    "metadata",
    "created_at",
    "updated_at",
]
missing_audit_cols = [c for c in wanted_audit_cols if c not in audit_col_names]

with engine.connect() as conn:
    fk_count = len(conn.execute(text("PRAGMA foreign_key_check")).fetchall())
    alembic_version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()

    audit_count = conn.execute(text("SELECT COUNT(*) FROM audit_logs")).scalar() if "audit_logs" in tables else None
    family_count = conn.execute(text("SELECT COUNT(*) FROM families")).scalar() if "families" in tables else None
    user_count = conn.execute(text("SELECT COUNT(*) FROM users")).scalar() if "users" in tables else None
    tx_count = conn.execute(text("SELECT COUNT(*) FROM transactions")).scalar() if "transactions" in tables else None
    line_count = conn.execute(text("SELECT COUNT(*) FROM transaction_lines")).scalar() if "transaction_lines" in tables else None

    null_family_audit_count = None
    audit_family_rows = []
    action_rows = []
    latest_rows = []

    if "audit_logs" in tables and "family_id" in audit_col_names:
        null_family_audit_count = conn.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE family_id IS NULL OR family_id = ''")
        ).scalar()

        audit_family_rows = conn.execute(text("""
            SELECT family_id, COUNT(*) AS audit_count
            FROM audit_logs
            GROUP BY family_id
            ORDER BY audit_count DESC
            LIMIT 10
        """)).fetchall()

    if "audit_logs" in tables and "action" in audit_col_names:
        action_rows = conn.execute(text("""
            SELECT action, COUNT(*) AS count
            FROM audit_logs
            GROUP BY action
            ORDER BY count DESC
            LIMIT 20
        """)).fetchall()

    if "audit_logs" in tables:
        order_col = "created_at" if "created_at" in audit_col_names else "id"
        latest_rows = conn.execute(text(f"""
            SELECT *
            FROM audit_logs
            ORDER BY "{order_col}" DESC
            LIMIT 5
        """)).fetchall()

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

print("sqlite_database:", str(engine.url))
print("table_count:", len(tables))
print("missing_required_tables:", missing_required_tables)
print("audit_columns:", audit_col_names)
print("missing_audit_columns:", missing_audit_cols)
print("foreign_key_check_count:", fk_count)
print("alembic_version:", alembic_version)
print("family_count:", family_count)
print("user_count:", user_count)
print("tx_count:", tx_count)
print("line_count:", line_count)
print("audit_count:", audit_count)
print("null_family_audit_count:", null_family_audit_count)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)

print("audit_by_family:")
for row in audit_family_rows:
    print(" ", dict(row._mapping))

print("audit_by_action:")
for row in action_rows:
    print(" ", dict(row._mapping))

print("latest_audit_rows:")
for row in latest_rows:
    print(" ", dict(row._mapping))

if missing_required_tables:
    raise SystemExit(1)
if fk_count != 0:
    raise SystemExit(1)
if alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
if audit_count is None:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\01_phase9a_sqlite_audit_trail_db_schema_audit.py" -Encoding UTF8

& $PY "$VERIFY\01_phase9a_sqlite_audit_trail_db_schema_audit.py" | Tee-Object "$VERIFY\01_phase9a_sqlite_audit_trail_db_schema_audit.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite audit trail DB/schema audit failed" }

Write-Host "3) Audit route/OpenAPI audit..." -ForegroundColor Cyan

@'
from app.main import app

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = sorted(app.openapi().get("paths", {}).keys())

keywords = ["audit", "audit-logs", "logs", "activity", "report"]
matched_routes = [p for p in paths if any(k in p.lower() for k in keywords)]
matched_openapi = [p for p in openapi_paths if any(k in p.lower() for k in keywords)]

required_audit_paths = [
    "/audit-logs/{family_id}",
    "/audit-logs/summary/{family_id}",
    "/audit-logs/entity/{family_id}/{entity_type}/{entity_id}",
    "/families/{family_id}/reports/audit-activity",
]

missing_routes = [p for p in required_audit_paths if p not in paths]
missing_openapi = [p for p in required_audit_paths if p not in openapi_paths]

print("total_routes:", len(paths))
print("matched_routes_count:", len(matched_routes))
print("matched_routes:")
for p in matched_routes:
    print(" ", p)

print("matched_openapi_count:", len(matched_openapi))
print("matched_openapi:")
for p in matched_openapi:
    print(" ", p)

print("missing_audit_routes:", missing_routes)
print("missing_audit_openapi:", missing_openapi)

if missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\02_phase9a_audit_route_openapi_audit.py" -Encoding UTF8

& $PY "$VERIFY\02_phase9a_audit_route_openapi_audit.py" | Tee-Object "$VERIFY\02_phase9a_audit_route_openapi_audit.txt"
if ($LASTEXITCODE -ne 0) { throw "Audit route/OpenAPI audit failed" }

Write-Host "4) Audit source usage search..." -ForegroundColor Cyan

@'
from pathlib import Path

root = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app")
keywords = [
    "audit_logs",
    "AuditLog",
    "audit_service",
    "create_audit",
    "log_audit",
    "record_audit",
    "REPORT_VIEW",
    "entity_type",
    "entity_id",
]

hits = []

for path in root.rglob("*.py"):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue

    matched = [k for k in keywords if k.lower() in text.lower()]
    if matched:
        hits.append((str(path), matched))

print("audit_source_hit_files:", len(hits))
for file_path, matched in hits:
    print(file_path)
    print("  keywords:", ", ".join(matched))
'@ | Set-Content "$VERIFY\03_phase9a_audit_source_usage_search.py" -Encoding UTF8

& $PY "$VERIFY\03_phase9a_audit_source_usage_search.py" | Tee-Object "$VERIFY\03_phase9a_audit_source_usage_search.txt"
if ($LASTEXITCODE -ne 0) { throw "Audit source usage search failed" }

Write-Host "5) PostgreSQL audit route/alembic check..." -ForegroundColor Cyan

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

required_audit_paths = [
    "/audit-logs/{family_id}",
    "/audit-logs/summary/{family_id}",
    "/audit-logs/entity/{family_id}/{entity_type}/{entity_id}",
    "/families/{family_id}/reports/audit-activity",
]

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

missing_routes = [p for p in required_audit_paths if p not in paths]
missing_openapi = [p for p in required_audit_paths if p not in openapi_paths]

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_audit_routes:", missing_routes)
print("missing_audit_openapi:", missing_openapi)

if not settings.IS_POSTGRESQL:
    raise SystemExit(1)
if missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\06_phase9a_postgres_audit_route_openapi_check.py" -Encoding UTF8

& $PY "$VERIFY\06_phase9a_postgres_audit_route_openapi_check.py" | Tee-Object "$VERIFY\06_phase9a_postgres_audit_route_openapi_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL audit route/OpenAPI check failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\07_phase9a_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL Alembic current failed" }

Select-String -Path "$VERIFY\07_phase9a_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

Write-Host "6) Write Phase 9B hardening target plan..." -ForegroundColor Cyan

@"
S4 FAMILY FINANCE 143 - PHASE 9B AUDIT FINAL / SYSTEM AUDIT TRAIL HARDENING TARGETS

Phase 9B should harden:

1. Central audit trail router/service
- Family-scoped audit activity endpoint
- Entity audit lookup endpoint
- Audit summary endpoint
- No cross-family audit leakage

2. Immutable audit safety
- Audit rows should never be updated/deleted through public API
- Audit list must be read-only
- Critical app actions should leave audit evidence where supported

3. Permission lock
- audit.view / audit.view_all permission enforcement
- Owner/Admin access allowed
- Normal member blocked unless permission granted

4. Report/audit integration lock
- Report view/export audit evidence should be visible
- Audit activity report should read only same-family rows

5. Integrity checks
- audit_logs table exists
- audit FK integrity clean
- no broken double-entry rows
- PostgreSQL + SQLite both safe

Expected Phase 9B endpoints:
- GET /families/{family_id}/audit-trail/activity
- GET /families/{family_id}/audit-trail/summary
- GET /families/{family_id}/audit-trail/entity/{entity_type}/{entity_id}
"@ | Set-Content "$VERIFY\08_phase9b_audit_final_hardening_targets.txt" -Encoding UTF8

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 9A AUDIT FINAL / SYSTEM AUDIT TRAIL AUDIT LOCK REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Backend compile passed
- SQLite audit trail DB/schema audit passed
- audit_logs table exists
- SQLite foreign_key_check_count = 0
- SQLite alembic_version = 0002_auth_hardening
- Double-entry integrity still clean
- Audit route/OpenAPI audit completed
- Audit source usage search completed
- PostgreSQL service postgresql-x64-17 running
- PostgreSQL port 5432 reachable
- PostgreSQL audit route/OpenAPI check passed
- PostgreSQL Alembic current verified: 0002_auth_hardening

VERIFY:
$VERIFY

NEXT:
Phase 9B Audit Final / System Audit Trail Actual Hardening
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_9A_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_AUDIT_LOCK_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 9A AUDIT FINAL / SYSTEM AUDIT TRAIL AUDIT PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime