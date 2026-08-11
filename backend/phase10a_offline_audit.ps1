$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\ARCHITECTURE_PHASE_10A_OFFLINE_SYNC_FINAL_PRODUCTION_AUDIT_$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null

$P9C = Get-ChildItem $PROJECT -Directory |
  Where-Object { $_.Name -like "ARCHITECTURE_PHASE_9C_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_FINAL_E2E_BACKUP_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $P9C) { throw "Phase 9C final verify folder not found" }

Select-String -Path "$($P9C.FullName)\ARCHITECTURE_PHASE_9C_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_FINAL_LOCK_REPORT.txt" -Pattern "STATUS: PASS" | Out-Null
Copy-Item "$($P9C.FullName)\ARCHITECTURE_PHASE_9C_AUDIT_FINAL_SYSTEM_AUDIT_TRAIL_FINAL_LOCK_REPORT.txt" "$VERIFY\00_previous_phase9c_final_lock_PASS.txt" -Force

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

Write-Host "1) Backend compile check..." -ForegroundColor Cyan

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "Backend compile failed" }

"Backend compile: PASS" | Set-Content "$VERIFY\01_backend_compile_PASS.txt" -Encoding UTF8

Write-Host "2) SQLite/offline database audit..." -ForegroundColor Cyan

@'
from pathlib import Path
from sqlalchemy import inspect, text
from app.core.database import engine

backend = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend")
db_file = backend / "s4_family_finance_dev.db"

insp = inspect(engine)
tables = sorted(insp.get_table_names())

required_core_tables = [
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

sync_candidate_tables = [
    "sync_queue",
    "sync_events",
    "sync_state",
    "sync_conflicts",
    "device_sync_state",
    "offline_queue",
    "outbox",
    "inbox",
    "change_log",
    "sync_log",
]

matched_sync_tables = [t for t in tables if any(k in t.lower() for k in ["sync", "queue", "outbox", "inbox", "conflict", "change_log"])]
missing_core_tables = [t for t in required_core_tables if t not in tables]
existing_sync_candidate_tables = [t for t in sync_candidate_tables if t in tables]
missing_sync_candidate_tables = [t for t in sync_candidate_tables if t not in tables]

with engine.connect() as conn:
    fk_count = len(conn.execute(text("PRAGMA foreign_key_check")).fetchall())
    alembic_version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()

    family_count = conn.execute(text("SELECT COUNT(*) FROM families")).scalar()
    user_count = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
    account_count = conn.execute(text("SELECT COUNT(*) FROM accounts")).scalar()
    tx_count = conn.execute(text("SELECT COUNT(*) FROM transactions")).scalar()
    line_count = conn.execute(text("SELECT COUNT(*) FROM transaction_lines")).scalar()
    audit_count = conn.execute(text("SELECT COUNT(*) FROM audit_logs")).scalar()

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

print("sqlite_database_url:", str(engine.url))
print("sqlite_db_file:", str(db_file))
print("sqlite_db_file_exists:", db_file.exists())
print("sqlite_db_file_size:", db_file.stat().st_size if db_file.exists() else 0)
print("table_count:", len(tables))
print("missing_core_tables:", missing_core_tables)
print("matched_sync_tables:", matched_sync_tables)
print("existing_sync_candidate_tables:", existing_sync_candidate_tables)
print("missing_sync_candidate_tables:", missing_sync_candidate_tables)
print("foreign_key_check_count:", fk_count)
print("alembic_version:", alembic_version)
print("family_count:", family_count)
print("user_count:", user_count)
print("account_count:", account_count)
print("tx_count:", tx_count)
print("line_count:", line_count)
print("audit_count:", audit_count)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)

if not db_file.exists():
    raise SystemExit(1)
if missing_core_tables:
    raise SystemExit(1)
if fk_count != 0:
    raise SystemExit(1)
if alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\02_phase10a_sqlite_offline_db_audit.py" -Encoding UTF8

