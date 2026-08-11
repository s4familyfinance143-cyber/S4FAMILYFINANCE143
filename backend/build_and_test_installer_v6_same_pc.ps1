$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$INSTALLER="$PROJECT\deploy\installer"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\WINDOWS_INSTALLER_V6_SAME_PC_TEST_$TS"
$INSTALLDIR="$env:LOCALAPPDATA\S4-FAMILY-FINANCE-143-INSTALLER-TEST-V6"

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

Write-Host "1) Find latest clean V5 Inno script..." -ForegroundColor Cyan

$latestIss = Get-ChildItem $INSTALLER -File -Filter "S4_FAMILY_FINANCE_143_CLEAN_V5_*.iss" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latestIss) { throw "Clean V5 .iss not found" }

$V6ISS="$INSTALLER\S4_FAMILY_FINANCE_143_CLEAN_V6_$TS.iss"
$text=Get-Content $latestIss.FullName -Raw

# Make installer per-user, no admin/UAC for silent test.
$text = $text -replace 'DefaultDirName=\{autopf\}\\S4 FAMILY FINANCE 143', 'DefaultDirName={localappdata}\Programs\S4 FAMILY FINANCE 143'

if ($text -notmatch 'PrivilegesRequired=lowest') {
  $text = $text -replace 'UninstallDisplayName=S4 FAMILY FINANCE 143', "UninstallDisplayName=S4 FAMILY FINANCE 143`r`nPrivilegesRequired=lowest"
}

$text = $text -replace 'OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup-CLEAN-V5', 'OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup-CLEAN-V6'

Set-Content $V6ISS $text -Encoding UTF8

Write-Host "V6 ISS:" $V6ISS -ForegroundColor Green

Write-Host "2) Find ISCC.exe..." -ForegroundColor Cyan

$searchRoots = @(
  "C:\Program Files",
  "C:\Program Files (x86)",
  "$env:LOCALAPPDATA\Programs",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
) | Where-Object { $_ -and (Test-Path $_) }

$ISCC=$null
foreach ($root in $searchRoots) {
  $found = Get-ChildItem -Path $root -Recurse -Filter "ISCC.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($found) { $ISCC=$found.FullName; break }
}

if (-not $ISCC -or -not (Test-Path $ISCC)) { throw "ISCC.exe not found" }

Write-Host "ISCC FOUND:" $ISCC -ForegroundColor Green

Write-Host "3) Compile V6 per-user installer..." -ForegroundColor Cyan

$OUTPUT="$INSTALLER\OutputCleanV6"
New-Item -ItemType Directory -Force $OUTPUT | Out-Null

Set-Location $INSTALLER
& $ISCC $V6ISS /O"$OUTPUT" /F"S4-FAMILY-FINANCE-143-Setup-CLEAN-V6-$TS" | Tee-Object "$VERIFY\01_inno_v6_compile.txt"
if ($LASTEXITCODE -ne 0) { throw "V6 installer compile failed" }

$exe = Get-ChildItem $OUTPUT -File -Filter "S4-FAMILY-FINANCE-143-Setup-CLEAN-V6-*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $exe) { throw "V6 installer EXE not found" }

$FINALCOPY="$BACKUPROOT\S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V6-$TS.exe"
Copy-Item $exe.FullName $FINALCOPY -Force

Write-Host "V6 EXE:" $FINALCOPY -ForegroundColor Green

Write-Host "4) Silent install V6 to test folder..." -ForegroundColor Cyan

if (Test-Path $INSTALLDIR) {
  Remove-Item $INSTALLDIR -Recurse -Force
}

$installLog="$VERIFY\02_inno_silent_install.log"

$p = Start-Process -FilePath $FINALCOPY `
  -ArgumentList @("/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/DIR=$INSTALLDIR","/LOG=$installLog") `
  -Wait `
  -PassThru

Write-Host "Installer exit code:" $p.ExitCode -ForegroundColor Yellow

if ($p.ExitCode -ne 0) {
  Write-Host "INSTALL LOG TAIL:" -ForegroundColor Red
  if (Test-Path $installLog) {
    Get-Content $installLog -Tail 80
  }
  throw "V6 silent install failed"
}

Write-Host "5) Verify installed files..." -ForegroundColor Cyan

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
  $missing | Set-Content "$VERIFY\03_missing_files.txt" -Encoding UTF8
  throw "Installed required files missing"
}

Write-Host "missing_installed_files: []" -ForegroundColor Green

Write-Host "6) Verify no dirty/dev files installed..." -ForegroundColor Cyan

$bad=@()
$bad += Get-ChildItem $INSTALLDIR -Recurse -File -Include "phase*.ps1","fix*.ps1","patch*.ps1","*before*","*.db","*.sqlite","*.sqlite3","*.log" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -ne $installLog }

$bad += Get-ChildItem "$INSTALLDIR\backend" -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @("backups",".venv","__pycache__",".pytest_cache") }

if($bad.Count -gt 0){
  $bad | Select-Object FullName | Out-File "$VERIFY\04_dirty_files.txt" -Encoding UTF8
  throw "Dirty/dev files found in installed folder"
}

Write-Host "dirty_files_found: []" -ForegroundColor Green

@"
S4 FAMILY FINANCE 143 - WINDOWS INSTALLER V6 SAME PC TEST REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- V6 per-user installer compiled
- Silent install completed without admin/UAC issue
- Required installed files exist
- No dirty/dev/backup files installed

VERIFY:
$VERIFY

FINAL V6 INSTALLER EXE:
$FINALCOPY

INSTALL DIR:
$INSTALLDIR

EXE SIZE:
$((Get-Item $FINALCOPY).Length) bytes

NEXT:
Backend runtime smoke test from installed folder, then clean Windows PC test
"@ | Set-Content "$VERIFY\WINDOWS_INSTALLER_V6_SAME_PC_TEST_REPORT.txt" -Encoding UTF8

Write-Host "WINDOWS INSTALLER V6 SAME PC INSTALL TEST PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "V6 Installer EXE:" -ForegroundColor Yellow
Write-Host $FINALCOPY -ForegroundColor Yellow
Write-Host "Install dir:" -ForegroundColor Yellow
Write-Host $INSTALLDIR -ForegroundColor Yellow
Write-Host "EXE size:" -ForegroundColor Yellow
Write-Host "$((Get-Item $FINALCOPY).Length) bytes" -ForegroundColor Yellow