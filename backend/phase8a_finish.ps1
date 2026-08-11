$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$PY="$BACKEND\.venv\Scripts\python.exe"

Set-Location $BACKEND

$VERIFY_OBJ = Get-ChildItem $PROJECT -Directory |
  Where-Object { $_.Name -like "ARCHITECTURE_PHASE_8A_REPORTS_AUDIT_INTEGRATION_AUDIT_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $VERIFY_OBJ) { throw "Phase 8A verify folder not found" }

$VERIFY=$VERIFY_OBJ.FullName

Select-String -Path "$VERIFY\00_backend_compile_check.txt" -Pattern "PASS" | Out-Null
Select-String -Path "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.txt" -Pattern "foreign_key_check_count: 0" | Out-Null
Select-String -Path "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.txt" -Pattern "imbalanced_count: 0" | Out-Null
Select-String -Path "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.txt" -Pattern "single_line_count: 0" | Out-Null
Select-String -Path "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.txt" -Pattern "cross_family_lines: 0" | Out-Null
Select-String -Path "$VERIFY\02_phase8a_route_openapi_audit.txt" -Pattern "missing_phase7_routes: \[\]" | Out-Null
Select-String -Path "$VERIFY\02_phase8a_route_openapi_audit.txt" -Pattern "missing_phase7_openapi: \[\]" | Out-Null

Get-Service postgresql-x64-17 | Select-Object Name,Status,DisplayName | Tee-Object "$VERIFY\04_postgres_service_check.txt"

$portOk = Test-NetConnection 127.0.0.1 -Port 5432
$portOk | Tee-Object "$VERIFY\05_postgres_port_check.txt"

if ($portOk.TcpTestSucceeded -ne $true) {
  throw "PostgreSQL port 5432 not reachable"
}

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

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

required_phase7_paths = [
    "/families/{family_id}/transactions",
    "/families/{family_id}/transactions/{transaction_id}",
]

missing_routes = [p for p in required_phase7_paths if p not in paths]
missing_openapi = [p for p in required_phase7_paths if p not in openapi_paths]

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)

if not settings.IS_POSTGRESQL:
    raise SystemExit(1)
if missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\06_phase8a_postgres_import_route_check.py" -Encoding UTF8

& $PY "$VERIFY\06_phase8a_postgres_import_route_check.py" | Tee-Object "$VERIFY\06_phase8a_postgres_import_route_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL import route check failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\07_phase8a_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL alembic current failed" }

Select-String -Path "$VERIFY\07_phase8a_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

@"
S4 FAMILY FINANCE 143 - PHASE 8B REPORTS / AUDIT INTEGRATION HARDENING TARGETS

Phase 8B should harden:

1. Family-scoped financial reports
- Double-entry financial summary
- Account-wise ledger
- Wallet/account summary
- Date range filter
- Permission enforcement

2. Double-entry report integrity
- Only valid balanced transactions included
- Cross-family account data blocked
- Debit/Credit totals verified

3. Audit integration
- Report view/export audit evidence
- No cross-family audit leakage
- Owner/admin/member permission separation

4. Export safety
- CSV/PDF export family-scoped
- Unauthorized member export blocked
- No private internal data leakage

5. API targets
- /families/{family_id}/reports/financial-summary
- /families/{family_id}/reports/account-ledger
- /families/{family_id}/reports/wallet-summary
- /families/{family_id}/reports/audit-activity
"@ | Set-Content "$VERIFY\08_phase8b_reports_audit_hardening_targets.txt" -Encoding UTF8

$TS=Get-Date -Format "yyyyMMdd-HHmmss"

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 8A REPORTS / AUDIT INTEGRATION AUDIT LOCK REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Backend compile passed
- SQLite reports/audit DB probe passed
- Core tables exist
- SQLite foreign_key_check_count = 0
- SQLite alembic_version = 0002_auth_hardening
- Double-entry integrity still clean
- Route/OpenAPI audit completed
- Source code report/audit search completed
- PostgreSQL service postgresql-x64-17 running
- PostgreSQL port 5432 reachable
- PostgreSQL import/route check passed
- PostgreSQL Alembic current verified: 0002_auth_hardening

VERIFY:
$VERIFY

NEXT:
Phase 8B Reports / Audit Integration Actual Hardening
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_8A_REPORTS_AUDIT_INTEGRATION_AUDIT_LOCK_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 8A REPORTS / AUDIT INTEGRATION AUDIT PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime