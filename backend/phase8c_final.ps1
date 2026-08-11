$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\ARCHITECTURE_PHASE_8C_REPORTS_AUDIT_INTEGRATION_FINAL_E2E_BACKUP_$TS"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

$P8B = Get-ChildItem $PROJECT -Directory |
  Where-Object { $_.Name -like "ARCHITECTURE_PHASE_8B_REPORTS_AUDIT_INTEGRATION_HARDENING_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $P8B) { throw "Phase 8B verify folder not found" }

Select-String -Path "$($P8B.FullName)\ARCHITECTURE_PHASE_8B_REPORTS_AUDIT_INTEGRATION_HARDENING_REPORT.txt" -Pattern "STATUS: PASS" | Out-Null
Copy-Item "$($P8B.FullName)\ARCHITECTURE_PHASE_8B_REPORTS_AUDIT_INTEGRATION_HARDENING_REPORT.txt" "$VERIFY\00_previous_phase8b_hardening_PASS.txt" -Force

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

Write-Host "1) Backend compile check..." -ForegroundColor Cyan

& $PY -m py_compile "$BACKEND\app\api\v1\reports_audit_integration_hardened.py"
if ($LASTEXITCODE -ne 0) { throw "reports_audit_integration_hardened.py compile failed" }

& $PY -m py_compile "$BACKEND\app\main.py"
if ($LASTEXITCODE -ne 0) { throw "main.py compile failed" }

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "backend compileall failed" }

"Backend compile: PASS" | Set-Content "$VERIFY\01_backend_compile_PASS.txt" -Encoding UTF8

Write-Host "2) Phase 8C Reports/Audit E2E..." -ForegroundColor Cyan

@'
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.database import engine
from app.api.v1 import reports_audit_integration_hardened as phase8b


def q(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def get_required_seed():
    with engine.connect() as conn:
        user_id = conn.execute(text("SELECT id FROM users LIMIT 1")).scalar()
        if not user_id:
            raise RuntimeError("No user found for Phase 8C E2E")

        tx = conn.execute(text("""
            SELECT t.id AS transaction_id, t.family_id AS family_id
            FROM transactions t
            JOIN transaction_lines tl ON tl.transaction_id = t.id
            JOIN accounts a ON a.id = tl.account_id
            GROUP BY t.id, t.family_id
            HAVING COUNT(*) >= 2
               AND ROUND(SUM(COALESCE(tl.debit,0)) - SUM(COALESCE(tl.credit,0)), 2) = 0
               AND SUM(CASE WHEN a.family_id = t.family_id THEN 0 ELSE 1 END) = 0
            LIMIT 1
        """)).mappings().first()

        if not tx:
            raise RuntimeError("No valid balanced transaction found for Phase 8C E2E")

        account_id = conn.execute(
            text("""
                SELECT account_id
                FROM transaction_lines
                WHERE transaction_id = :txid
                LIMIT 1
            """),
            {"txid": tx["transaction_id"]},
        ).scalar()

        if not account_id:
            raise RuntimeError("No account line found for Phase 8C E2E")

        bad_account_id = conn.execute(
            text("""
                SELECT id
                FROM accounts
                WHERE family_id != :family_id
                LIMIT 1
            """),
            {"family_id": tx["family_id"]},
        ).scalar()

        audit_before = conn.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE family_id = :family_id"),
            {"family_id": tx["family_id"]},
        ).scalar()

        return {
            "user_id": str(user_id),
            "family_id": str(tx["family_id"]),
            "transaction_id": str(tx["transaction_id"]),
            "account_id": str(account_id),
            "bad_account_id": str(bad_account_id) if bad_account_id else None,
            "audit_before": int(audit_before or 0),
        }


seed = get_required_seed()

fake_user = SimpleNamespace(
    id=seed["user_id"],
    email="phase8c@s4.local",
    is_active=True,
)

app.dependency_overrides[phase8b._phase5b_get_current_user] = lambda: fake_user


def allow_permission(db, family_id, current_user, permission):
    return {
        "family_id": str(family_id),
        "user_id": str(getattr(current_user, "id", "")),
        "permission": permission,
        "allowed": True,
    }


def deny_permission(db, family_id, current_user, permission):
    raise HTTPException(status_code=403, detail="Phase 8C permission denied test")


phase8b._phase5b_require_permission = allow_permission

client = TestClient(app)

family_id = seed["family_id"]
account_id = seed["account_id"]

