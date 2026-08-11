$ErrorActionPreference="Stop"

$EXE="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS\S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V5-20260708-142414.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="S:\S4-FAMILY-FINANCE-143-FINAL\WINDOWS_INSTALLER_SAME_PC_TEST_$TS"
$INSTALLDIR="$env:LOCALAPPDATA\S4-FAMILY-FINANCE-143-INSTALLER-TEST"

New-Item -ItemType Directory -Force $VERIFY | Out-Null

Write-Host "1) Check installer EXE..." -ForegroundColor Cyan
if (-not (Test-Path $EXE)) { throw "Installer EXE not found: $EXE" }

$exeInfo=Get-Item $EXE
Write-Host "Installer EXE found:" $EXE -ForegroundColor Green
Write-Host "EXE size:" $exeInfo.Length "bytes" -ForegroundColor Green

Write-Host "2) Clean old test install folder..." -ForegroundColor Cyan
if (Test-Path $INSTALLDIR) {
  Remove-Item $INSTALLDIR -Recurse -Force
}
New-Item -ItemType Directory -Force $INSTALLDIR | Out-Null

Write-Host "3) Silent install to test folder..." -ForegroundColor Cyan

& $EXE /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="$INSTALLDIR" /LOG="$VERIFY\01_inno_install.log"
if ($LASTEXITCODE -ne 0) { throw "Installer silent install failed" }

Write-Host "4) Check installed files..." -ForegroundColor Cyan

$required=@(
  "$INSTALLDIR\backend\app\main.py",
  "$INSTALLDIR\backend\app\core\config.py",
  "$INSTALLDIR\backend\requirements-production.lock.txt",
  "$INSTALLDIR\backend\.env.production.example",
  "$INSTALLDIR\frontend\dist\index.html",
  "$INSTALLDIR\deploy\windows\01_install_backend_dependencies.bat",
  "$INSTALLDIR\deploy\windows\02_run_backend_local_sqlite.bat",
  "$INSTALLDIR\deploy\windows\04_run_frontend_preview.bat"
)

$missing=@()
foreach($p in $required){
  if(-not (Test-Path $p)){ $missing += $p }
}

$missing | Set-Content "$VERIFY\02_missing_installed_files.txt" -Encoding UTF8

if($missing.Count -gt 0){
  Write-Host "Missing installed files:" -ForegroundColor Red
  $missing
  throw "Installed required files missing"
}

Write-Host "missing_installed_files: []" -ForegroundColor Green

Write-Host "5) Check clean install folder has no dirty files..." -ForegroundColor Cyan

$bad=@()
$bad += Get-ChildItem $INSTALLDIR -Recurse -File -Include "phase*.ps1","fix*.ps1","patch*.ps1","*before*","*.db","*.sqlite","*.sqlite3","*.log" -ErrorAction SilentlyContinue
$bad += Get-ChildItem "$INSTALLDIR\backend" -Recurse -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @("backups",".venv","__pycache__",".pytest_cache") }

if($bad.Count -gt 0){
  $bad | Select-Object FullName | Out-File "$VERIFY\03_dirty_files_found.txt" -Encoding UTF8
  Write-Host "Dirty files found:" -ForegroundColor Red
  $bad | Select-Object FullName
  throw "Dirty/dev/backup files found in installed folder"
}

"dirty_files_found: []" | Set-Content "$VERIFY\03_dirty_files_found.txt" -Encoding UTF8
Write-Host "dirty_files_found: []" -ForegroundColor Green

Write-Host "6) Create installed backend venv + install dependencies..." -ForegroundColor Cyan

Set-Location "$INSTALLDIR\backend"

$pyCmd = Get-Command py -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  throw "Python launcher 'py' not found. Install Python first."
}

py -3 -m venv .venv
if ($LASTEXITCODE -ne 0) { throw "venv create failed" }

$PY="$INSTALLDIR\backend\.venv\Scripts\python.exe"
if (-not (Test-Path $PY)) { throw "Installed test venv python not found" }

