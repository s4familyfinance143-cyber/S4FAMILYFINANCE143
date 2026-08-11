$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$BACKEND="$PROJECT\backend"
$FRONTEND="$PROJECT\frontend"
$BACKUPROOT=($PROJECT -replace "-FINAL$","-FINAL-BACKUPS")

Write-Host "PROJECT:" $PROJECT -ForegroundColor Cyan
Write-Host "BACKEND:" $BACKEND -ForegroundColor Cyan
Write-Host "FRONTEND:" $FRONTEND -ForegroundColor Cyan
Write-Host "BACKUPROOT:" $BACKUPROOT -ForegroundColor Cyan

Write-Host "`n1) Required project files check..." -ForegroundColor Yellow

$required=@(
  "$BACKEND\app\main.py",
  "$BACKEND\app\core\config.py",
  "$BACKEND\requirements-production.lock.txt",
  "$BACKEND\.env.production.example",
  "$FRONTEND\package.json",
  "$FRONTEND\dist\index.html",
  "$PROJECT\deploy\windows\01_install_backend_dependencies.bat",
  "$PROJECT\deploy\windows\02_run_backend_local_sqlite.bat",
  "$PROJECT\deploy\windows\04_run_frontend_preview.bat"
)

$missing=@()
foreach($p in $required){
  if(-not (Test-Path $p)){ $missing += $p }
}

if($missing.Count -gt 0){
  Write-Host "Missing files:" -ForegroundColor Red
  $missing
} else {
  Write-Host "required_files_missing: []" -ForegroundColor Green
}

Write-Host "`n2) Latest clean installer EXE check..." -ForegroundColor Yellow

$exe=$null
if(Test-Path $BACKUPROOT){
  $exe=Get-ChildItem $BACKUPROOT -File -Filter "S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V6-*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if($exe){
  Write-Host "V6 Installer found:" $exe.FullName -ForegroundColor Green
  Write-Host "EXE size:" $exe.Length "bytes" -ForegroundColor Green
} else {
  Write-Host "V6 Installer EXE not found in backup folder." -ForegroundColor Red
}

Write-Host "`n3) Tools check..." -ForegroundColor Yellow

$py=Get-Command py -ErrorAction SilentlyContinue
if($py){ py --version } else { Write-Host "Python launcher py not found" -ForegroundColor Red }

$node=Get-Command node -ErrorAction SilentlyContinue
if($node){ node --version } else { Write-Host "Node.js not found" -ForegroundColor Red }

$npm=Get-Command npm -ErrorAction SilentlyContinue
if($npm){ npm --version } else { Write-Host "npm not found" -ForegroundColor Red }

$psql=Get-Command psql -ErrorAction SilentlyContinue
if($psql){ psql --version } else { Write-Host "PostgreSQL psql not found. Local SQLite test can still run." -ForegroundColor Yellow }

Write-Host "`nNEW PC ENVIRONMENT CHECK DONE" -ForegroundColor Green