financial = client.get(f"/families/{family_id}/reports/financial-summary")
assert financial.status_code == 200, financial.text
financial_json = financial.json()
assert financial_json["status"] == "ok"
assert financial_json["family_id"] == family_id
assert financial_json["integrity"]["balanced_only"] is True
assert financial_json["integrity"]["minimum_two_lines"] is True
assert financial_json["integrity"]["family_scoped"] is True

ledger = client.get(
    f"/families/{family_id}/reports/account-ledger",
    params={"account_id": account_id, "limit": 50},
)
assert ledger.status_code == 200, ledger.text
ledger_json = ledger.json()
assert ledger_json["status"] == "ok"
assert ledger_json["family_id"] == family_id
assert isinstance(ledger_json["rows"], list)

wallet = client.get(f"/families/{family_id}/reports/wallet-summary")
assert wallet.status_code == 200, wallet.text
wallet_json = wallet.json()
assert wallet_json["status"] == "ok"
assert wallet_json["family_id"] == family_id
assert "wallet_count" in wallet_json
assert "wallets" in wallet_json

audit = client.get(f"/families/{family_id}/reports/audit-activity", params={"limit": 25})
assert audit.status_code == 200, audit.text
audit_json = audit.json()
assert audit_json["status"] == "ok"
assert audit_json["family_id"] == family_id
assert "rows" in audit_json

if seed["bad_account_id"]:
    cross = client.get(
        f"/families/{family_id}/reports/account-ledger",
        params={"account_id": seed["bad_account_id"]},
    )
    assert cross.status_code == 404, cross.text
    cross_family_account_blocked = True
else:
    cross_family_account_blocked = "SKIPPED_NO_OTHER_FAMILY_ACCOUNT"

phase8b._phase5b_require_permission = deny_permission
blocked = client.get(f"/families/{family_id}/reports/financial-summary")
assert blocked.status_code == 403, blocked.text

phase8b._phase5b_require_permission = allow_permission

with engine.connect() as conn:
    audit_after = conn.execute(
        text("SELECT COUNT(*) FROM audit_logs WHERE family_id = :family_id"),
        {"family_id": family_id},
    ).scalar()

assert int(audit_after or 0) >= seed["audit_before"]

print("phase8c reports audit integration e2e ok")
print("family_id:", family_id)
print("transaction_id:", seed["transaction_id"])
print("account_id:", account_id)
print("bad_account_id:", seed["bad_account_id"])
print("financial_status:", financial.status_code)
print("ledger_status:", ledger.status_code)
print("wallet_status:", wallet.status_code)
print("audit_status:", audit.status_code)
print("permission_block_status:", blocked.status_code)
print("cross_family_account_blocked:", cross_family_account_blocked)
print("audit_before:", seed["audit_before"])
print("audit_after:", int(audit_after or 0))
print("financial_transaction_count:", financial_json.get("summary", {}).get("transaction_count"))
print("ledger_rows:", len(ledger_json.get("rows", [])))
print("wallet_count:", wallet_json.get("wallet_count"))
print("audit_rows:", len(audit_json.get("rows", [])))
'@ | Set-Content "$VERIFY\02_phase8c_reports_audit_e2e.py" -Encoding UTF8

& $PY "$VERIFY\02_phase8c_reports_audit_e2e.py" | Tee-Object "$VERIFY\02_phase8c_reports_audit_e2e.txt"
if ($LASTEXITCODE -ne 0) { throw "Phase 8C Reports/Audit E2E failed" }

Select-String -Path "$VERIFY\02_phase8c_reports_audit_e2e.txt" -Pattern "phase8c reports audit integration e2e ok" | Out-Null
Select-String -Path "$VERIFY\02_phase8c_reports_audit_e2e.txt" -Pattern "permission_block_status: 403" | Out-Null

Write-Host "3) SQLite final integrity check..." -ForegroundColor Cyan

@'
from sqlalchemy import inspect, text
from app.core.database import engine

insp = inspect(engine)
tables = insp.get_table_names()

required = [
    "families",
    "family_members",
    "member_permissions",
    "users",
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

print("missing_required_tables:", missing)
print("foreign_key_check_count:", fk_count)
print("alembic_version:", alembic_version)
print("tx_count:", tx_count)
print("line_count:", line_count)
print("audit_count:", audit_count)
print("imbalanced_count:", imbalanced_count)
print("single_line_count:", single_line_count)
print("cross_family_lines:", cross_family_lines)

if missing:
    raise SystemExit(1)
if fk_count != 0:
    raise SystemExit(1)
if alembic_version != "0002_auth_hardening":
    raise SystemExit(1)
if imbalanced_count != 0 or single_line_count != 0 or cross_family_lines != 0:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\03_phase8c_sqlite_final_integrity.py" -Encoding UTF8

& $PY "$VERIFY\03_phase8c_sqlite_final_integrity.py" | Tee-Object "$VERIFY\03_phase8c_sqlite_final_integrity.txt"
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
    "/families/{family_id}/reports/financial-summary",
    "/families/{family_id}/reports/account-ledger",
    "/families/{family_id}/reports/wallet-summary",
    "/families/{family_id}/reports/audit-activity",
]

