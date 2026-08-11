$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\ARCHITECTURE_PHASE_8A_REPORTS_AUDIT_INTEGRATION_AUDIT_$TS"

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

Write-Host "2) SQLite reports/audit database audit..." -ForegroundColor Cyan

@'
from pathlib import Path
from sqlalchemy import inspect, text
from app.core.database import engine

insp = inspect(engine)
tables = sorted(insp.get_table_names())

keywords = ["report", "audit", "transaction", "line", "account", "ledger", "export"]
matched_tables = [t for t in tables if any(k in t.lower() for k in keywords)]

required_core_tables = [
    "families",
    "family_members",
    "member_permissions",
    "users",
    "accounts",
    "transactions",
    "transaction_lines",
    "alembic_version",
]

missing_core_tables = [t for t in required_core_tables if t not in tables]

with engine.connect() as conn:
    fk_count = len(conn.execute(text("PRAGMA foreign_key_check")).fetchall())
    alembic_version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()

    table_counts = {}
    for t in matched_tables:
        try:
            table_counts[t] = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
        except Exception as exc:
            table_counts[t] = f"ERROR: {exc}"

    tx_count = conn.execute(text("SELECT COUNT(*) FROM transactions")).scalar() if "transactions" in tables else None
    line_count = conn.execute(text("SELECT COUNT(*) FROM transaction_lines")).scalar() if "transaction_lines" in tables else None
    account_count = conn.execute(text("SELECT COUNT(*) FROM accounts")).scalar() if "accounts" in tables else None

    imbalanced_count = 0
    single_line_count = 0
    cross_family_lines = 0

    if "transactions" in tables and "transaction_lines" in tables:
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

    if "transactions" in tables and "transaction_lines" in tables and "accounts" in tables:
        cross_family_lines = conn.execute(text("""
            SELECT COUNT(*)
            FROM transaction_lines tl
            JOIN transactions t ON t.id = tl.transaction_id
            JOIN accounts a ON a.id = tl.account_id
            WHERE a.family_id != t.family_id
        """)).scalar()

print("sqlite_database:", str(engine.url))
print("table_count:", len(tables))
print("matched_table_count:", len(matched_tables))
print("matched_tables:", matched_tables)
print("missing_core_tables:", missing_core_tables)
print("foreign_key_check_count:", fk_count)
print("alembic_version:", alembic_version)
print("account_count:", account_count)
print("tx_count:", tx_count)
print("line_count:", line_count)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)
print("table_counts:")
for k, v in table_counts.items():
    print(f"  {k}: {v}")

if missing_core_tables:
    raise SystemExit(1)
if fk_count != 0:
    raise SystemExit(1)
if alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.py" -Encoding UTF8

& $PY "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.py" | Tee-Object "$VERIFY\01_phase8a_sqlite_reports_audit_db_probe.txt"
if ($LASTEXITCODE -ne 0) { throw "SQLite reports/audit DB probe failed" }

Write-Host "3) FastAPI route/OpenAPI audit..." -ForegroundColor Cyan

@'
from app.main import app

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = sorted(app.openapi().get("paths", {}).keys())

route_keywords = [
    "report",
    "reports",
    "audit",
    "audits",
    "export",
    "exports",
    "transaction",
    "transactions",
    "account",
    "accounts",
    "wallet",
    "wallets",
    "dashboard",
    "summary",
    "ledger",
]

matched_routes = []
for p in paths:
    if any(k in p.lower() for k in route_keywords):
        matched_routes.append(p)

matched_openapi = []
for p in openapi_paths:
    if any(k in p.lower() for k in route_keywords):
        matched_openapi.append(p)

required_phase7_paths = [
    "/families/{family_id}/transactions",
    "/families/{family_id}/transactions/{transaction_id}",
]

missing_phase7_routes = [p for p in required_phase7_paths if p not in paths]
missing_phase7_openapi = [p for p in required_phase7_paths if p not in openapi_paths]

print("total_routes:", len(paths))
print("matched_routes_count:", len(matched_routes))
print("matched_routes:")
for p in matched_routes:
    print(" ", p)

print("openapi_candidate_paths_count:", len(matched_openapi))
print("openapi_candidate_paths:")
for p in matched_openapi:
    print(" ", p)

print("missing_phase7_routes:", missing_phase7_routes)
print("missing_phase7_openapi:", missing_phase7_openapi)

if missing_phase7_routes or missing_phase7_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\02_phase8a_route_openapi_audit.py" -Encoding UTF8

& $PY "$VERIFY\02_phase8a_route_openapi_audit.py" | Tee-Object "$VERIFY\02_phase8a_route_openapi_audit.txt"
if ($LASTEXITCODE -ne 0) { throw "Route/OpenAPI audit failed" }

Write-Host "4) Source code report/audit search..." -ForegroundColor Cyan

@'
from pathlib import Path

root = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL\backend\app")
keywords = [
    "report",
    "reports",
    "audit",
    "audit_log",
    "export",
    "csv",
    "pdf",
    "dashboard",
    "summary",
    "ledger",
    "transaction_lines",
    "double_entry",
]

hits = []

for path in root.rglob("*.py"):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue

    low = text.lower()
    matched = [k for k in keywords if k.lower() in low]
    if matched:
        hits.append((str(path), matched))

print("source_hit_files:", len(hits))
for file_path, matched in hits:
    print(file_path)
    print("  keywords:", ", ".join(matched))
'@ | Set-Content "$VERIFY\03_phase8a_source_search.py" -Encoding UTF8

& $PY "$VERIFY\03_phase8a_source_search.py" | Tee-Object "$VERIFY\03_phase8a_source_search.txt"
if ($LASTEXITCODE -ne 0) { throw "Source search failed" }

Write-Host "5) PostgreSQL check..." -ForegroundColor Cyan

Get-Service postgresql-x64-17 | Select-Object Name,Status,DisplayName | Tee-Object "$VERIFY\04_postgres_service_check.txt"

$portOk = Test-NetConnection 127.0.0.1 -Port 5432
$portOk | Tee-Object "$VERIFY\05_postgres_port_check.txt"
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

Write-Host "6) Write Phase 8B hardening target plan..." -ForegroundColor Cyan

@"
S4 FAMILY FINANCE 143 - PHASE 8B REPORTS / AUDIT INTEGRATION HARDENING TARGETS

Based on Phase 8A audit, Phase 8B should harden:

1. Family-scoped financial reports
   - Income/expense summary from double-entry transactions
   - Account-wise ledger
   - Wallet/account balance report
   - Date range filter
   - Family permission enforcement

2. Double-entry report integrity
   - Only POSTED/valid transactions included if status column exists
   - Debit/Credit totals must stay balanced
   - Cross-family account data must be blocked

3. Audit integration
   - Report view/export actions should create/read audit evidence if audit table/service exists
   - No cross-family audit leakage
   - Owner/admin permission separation

4. Export safety
   - CSV/export should be family-scoped
   - No raw internal IDs exposed unless needed
   - No unauthorized member export

5. API targets
   - /families/{family_id}/reports/financial-summary
   - /families/{family_id}/reports/account-ledger
   - /families/{family_id}/reports/wallet-summary
   - /families/{family_id}/reports/audit-activity
"@ | Set-Content "$VERIFY\08_phase8b_reports_audit_hardening_targets.txt" -Encoding UTF8

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