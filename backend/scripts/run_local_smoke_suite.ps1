# Run local automated checks against the current workspace.
# Unit/guard tests do not need a live server.
# Optional live smokes require API on :8000.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { throw "Missing venv python: $Py" }

Write-Host "== pip install requirements-dev =="
& $Py -m pip install -q -r (Join-Path $Root "requirements-dev.txt")

Write-Host "== pytest =="
& $Py -m pytest
if ($LASTEXITCODE -ne 0) { throw "pytest failed" }

Write-Host "== packaging validate =="
$pack = Join-Path (Split-Path -Parent $Root) "deploy\scripts\validate_production_packaging.ps1"
if (Test-Path $pack) {
  powershell -ExecutionPolicy Bypass -File $pack
  if ($LASTEXITCODE -ne 0) { throw "packaging validate failed" }
}

$live = $false
try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3
  if ($health.StatusCode -eq 200) { $live = $true }
} catch {
  Write-Host "SKIP live smokes (API :8000 not up)"
}

if ($live) {
  Write-Host "== live smokes =="
  $smokes = @(
    "scripts\smtp_email_smoke.py",
    "scripts\fcm_push_smoke.py",
    "scripts\object_storage_smoke.py"
  )
  foreach ($rel in $smokes) {
    Write-Host "-- $rel"
    & $Py $rel
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed: $rel" }
  }
}

Write-Host "PASS run_local_smoke_suite"