& $PY -m pip install --upgrade pip | Tee-Object "$VERIFY\04_pip_upgrade.txt"
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

& $PY -m pip install -r "$INSTALLDIR\backend\requirements-production.lock.txt" | Tee-Object "$VERIFY\05_pip_install.txt"
if ($LASTEXITCODE -ne 0) { throw "dependency install failed" }

Write-Host "7) Backend compile test..." -ForegroundColor Cyan

& $PY -m compileall "$INSTALLDIR\backend\app" -q
if ($LASTEXITCODE -ne 0) { throw "installed backend compile failed" }

"installed_backend_compile: PASS" | Set-Content "$VERIFY\06_backend_compile_PASS.txt" -Encoding UTF8

Write-Host "8) Start installed backend smoke test..." -ForegroundColor Cyan

$env:PYTHONPATH="$INSTALLDIR\backend"
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

$backendLog="$VERIFY\07_backend_runtime.log"

$backendProc = Start-Process -FilePath $PY `
  -ArgumentList @("-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8010") `
  -WorkingDirectory "$INSTALLDIR\backend" `
  -RedirectStandardOutput $backendLog `
  -RedirectStandardError "$VERIFY\07_backend_runtime_error.log" `
  -PassThru

Start-Sleep -Seconds 8

try {
  $root = Invoke-WebRequest "http://127.0.0.1:8010/" -UseBasicParsing -TimeoutSec 10
  Write-Host "backend_root_status:" $root.StatusCode -ForegroundColor Green
  "backend_root_status: $($root.StatusCode)" | Set-Content "$VERIFY\08_backend_root_status.txt" -Encoding UTF8
} finally {
  if ($backendProc -and -not $backendProc.HasExited) {
    Stop-Process -Id $backendProc.Id -Force
  }
}

if ($root.StatusCode -ne 200) { throw "installed backend root smoke test failed" }

Write-Host "9) Frontend static smoke test..." -ForegroundColor Cyan

$frontendLog="$VERIFY\09_frontend_static_server.log"

$frontProc = Start-Process -FilePath $PY `
  -ArgumentList @("-m","http.server","4174","-d","$INSTALLDIR\frontend\dist") `
  -WorkingDirectory "$INSTALLDIR\frontend\dist" `
  -RedirectStandardOutput $frontendLog `
  -RedirectStandardError "$VERIFY\09_frontend_static_server_error.log" `
  -PassThru

Start-Sleep -Seconds 3

try {
  $front = Invoke-WebRequest "http://127.0.0.1:4174/" -UseBasicParsing -TimeoutSec 10
  Write-Host "frontend_status:" $front.StatusCode -ForegroundColor Green
  "frontend_status: $($front.StatusCode)" | Set-Content "$VERIFY\10_frontend_status.txt" -Encoding UTF8
} finally {
  if ($frontProc -and -not $frontProc.HasExited) {
    Stop-Process -Id $frontProc.Id -Force
  }
}

if ($front.StatusCode -ne 200) { throw "installed frontend smoke test failed" }

@"
S4 FAMILY FINANCE 143 - WINDOWS INSTALLER SAME PC TEST REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Installer EXE exists
- Silent install completed
- Required installed files exist
- No dirty/dev/backup files found
- Installed backend venv created
- Dependencies installed
- Installed backend compile passed
- Installed backend runtime root test passed
- Installed frontend static test passed

INSTALLER EXE:
$EXE

INSTALL DIR:
$INSTALLDIR

VERIFY:
$VERIFY

NEXT:
Clean Windows PC test
"@ | Set-Content "$VERIFY\WINDOWS_INSTALLER_SAME_PC_TEST_REPORT.txt" -Encoding UTF8

Write-Host "WINDOWS INSTALLER SAME PC TEST PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Install dir:" -ForegroundColor Yellow
Write-Host $INSTALLDIR -ForegroundColor Yellow