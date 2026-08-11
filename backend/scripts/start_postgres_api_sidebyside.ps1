# Start S4 Family Finance API on :8001 against local Docker Postgres (:5433).
# Does NOT replace the live sqlite API on :8000.
# Prerequisites: Docker Desktop + deploy/postgres compose + alembic already applied
#   (run scripts/postgres_cutover_smoke.py first).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DeployCompose = Join-Path (Split-Path -Parent $Root) "deploy\postgres\docker-compose.yml"
$EnvFile = Join-Path $Root ".env.postgresql.local.cutover"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$Port = 8001

if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }
if (-not (Test-Path $VenvPython)) { throw "Missing venv python: $VenvPython" }

Write-Host "Ensuring Docker Postgres is up (port 5433)..."
docker compose -f $DeployCompose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

# Load cutover env into process (simple KEY=VALUE parser; skips comments/blank)
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $key = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  Set-Item -Path "Env:$key" -Value $value
}

Write-Host "DATABASE_URL engine check (redacted host/db only)..."
if ($env:DATABASE_URL -notmatch "postgresql") { throw "DATABASE_URL is not postgresql" }
Write-Host "Starting uvicorn on http://127.0.0.1:$Port (Postgres) ..."
Write-Host "Health: http://127.0.0.1:$Port/health  (expect database=postgresql)"
Write-Host "Verify: .\.venv\Scripts\python.exe scripts\postgres_api_verify_smoke.py"
Write-Host "NOTE: Leave :8000 sqlite running until you explicitly switch clients."

Set-Location $Root
& $VenvPython -m uvicorn app.main:app --host 127.0.0.1 --port $Port