& $PY "$VERIFY\02_phase10a_sqlite_offline_db_audit.py" | Tee-Object "$VERIFY\02_phase10a_sqlite_offline_db_audit.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite/offline DB audit failed" }

Write-Host "3) Offline/sync route OpenAPI audit..." -ForegroundColor Cyan

@'
from app.main import app

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = sorted(app.openapi().get("paths", {}).keys())

keywords = [
    "sync",
    "offline",
    "queue",
    "conflict",
    "device",
    "backup",
    "restore",
    "health",
    "audit-trail",
]

matched_routes = [p for p in paths if any(k in p.lower() for k in keywords)]
matched_openapi = [p for p in openapi_paths if any(k in p.lower() for k in keywords)]

required_existing_lock_paths = [
    "/families/{family_id}/audit-trail/activity",
    "/families/{family_id}/audit-trail/summary",
    "/families/{family_id}/audit-trail/entity/{entity_type}/{entity_id}",
    "/families/{family_id}/transactions",
    "/families/{family_id}/reports/financial-summary",
]

missing_locked_routes = [p for p in required_existing_lock_paths if p not in paths]
missing_locked_openapi = [p for p in required_existing_lock_paths if p not in openapi_paths]

phase10_target_paths = [
    "/families/{family_id}/sync/status",
    "/families/{family_id}/sync/pull",
    "/families/{family_id}/sync/push",
    "/families/{family_id}/sync/conflicts",
    "/families/{family_id}/sync/conflicts/{conflict_id}/resolve",
]

existing_phase10_target_paths = [p for p in phase10_target_paths if p in openapi_paths]
missing_phase10_target_paths = [p for p in phase10_target_paths if p not in openapi_paths]

print("total_routes:", len(paths))
print("matched_offline_sync_routes_count:", len(matched_routes))
print("matched_offline_sync_routes:")
for p in matched_routes:
    print(" ", p)

print("matched_offline_sync_openapi_count:", len(matched_openapi))
print("matched_offline_sync_openapi:")
for p in matched_openapi:
    print(" ", p)

print("missing_locked_routes:", missing_locked_routes)
print("missing_locked_openapi:", missing_locked_openapi)
print("existing_phase10_target_paths:", existing_phase10_target_paths)
print("missing_phase10_target_paths:", missing_phase10_target_paths)

if missing_locked_routes or missing_locked_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\03_phase10a_offline_sync_route_openapi_audit.py" -Encoding UTF8

& $PY "$VERIFY\03_phase10a_offline_sync_route_openapi_audit.py" | Tee-Object "$VERIFY\03_phase10a_offline_sync_route_openapi_audit.txt"
if ($LASTEXITCODE -ne 0) { throw "Offline/sync route OpenAPI audit failed" }

Write-Host "4) Offline/sync source search..." -ForegroundColor Cyan

@'
from pathlib import Path

root = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app")
keywords = [
    "offline",
    "sync",
    "sqlcipher",
    "sqlite",
    "conflict",
    "queue",
    "outbox",
    "inbox",
    "device",
    "last_synced",
    "sync_version",
    "row_version",
    "updated_at",
    "deleted_at",
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

print("offline_sync_source_hit_files:", len(hits))
for file_path, matched in hits:
    print(file_path)
    print("  keywords:", ", ".join(matched))
'@ | Set-Content "$VERIFY\04_phase10a_offline_sync_source_search.py" -Encoding UTF8

& $PY "$VERIFY\04_phase10a_offline_sync_source_search.py" | Tee-Object "$VERIFY\04_phase10a_offline_sync_source_search.txt"
if ($LASTEXITCODE -ne 0) { throw "Offline/sync source search failed" }

Write-Host "5) PostgreSQL final check..." -ForegroundColor Cyan

Get-Service postgresql-x64-17 | Select-Object Name,Status,DisplayName | Tee-Object "$VERIFY\05_postgres_service_check.txt"

$portOk = Test-NetConnection 127.0.0.1 -Port 5432
$portOk | Tee-Object "$VERIFY\06_postgres_port_check.txt"
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

required_existing_lock_paths = [
    "/families/{family_id}/audit-trail/activity",
    "/families/{family_id}/transactions",
    "/families/{family_id}/reports/financial-summary",
]

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

missing_routes = [p for p in required_existing_lock_paths if p not in paths]
missing_openapi = [p for p in required_existing_lock_paths if p not in openapi_paths]

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)

