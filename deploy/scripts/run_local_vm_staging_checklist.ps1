# Validates what you can run locally / on a VM for remaining staging work.
# Does not require a paid VPS. Does not flip live API database.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "deploy\docker\docker-compose.production.yml"))) {
    $Root = "S:\S4-FAMILY-FINANCE-143-FINAL"
}

Write-Host "=== S4 local/VM staging checklist ==="
Write-Host "Root: $Root"

function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

$fail = 0

# Docker
try {
    $dv = docker version --format '{{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $dv) {
        Ok "Docker engine $dv"
    } else {
        Warn "Docker engine not reachable (start Docker Desktop or install on VM) - not a hard fail"
    }
} catch {
    Warn "Docker not installed / not in PATH - not a hard fail"
}

try {
    docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Ok "docker compose available"
    } else {
        Warn "docker compose missing"
        $fail++
    }
} catch {
    Warn "docker compose missing"
    $fail++
}

# Packaging files
$needed = @(
    "deploy\docker\docker-compose.production.yml",
    "deploy\docker\.env.production.example",
    "deploy\README_LOCAL_VM_STAGING.md",
    "deploy\README_PRODUCTION_DEPLOYMENT.md",
    "deploy\postgres\docker-compose.yml"
)
foreach ($rel in $needed) {
    $p = Join-Path $Root $rel
    if (Test-Path $p) {
        Ok $rel
    } else {
        Fail "missing $rel"
        $fail++
    }
}

# Optional: packaging validate
$pack = Join-Path $Root "deploy\scripts\validate_production_packaging.ps1"
if (Test-Path $pack) {
    Write-Host "--- running validate_production_packaging.ps1 ---"
    & powershell -ExecutionPolicy Bypass -File $pack
    if ($LASTEXITCODE -eq 0) {
        Ok "production packaging validate PASS"
    } else {
        Warn "packaging validate reported issues"
        $fail++
    }
}

# Live API health (informational)
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5
    Ok ("live :8000 health database=" + $h.database)
    if ($h.database -eq "sqlite") {
        Warn "Live API is SQLite (expected for daily login). Use VM/Docker staging or :8001 for Postgres drills."
    }
} catch {
    Warn "live :8000 not responding (start backend if you need it)"
}

# Postgres cutover container
try {
    $names = docker ps --format '{{.Names}}' 2>$null
    if ($names -match 's4-family-finance-postgres') {
        Ok "Postgres cutover container running (port 5433)"
    } else {
        Warn "Postgres cutover container not running - optional: cd deploy\postgres; docker compose up -d"
    }
} catch {
    Warn "Could not query docker ps for postgres container"
}

Write-Host ""
if ($fail -gt 0) {
    Write-Host "Checklist finished with $fail warning/fail item(s). See deploy/README_LOCAL_VM_STAGING.md" -ForegroundColor Yellow
    exit 1
}
Write-Host "Checklist PASS - you can continue remaining ops on local Docker or a Ubuntu VM." -ForegroundColor Green
exit 0
