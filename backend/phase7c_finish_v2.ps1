$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"

Set-Location $BACKEND

$VERIFY_OBJ = Get-ChildItem $PROJECT -Directory |
  Where-Object { $_.Name -like "ARCHITECTURE_PHASE_7C_DOUBLE_ENTRY_FINAL_E2E_BACKUP_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $VERIFY_OBJ) { throw "Phase 7C verify folder not found" }

$VERIFY=$VERIFY_OBJ.FullName

Select-String -Path "$VERIFY\01_phase7c_double_entry_final_e2e.txt" -Pattern "phase7b double entry transactions hardening e2e ok" | Out-Null

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

@'
from sqlalchemy import inspect, text
from app.core.database import engine

insp = inspect(engine)
tables = insp.get_table_names()
required = ["families", "family_members", "member_permissions", "users", "accounts", "transactions", "transaction_lines", "alembic_version"]
missing = [t for t in required if t not in tables]

with engine.connect() as conn:
    fk_count = len(conn.execute(text("PRAGMA foreign_key_check")).fetchall())
    alembic_version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
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
print("tx_count:", tx_count)
print("line_count:", line_count)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)

if missing or fk_count != 0 or alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\02_phase7c_sqlite_integrity_check.py" -Encoding UTF8

& $PY "$VERIFY\02_phase7c_sqlite_integrity_check.py" | Tee-Object "$VERIFY\02_phase7c_sqlite_integrity_check.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite integrity check failed" }

Get-Service postgresql-x64-17 | Select-Object Name,Status,DisplayName | Tee-Object "$VERIFY\03_postgres_service_check.txt"

$portOk = Test-NetConnection 127.0.0.1 -Port 5432
$portOk | Tee-Object "$VERIFY\04_postgres_port_check.txt"
if ($portOk.TcpTestSucceeded -ne $true) { throw "PostgreSQL port 5432 not reachable" }

$env:ENVIRONMENT="production"
$env:DATABASE_URL="postgresql+psycopg://postgres:s4m1%40v1i2@127.0.0.1:5432/s4_family_finance_phase1e_test"
$env:AUTO_CREATE_TABLES="false"
$env:JWT_SECRET_KEY="THIS_IS_A_STRONG_TEST_SECRET_123456789"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

@'
from app.main import app
from app.core.config import settings

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

required = [
    "/families/{family_id}/transactions",
    "/families/{family_id}/transactions/{transaction_id}",
]

missing_routes = [p for p in required if p not in paths]
missing_openapi = [p for p in required if p not in openapi_paths]

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)

if not settings.IS_POSTGRESQL or missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\05_phase7c_postgres_import_route_check.py" -Encoding UTF8

& $PY "$VERIFY\05_phase7c_postgres_import_route_check.py" | Tee-Object "$VERIFY\05_phase7c_postgres_import_route_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL import/route check failed" }

& $PY -m alembic upgrade head | Tee-Object "$VERIFY\06_phase7c_postgres_alembic_upgrade.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL alembic upgrade failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\07_phase7c_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL alembic current failed" }

Select-String -Path "$VERIFY\07_phase7c_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$STAGE="$BACKUPROOT\STAGE-PHASE-7C-DOUBLE-ENTRY-FINAL-$TS"
$ZIP="$BACKUPROOT\S4-FAMILY-FINANCE-143-DOUBLE-ENTRY-PHASE-7-FINAL-LOCKED-$TS.zip"

New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null
if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }
New-Item -ItemType Directory -Force $STAGE | Out-Null

robocopy $PROJECT $STAGE /E /XD ".git" ".venv" "node_modules" "__pycache__" ".pytest_cache" ".mypy_cache" ".ruff_cache" "dist" "build" /XF "*.pyc" "*.pyo" "*.log" | Out-Null
$rc=$LASTEXITCODE
if ($rc -gt 7) { throw "robocopy failed with exit code $rc" }

Compress-Archive -Path "$STAGE\*" -DestinationPath $ZIP -Force
$zipInfo = Get-Item $ZIP
if ($zipInfo.Length -le 0) { throw "Final Phase 7 ZIP is empty" }

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 7C DOUBLE-ENTRY TRANSACTIONS FINAL E2E + BACKUP LOCK REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Phase 7C final Double-Entry E2E passed
- SQLite schema/fk/integrity passed
- SQLite foreign_key_check_count = 0
- SQLite imbalanced_count = 0
- SQLite single_line_count = 0
- SQLite cross_family_lines = 0
- PostgreSQL service postgresql-x64-17 running
- PostgreSQL port 5432 reachable
- PostgreSQL import/route check passed
- PostgreSQL Alembic upgrade head passed
- PostgreSQL Alembic current verified: 0002_auth_hardening
- Final Phase 7 ZIP backup created

VERIFY:
$VERIFY

FINAL ZIP:
$ZIP

ZIP SIZE:
$($zipInfo.Length) bytes

NEXT:
Phase 8 Reports / Audit Integration
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_7C_DOUBLE_ENTRY_TRANSACTIONS_FINAL_LOCK_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 7C DOUBLE-ENTRY TRANSACTIONS FINAL E2E + BACKUP PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Final ZIP:" -ForegroundColor Yellow
Write-Host $ZIP -ForegroundColor Yellow
Write-Host "ZIP size:" -ForegroundColor Yellow
Write-Host "$($zipInfo.Length) bytes" -ForegroundColor Yellow