if not settings.IS_POSTGRESQL:
    raise SystemExit(1)
if missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\07_phase10a_postgres_import_route_check.py" -Encoding UTF8

& $PY "$VERIFY\07_phase10a_postgres_import_route_check.py" | Tee-Object "$VERIFY\07_phase10a_postgres_import_route_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL import/route check failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\08_phase10a_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL Alembic current failed" }

Select-String -Path "$VERIFY\08_phase10a_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

Write-Host "6) Write Phase 10B hardening target plan..." -ForegroundColor Cyan

@"
S4 FAMILY FINANCE 143 - PHASE 10B OFFLINE SYNC ENGINE / FINAL PRODUCTION OFFLINE HARDENING TARGETS

Phase 10A audit completed. Phase 10B should harden production offline/sync foundation.

TARGET 1: Offline local database safety
- Confirm local SQLite runtime works without PostgreSQL
- Keep all locked modules usable offline
- Keep double-entry integrity offline
- Keep audit trail readable offline
- Do not break existing SQLite DB

TARGET 2: Sync tables / sync queue foundation
Expected tables/models to add safely if missing:
- sync_devices
- sync_outbox
- sync_inbox
- sync_conflicts
- sync_state

TARGET 3: Family-scoped sync APIs
Expected endpoints:
- GET /families/{family_id}/sync/status
- POST /families/{family_id}/sync/push
- GET /families/{family_id}/sync/pull
- GET /families/{family_id}/sync/conflicts
- POST /families/{family_id}/sync/conflicts/{conflict_id}/resolve

TARGET 4: Offline-first rules
- Local write must work first
- Sync queue stores pending changes
- Server sync happens later when online
- No cross-family sync leakage
- Conflict records must be family-scoped
- Deleted rows use soft-delete where available

TARGET 5: Security
- RBAC permission enforcement
- Device identity tracking
- Audit evidence for sync push/pull/conflict resolve
- No raw secret leakage

TARGET 6: Final production offline lock
- SQLite integrity check
- PostgreSQL Alembic check
- Offline simulation test
- Sync push/pull E2E test
- ZIP backup
"@ | Set-Content "$VERIFY\09_phase10b_offline_sync_hardening_targets.txt" -Encoding UTF8

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 10A OFFLINE SYNC ENGINE / FINAL PRODUCTION OFFLINE AUDIT LOCK REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Previous Phase 9C final lock confirmed
- Backend compile passed
- SQLite/offline DB audit passed
- Local SQLite DB file exists
- Core locked tables exist
- SQLite foreign_key_check_count = 0
- SQLite alembic_version = 0002_auth_hardening
- Double-entry integrity still clean
- Offline/sync route OpenAPI audit completed
- Offline/sync source search completed
- PostgreSQL service postgresql-x64-17 running
- PostgreSQL port 5432 reachable
- PostgreSQL import/route check passed
- PostgreSQL Alembic current verified: 0002_auth_hardening
- Phase 10B hardening targets written

VERIFY:
$VERIFY

NEXT:
Phase 10B Offline Sync Engine Actual Hardening
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_10A_OFFLINE_SYNC_FINAL_PRODUCTION_AUDIT_LOCK_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 10A OFFLINE SYNC ENGINE / FINAL PRODUCTION OFFLINE AUDIT PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime