# One-command local setup — S4 Family Finance 143
# Run from project root:  .\setup_local.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Py = Join-Path $Backend ".venv\Scripts\python.exe"
$LogDir = Join-Path $Root "deploy\dist"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step($msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

Write-Step "1/7 Ensure backend .env"
$BackendEnv = Join-Path $Backend ".env"
if (-not (Test-Path $BackendEnv)) {
  Copy-Item (Join-Path $Backend ".env.sqlite.development.example") $BackendEnv
  Write-Host "Created backend/.env"
} else {
  Write-Host "backend/.env exists"
}

Write-Step "2/7 Ensure frontend .env"
$FrontendEnv = Join-Path $Frontend ".env"
if (-not (Test-Path $FrontendEnv)) {
  Copy-Item (Join-Path $Frontend ".env.example") $FrontendEnv
  Add-Content $FrontendEnv "`nVITE_API_BASE=http://127.0.0.1:8000`n"
  Write-Host "Created frontend/.env"
} else {
  Write-Host "frontend/.env exists"
}

Write-Step "3/7 Python venv + dependencies"
if (-not (Test-Path $Py)) {
  py -3.11 -m venv (Join-Path $Backend ".venv") 2>$null
  if (-not (Test-Path $Py)) { py -3 -m venv (Join-Path $Backend ".venv") }
}
& $Py -m pip install -q -r (Join-Path $Backend "requirements.txt")

Write-Step "4/7 Frontend npm install + build + icons"
Push-Location $Frontend
npm install --silent 2>$null
npm run generate:icons 2>$null
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
cmd /c "npm run build > `"$(Join-Path $LogDir 'frontend_build.log')`" 2>&1"
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($buildExit -ne 0) { Get-Content (Join-Path $LogDir "frontend_build.log"); throw "Frontend build failed" }
Pop-Location

Write-Step "5/7 Start backend (if not running)"
$healthOk = $false
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3
  if ($r.StatusCode -eq 200) { $healthOk = $true }
} catch { }

$backendJob = $null
if (-not $healthOk) {
  $backendJob = Start-Process -FilePath $Py -ArgumentList @(
    "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"
  ) -WorkingDirectory $Backend -PassThru -WindowStyle Hidden
  Write-Host "Backend starting (PID $($backendJob.Id))..."
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { $healthOk = $true; break }
    } catch { }
  }
}
if (-not $healthOk) { throw "Backend did not become healthy on :8000" }
Write-Host "Backend OK: http://127.0.0.1:8000" -ForegroundColor Green

Write-Step "6/7 Bootstrap demo owner account"
& $Py (Join-Path $Backend "scripts\bootstrap_owner_on_postgres.py") 2>&1 | Tee-Object (Join-Path $LogDir "bootstrap.log")
if ($LASTEXITCODE -ne 0) { Write-Host "Bootstrap warning (may already exist)" -ForegroundColor Yellow }

Write-Step "7/7 Package release zip"
& (Join-Path $Root "deploy\scripts\package_release.ps1")

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "SETUP COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Login:  owner@s4family.com / S4Family143!"
Write-Host "API:    http://127.0.0.1:8000"
Write-Host "App:    cd frontend && npm run dev  -> http://127.0.0.1:5173"
Write-Host ""
Write-Host "YOU STILL NEED (manual - Google account):" -ForegroundColor Yellow
Write-Host "  - Firebase keys in frontend/.env  (deploy/FIREBASE_SETUP.md)"
Write-Host "  - VITE_GOOGLE_CLIENT_ID           (deploy/GOOGLE_DRIVE_SETUP.md)"
Write-Host "  - Docker for Redis/Mailpit        (deploy/LOCAL_REDIS_CELERY.md)"
Write-Host "  - Inno Setup for Windows .exe     (deploy/WINDOWS_DESKTOP.md)"
Write-Host ""

if ($backendJob) {
  Write-Host "Backend left running in background (PID $($backendJob.Id))." -ForegroundColor DarkGray
}