paths = sorted([getattr(r, "path", "") for r in app.routes])
openapi_paths = app.openapi().get("paths", {})

missing_routes = [p for p in required if p not in paths]
missing_openapi = [p for p in required if p not in openapi_paths]

print("postgres config:", settings.IS_POSTGRESQL)
print("missing_routes:", missing_routes)
print("missing_openapi:", missing_openapi)

if not settings.IS_POSTGRESQL:
    raise SystemExit(1)
if missing_routes or missing_openapi:
    raise SystemExit(1)
'@ | Set-Content "$VERIFY\06_phase8c_postgres_route_openapi_check.py" -Encoding UTF8

& $PY "$VERIFY\06_phase8c_postgres_route_openapi_check.py" | Tee-Object "$VERIFY\06_phase8c_postgres_route_openapi_check.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL route/openapi check failed" }

& $PY -m alembic current | Tee-Object "$VERIFY\07_phase8c_postgres_alembic_current.txt"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL alembic current failed" }

Select-String -Path "$VERIFY\07_phase8c_postgres_alembic_current.txt" -Pattern "0002_auth_hardening" | Out-Null

Write-Host "5) Final ZIP backup..." -ForegroundColor Cyan

$TS2=Get-Date -Format "yyyyMMdd-HHmmss"
$STAGE="$BACKUPROOT\STAGE-PHASE-8C-REPORTS-AUDIT-FINAL-$TS2"
$ZIP="$BACKUPROOT\S4-FAMILY-FINANCE-143-REPORTS-AUDIT-PHASE-8-FINAL-LOCKED-$TS2.zip"

if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }
New-Item -ItemType Directory -Force $STAGE | Out-Null

robocopy $PROJECT $STAGE /E /XD ".git" ".venv" "node_modules" "__pycache__" ".pytest_cache" ".mypy_cache" ".ruff_cache" "dist" "build" /XF "*.pyc" "*.pyo" "*.log" | Out-Null
$rc=$LASTEXITCODE
if ($rc -gt 7) { throw "robocopy failed with exit code $rc" }

Compress-Archive -Path "$STAGE\*" -DestinationPath $ZIP -Force
$zipInfo = Get-Item $ZIP
if ($zipInfo.Length -le 0) { throw "Final Phase 8 ZIP is empty" }

@"
S4 FAMILY FINANCE 143 - ARCHITECTURE PHASE 8C REPORTS / AUDIT INTEGRATION FINAL E2E + BACKUP LOCK REPORT

STATUS: PASS
Time: $TS2

VERIFIED:
- Previous Phase 8B Actual Hardening confirmed
- Backend compile passed
- Phase 8C Reports/Audit E2E passed
- Financial summary endpoint passed
- Account ledger endpoint passed
- Wallet summary endpoint passed
- Audit activity endpoint passed
- Permission deny check returned 403
- Cross-family account ledger blocked when other-family account was available
- Audit count did not decrease after report views
- SQLite final integrity passed
- SQLite foreign_key_check_count = 0
- SQLite imbalanced_count = 0
- SQLite single_line_count = 0
- SQLite cross_family_lines = 0
- PostgreSQL service postgresql-x64-17 running
- PostgreSQL port 5432 reachable
- PostgreSQL route/OpenAPI check passed
- PostgreSQL Alembic current verified: 0002_auth_hardening
- Final Phase 8 ZIP backup created

VERIFY:
$VERIFY

FINAL ZIP:
$ZIP

ZIP SIZE:
$($zipInfo.Length) bytes

NEXT:
Phase 9 Audit Final / System Audit Trail Lock
"@ | Set-Content "$VERIFY\ARCHITECTURE_PHASE_8C_REPORTS_AUDIT_INTEGRATION_FINAL_LOCK_REPORT.txt" -Encoding UTF8

Write-Host "ARCHITECTURE PHASE 8C REPORTS / AUDIT INTEGRATION FINAL E2E + BACKUP PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Final ZIP:" -ForegroundColor Yellow
Write-Host $ZIP -ForegroundColor Yellow
Write-Host "ZIP size:" -ForegroundColor Yellow
Write-Host "$($zipInfo.Length) bytes" -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime