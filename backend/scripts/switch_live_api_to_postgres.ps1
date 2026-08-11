# Switch live S4 API (:8000) from SQLite to local Docker Postgres (:5433).
# - Backs up sqlite DB + .env first
# - Does NOT migrate sqlite rows into Postgres (fresh/cutover DB)
# - Keeps sqlite file so you can roll back

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root "storage\live_switch_backups\$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$Sqlite = Join-Path $Root "s4_family_finance_dev.db"
$EnvFile = Join-Path $Root ".env"
$Cutover = Join-Path $Root ".env.postgresql.local.cutover"

if (-not (Test-Path $Cutover)) { throw "Missing $Cutover" }
if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }

Write-Host "Backup dir: $BackupDir"
if (Test-Path $Sqlite) {
  Copy-Item $Sqlite (Join-Path $BackupDir "s4_family_finance_dev.db")
  Write-Host "OK sqlite backup"
}
Copy-Item $EnvFile (Join-Path $BackupDir ".env")
Write-Host "OK .env backup"

# Ensure Postgres is up
$Compose = Join-Path (Split-Path -Parent $Root) "deploy\postgres\docker-compose.yml"
docker compose -f $Compose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

# Load cutover DATABASE_URL (and related DB flags) into process, then patch .env
$cutoverMap = @{}
Get-Content $Cutover | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $key = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  $cutoverMap[$key] = $value
}

if (-not $cutoverMap.ContainsKey("DATABASE_URL") -or $cutoverMap["DATABASE_URL"] -notmatch "postgresql") {
  throw "Cutover DATABASE_URL missing/invalid"
}

$lines = Get-Content $EnvFile
$out = New-Object System.Collections.Generic.List[string]
$seenDb = $false
$seenAuto = $false
$seenEcho = $false
foreach ($line in $lines) {
  if ($line -match '^\s*DATABASE_URL\s*=') {
    $out.Add("DATABASE_URL=`"$($cutoverMap['DATABASE_URL'])`"")
    $seenDb = $true
    continue
  }
  if ($line -match '^\s*AUTO_CREATE_TABLES\s*=') {
    $out.Add("AUTO_CREATE_TABLES=false")
    $seenAuto = $true
    continue
  }
  if ($line -match '^\s*ENVIRONMENT\s*=') {
    $out.Add('ENVIRONMENT="development"')
    continue
  }
  $out.Add($line)
}
if (-not $seenDb) { $out.Insert(0, "DATABASE_URL=`"$($cutoverMap['DATABASE_URL'])`"") }
if (-not $seenAuto) { $out.Add("AUTO_CREATE_TABLES=false") }

# Ensure CORS includes preview + expo if missing
$joined = ($out -join "`n")
if ($joined -notmatch "4173") {
  $out.Add('CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173","http://localhost:4173","http://127.0.0.1:4173","http://localhost:8081","http://127.0.0.1:8081"]')
}

Set-Content -Path $EnvFile -Value ($out -join "`r`n") -Encoding utf8
Write-Host "OK .env pointed at Postgres (AUTO_CREATE_TABLES=false)"

$Py = Join-Path $Root ".venv\Scripts\python.exe"
$env:DATABASE_URL = $cutoverMap["DATABASE_URL"]
& $Py -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed" }
Write-Host "OK alembic upgrade head"

# Restart uvicorn on :8000
$pids = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { $_.OwningProcess } | Sort-Object -Unique
foreach ($procId in $pids) {
  try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Seconds 2
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:AUTO_CREATE_TABLES -ErrorAction SilentlyContinue
Start-Process -FilePath $Py -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 8

$health = (Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 10).Content
Write-Host "HEALTH $health"
if ($health -notmatch 'postgresql') {
  throw "Live API did not report database=postgresql"
}

Write-Host "PASS live_switch_to_postgres"
Write-Host "NOTE: SQLite data remains in backup: $BackupDir"
Write-Host "NOTE: Postgres DB is the cutover DB (not an automatic sqlite row migrate)."
Write-Host "Rollback: copy backup .env + sqlite back, restart uvicorn."
