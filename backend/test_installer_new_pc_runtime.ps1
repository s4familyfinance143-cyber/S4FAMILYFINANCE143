$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$BACKEND="$PROJECT\backend"
$BACKUPROOT=($PROJECT -replace "-FINAL$","-FINAL-BACKUPS")
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\WINDOWS_INSTALLER_NEW_PC_RUNTIME_TEST_$TS"
$INSTALLDIR="$env:LOCALAPPDATA\S4-FAMILY-FINANCE-143-NEW-PC-TEST"

New-Item -ItemType Directory -Force $VERIFY | Out-Null

Write-Host "1) Find latest V6 installer EXE..." -ForegroundColor Cyan

$EXE=Get-ChildItem $BACKUPROOT -File -Filter "S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V6-*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $EXE){ throw "V6 installer EXE not found in $BACKUPROOT" }

Write-Host "Installer EXE:" $EXE.FullName -ForegroundColor Green
Write-Host "EXE size:" $EXE.Length "bytes" -ForegroundColor Green

Write-Host "2) Silent install to New PC test folder..." -ForegroundColor Cyan

if(Test-Path $INSTALLDIR){
  Remove-Item $INSTALLDIR -Recurse -Force
}

$installLog="$VERIFY\01_inno_install.log"

$p=Start-Process -FilePath $EXE.FullName `
  -ArgumentList @("/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/DIR=$INSTALLDIR","/LOG=$installLog") `
  -Wait `
  -PassThru

Write-Host "Installer exit code:" $p.ExitCode -ForegroundColor Yellow

if($p.ExitCode -ne 0){
  if(Test-Path $installLog){ Get-Content $installLog -Tail 80 }
  throw "Installer silent install failed"
}

Write-Host "3) Check installed files..." -ForegroundColor Cyan

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
foreach($r in $required){
  if(-not (Test-Path $r)){ $missing += $r }
}

if($missing.Count -gt 0){
  $missing | Set-Content "$VERIFY\02_missing_files.txt" -Encoding UTF8
  throw "Installed required files missing"
}

Write-Host "missing_installed_files: []" -ForegroundColor Green

Write-Host "4) Dirty/dev files check..." -ForegroundColor Cyan

$bad=@()
$bad += Get-ChildItem $INSTALLDIR -Recurse -File -Include "phase*.ps1","fix*.ps1","patch*.ps1","*before*","*.db","*.sqlite","*.sqlite3","*.log" -ErrorAction SilentlyContinue
$bad += Get-ChildItem "$INSTALLDIR\backend" -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @("backups",".venv","__pycache__",".pytest_cache") }

if($bad.Count -gt 0){
  $bad | Select-Object FullName | Out-File "$VERIFY\03_dirty_files.txt" -Encoding UTF8
  throw "Dirty/dev/backup files found"
}

Write-Host "dirty_files_found: []" -ForegroundColor Green

Write-Host "5) Create installed backend venv..." -ForegroundColor Cyan

Set-Location "$INSTALLDIR\backend"

py -3 -m venv .venv
if($LASTEXITCODE -ne 0){ throw "venv create failed" }

$PY="$INSTALLDIR\backend\.venv\Scripts\python.exe"
if(-not (Test-Path $PY)){ throw "venv python not found" }

Write-Host "6) Install backend dependencies..." -ForegroundColor Cyan

& $PY -m pip install --upgrade pip | Tee-Object "$VERIFY\04_pip_upgrade.txt"
if($LASTEXITCODE -ne 0){ throw "pip upgrade failed" }

& $PY -m pip install -r "$INSTALLDIR\backend\requirements-production.lock.txt" | Tee-Object "$VERIFY\05_pip_install.txt"
if($LASTEXITCODE -ne 0){ throw "dependency install failed" }

Write-Host "7) Backend compile test..." -ForegroundColor Cyan

& $PY -m compileall "$INSTALLDIR\backend\app" -q
if($LASTEXITCODE -ne 0){ throw "installed backend compile failed" }

Write-Host "installed_backend_compile: PASS" -ForegroundColor Green

Write-Host "8) Backend runtime smoke test..." -ForegroundColor Cyan

$env:PYTHONPATH="$INSTALLDIR\backend"
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

$backendProc=Start-Process -FilePath $PY `
  -ArgumentList @("-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8011") `
  -WorkingDirectory "$INSTALLDIR\backend" `
  -RedirectStandardOutput "$VERIFY\06_backend_runtime.log" `
  -RedirectStandardError "$VERIFY\06_backend_runtime_error.log" `
  -PassThru

Start-Sleep -Seconds 10

try{
  $root=Invoke-WebRequest "http://127.0.0.1:8011/" -UseBasicParsing -TimeoutSec 15
  Write-Host "backend_root_status:" $root.StatusCode -ForegroundColor Green
} finally {
  if($backendProc -and -not $backendProc.HasExited){
    Stop-Process -Id $backendProc.Id -Force
  }
}

if($root.StatusCode -ne 200){ throw "backend runtime smoke failed" }

Write-Host "9) Frontend static runtime smoke test..." -ForegroundColor Cyan

$frontProc=Start-Process -FilePath $PY `
  -ArgumentList @("-m","http.server","4175","-d","$INSTALLDIR\frontend\dist") `
  -WorkingDirectory "$INSTALLDIR\frontend\dist" `
  -RedirectStandardOutput "$VERIFY\07_frontend_static.log" `
  -RedirectStandardError "$VERIFY\07_frontend_static_error.log" `
  -PassThru

Start-Sleep -Seconds 3

try{
  $front=Invoke-WebRequest "http://127.0.0.1:4175/" -UseBasicParsing -TimeoutSec 15
  Write-Host "frontend_status:" $front.StatusCode -ForegroundColor Green
} finally {
  if($frontProc -and -not $frontProc.HasExited){
    Stop-Process -Id $frontProc.Id -Force
  }
}

if($front.StatusCode -ne 200){ throw "frontend runtime smoke failed" }

@"
S4 FAMILY FINANCE 143 - WINDOWS INSTALLER NEW PC RUNTIME TEST REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- New PC environment usable
- V6 installer EXE found
- Silent install passed
- Required installed files exist
- Dirty/dev/backup files not installed
- Installed backend venv created
- Dependencies installed
- Backend compile passed
- Backend runtime root test passed
- Frontend static runtime test passed

INSTALLER EXE:
$($EXE.FullName)

INSTALL DIR:
$INSTALLDIR

VERIFY:
$VERIFY

NEXT:
Clean Windows PC final test lock
"@ | Set-Content "$VERIFY\WINDOWS_INSTALLER_NEW_PC_RUNTIME_TEST_REPORT.txt" -Encoding UTF8

Write-Host "WINDOWS INSTALLER NEW PC RUNTIME TEST PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Install dir:" -ForegroundColor Yellow
Write-Host $INSTALLDIR -ForegroundColor Yellow