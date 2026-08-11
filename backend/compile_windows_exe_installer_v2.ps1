$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$FRONTEND="$PROJECT\frontend"
$DEPLOY="$PROJECT\deploy"
$INSTALLER="$DEPLOY\installer"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\WINDOWS_EXE_INSTALLER_COMPILE_V2_$TS"

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

$ISS="$INSTALLER\S4_FAMILY_FINANCE_143_InnoSetup.iss"

Write-Host "1) Find ISCC.exe anywhere..." -ForegroundColor Cyan

$searchRoots = @(
  "C:\Program Files",
  "C:\Program Files (x86)",
  "$env:LOCALAPPDATA\Programs",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
) | Where-Object { $_ -and (Test-Path $_) }

$ISCC = $null

foreach ($root in $searchRoots) {
  Write-Host "Searching: $root"
  $found = Get-ChildItem -Path $root -Recurse -Filter "ISCC.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($found) {
    $ISCC = $found.FullName
    break
  }
}

if (-not $ISCC) {
  $where = cmd /c "where ISCC.exe" 2>$null
  if ($where) {
    $ISCC = ($where -split "`r?`n" | Select-Object -First 1).Trim()
  }
}

if (-not $ISCC -or -not (Test-Path $ISCC)) {
  throw "ISCC.exe still not found. Close PowerShell, open new PowerShell, then run this script again."
}

Write-Host "ISCC FOUND:" $ISCC -ForegroundColor Green
"ISCC=$ISCC" | Set-Content "$VERIFY\01_iscc_found.txt" -Encoding UTF8

Write-Host "2) Check installer source files..." -ForegroundColor Cyan

$required = @(
  $ISS,
  "$FRONTEND\dist\index.html",
  "$DEPLOY\windows\01_install_backend_dependencies.bat",
  "$DEPLOY\windows\02_run_backend_local_sqlite.bat",
  "$DEPLOY\windows\04_run_frontend_preview.bat",
  "$BACKEND\.env.production.example",
  "$BACKEND\requirements-production.lock.txt"
)

$missing = @()
foreach ($p in $required) {
  if (-not (Test-Path $p)) { $missing += $p }
}

if ($missing.Count -gt 0) {
  $missing | Set-Content "$VERIFY\02_missing_installer_sources.txt" -Encoding UTF8
  Write-Host "Missing files:" -ForegroundColor Red
  $missing
  throw "Installer source files missing"
}

Write-Host "missing_installer_sources: []" -ForegroundColor Green

Write-Host "3) Rebuild frontend dist..." -ForegroundColor Cyan

Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\03_frontend_build_before_installer.txt"
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed before installer compile" }

if (-not (Test-Path "$FRONTEND\dist\index.html")) {
  throw "frontend dist/index.html missing"
}

Write-Host "4) Compile Inno Setup installer..." -ForegroundColor Cyan

Set-Location $INSTALLER

& $ISCC $ISS /O"$INSTALLER\Output" /F"S4-FAMILY-FINANCE-143-Setup" | Tee-Object "$VERIFY\04_inno_compile_output.txt"
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup installer compile failed"
}

Write-Host "5) Find compiled setup EXE..." -ForegroundColor Cyan

$exeCandidates = Get-ChildItem "$INSTALLER\Output" -File -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "S4-FAMILY-FINANCE-143-Setup*.exe" } |
  Sort-Object LastWriteTime -Descending

if (-not $exeCandidates -or $exeCandidates.Count -eq 0) {
  throw "Compiled setup EXE not found under deploy\installer\Output"
}

$EXE=$exeCandidates[0].FullName
$EXEINFO=Get-Item $EXE

if ($EXEINFO.Length -le 0) {
  throw "Compiled setup EXE size is zero"
}

$FINALCOPY="$BACKUPROOT\S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-$TS.exe"
Copy-Item $EXE $FINALCOPY -Force
$FINALINFO=Get-Item $FINALCOPY

@"
S4 FAMILY FINANCE 143 - WINDOWS EXE INSTALLER COMPILE REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Inno Setup ISCC.exe found
- Installer source .iss found
- Frontend production build passed
- Required installer source files exist
- Inno Setup compile passed
- Setup EXE created
- Final EXE copied to backup folder

VERIFY:
$VERIFY

ISCC:
$ISCC

SOURCE EXE:
$EXE

FINAL INSTALLER EXE:
$FINALCOPY

EXE SIZE:
$($FINALINFO.Length) bytes

NEXT:
Test installer on same PC, then test on another clean Windows PC.
"@ | Set-Content "$VERIFY\WINDOWS_EXE_INSTALLER_COMPILE_REPORT.txt" -Encoding UTF8

Write-Host "WINDOWS EXE INSTALLER COMPILE PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Installer EXE:" -ForegroundColor Yellow
Write-Host $FINALCOPY -ForegroundColor Yellow
Write-Host "EXE size:" -ForegroundColor Yellow
Write-Host "$($FINALINFO.Length) bytes" -ForegroundColor Yellow