$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$FRONTEND="$PROJECT\frontend"
$DEPLOY="$PROJECT\deploy"
$INSTALLER="$DEPLOY\installer"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\WINDOWS_EXE_INSTALLER_CLEAN_COMPILE_V3_$TS"
$STAGE="$BACKUPROOT\STAGE-WINDOWS-INSTALLER-CLEAN-$TS"

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null
New-Item -ItemType Directory -Force $INSTALLER | Out-Null

Write-Host "1) Find ISCC.exe..." -ForegroundColor Cyan

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

  if ($found) {
    $ISCC=$found.FullName
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
  throw "ISCC.exe not found. Close PowerShell, open new PowerShell, then run again."
}

Write-Host "ISCC FOUND: $ISCC" -ForegroundColor Green
"ISCC=$ISCC" | Set-Content "$VERIFY\01_iscc_found.txt" -Encoding UTF8

Write-Host "2) Rebuild frontend dist..." -ForegroundColor Cyan

Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\02_frontend_build.txt"
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

if (-not (Test-Path "$FRONTEND\dist\index.html")) {
  throw "frontend dist/index.html missing"
}

Write-Host "3) Create clean installer stage..." -ForegroundColor Cyan

if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }

New-Item -ItemType Directory -Force "$STAGE\backend" | Out-Null
New-Item -ItemType Directory -Force "$STAGE\frontend\dist" | Out-Null
New-Item -ItemType Directory -Force "$STAGE\deploy\windows" | Out-Null

# Clean backend only
Copy-Item "$BACKEND\app" "$STAGE\backend\app" -Recurse -Force
Copy-Item "$BACKEND\alembic" "$STAGE\backend\alembic" -Recurse -Force
Copy-Item "$BACKEND\alembic.ini" "$STAGE\backend\alembic.ini" -Force

if (Test-Path "$BACKEND\requirements.txt") {
  Copy-Item "$BACKEND\requirements.txt" "$STAGE\backend\requirements.txt" -Force
}
if (Test-Path "$BACKEND\requirements-production.lock.txt") {
  Copy-Item "$BACKEND\requirements-production.lock.txt" "$STAGE\backend\requirements-production.lock.txt" -Force
}
if (Test-Path "$BACKEND\.env.production.example") {
  Copy-Item "$BACKEND\.env.production.example" "$STAGE\backend\.env.production.example" -Force
}

# Frontend dist only
Copy-Item "$FRONTEND\dist\*" "$STAGE\frontend\dist" -Recurse -Force

# Windows run scripts only
Copy-Item "$DEPLOY\windows\*" "$STAGE\deploy\windows" -Recurse -Force

Write-Host "4) Verify clean stage has no dev/backup files..." -ForegroundColor Cyan

$badPatterns = @(
  "phase*.ps1",
  "fix*.ps1",
  "patch*.ps1",
  "*before-*",
  "*.db",
  "*.sqlite",
  "*.sqlite3",
  "*.log"
)

$bad = @()

foreach ($pat in $badPatterns) {
  $bad += Get-ChildItem $STAGE -Recurse -File -Filter $pat -ErrorAction SilentlyContinue
}

$bad += Get-ChildItem "$STAGE\backend" -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @("backups",".venv","__pycache__",".pytest_cache") }

if ($bad.Count -gt 0) {
  $bad | Select-Object FullName | Out-File "$VERIFY\03_bad_files_found.txt" -Encoding UTF8
  Write-Host "BAD FILES FOUND:" -ForegroundColor Red
  $bad | Select-Object FullName
  throw "Clean installer stage contains dev/backup files"
}

"bad_files_found: []" | Set-Content "$VERIFY\03_bad_files_found.txt" -Encoding UTF8
Write-Host "bad_files_found: []" -ForegroundColor Green

Write-Host "5) Create clean Inno Setup script..." -ForegroundColor Cyan

$CLEAN_ISS="$INSTALLER\S4_FAMILY_FINANCE_143_CLEAN_InnoSetup_$TS.iss"
$OUTPUT="$INSTALLER\OutputClean"

New-Item -ItemType Directory -Force $OUTPUT | Out-Null

@"
#define MyAppName "S4 FAMILY FINANCE 143"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "S4"
#define StageDir "$STAGE"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\S4 FAMILY FINANCE 143
DefaultGroupName=S4 FAMILY FINANCE 143
OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup-CLEAN
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=S4 FAMILY FINANCE 143

[Files]
Source: "{#StageDir}\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: recursesubdirs ignoreversion
Source: "{#StageDir}\deploy\windows\*"; DestDir: "{app}\deploy\windows"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Run Backend Local SQLite"; Filename: "{app}\deploy\windows\02_run_backend_local_sqlite.bat"
Name: "{group}\Run Frontend Preview"; Filename: "{app}\deploy\windows\04_run_frontend_preview.bat"
Name: "{group}\Production Env Example"; Filename: "{app}\backend\.env.production.example"

[Run]
Filename: "{app}\deploy\windows\01_install_backend_dependencies.bat"; Description: "Install backend dependencies"; Flags: postinstall skipifsilent
"@ | Set-Content $CLEAN_ISS -Encoding UTF8

Write-Host "6) Compile clean installer..." -ForegroundColor Cyan

Set-Location $INSTALLER

& $ISCC $CLEAN_ISS /O"$OUTPUT" /F"S4-FAMILY-FINANCE-143-Setup-CLEAN-$TS" | Tee-Object "$VERIFY\04_inno_clean_compile_output.txt"
if ($LASTEXITCODE -ne 0) {
  throw "Clean Inno Setup installer compile failed"
}

Write-Host "7) Find clean compiled EXE..." -ForegroundColor Cyan

$exeCandidates = Get-ChildItem $OUTPUT -File -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "S4-FAMILY-FINANCE-143-Setup-CLEAN*.exe" } |
  Sort-Object LastWriteTime -Descending

if (-not $exeCandidates -or $exeCandidates.Count -eq 0) {
  throw "Clean compiled setup EXE not found"
}

$EXE=$exeCandidates[0].FullName
$EXEINFO=Get-Item $EXE

if ($EXEINFO.Length -le 0) {
  throw "Clean compiled setup EXE size is zero"
}

Write-Host "8) Check compile output did not include dirty files..." -ForegroundColor Cyan

$compileText = Get-Content "$VERIFY\04_inno_clean_compile_output.txt" -Raw

$dirtyWords = @(
  "phase7c",
  "phase8",
  "phase9",
  "phase10",
  "fix_config",
  "patch_final",
  "final_release_qa_lock",
  "backups\auto",
  "s4_backup_"
)

$dirtyFound = @()
foreach ($w in $dirtyWords) {
  if ($compileText -like "*$w*") { $dirtyFound += $w }
}

if ($dirtyFound.Count -gt 0) {
  $dirtyFound | Set-Content "$VERIFY\05_dirty_words_in_compile_output.txt" -Encoding UTF8
  throw "Clean compile output still contains dirty files/words"
}

"dirty_words_in_compile_output: []" | Set-Content "$VERIFY\05_dirty_words_in_compile_output.txt" -Encoding UTF8

$FINALCOPY="$BACKUPROOT\S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-$TS.exe"
Copy-Item $EXE $FINALCOPY -Force
$FINALINFO=Get-Item $FINALCOPY

@"
S4 FAMILY FINANCE 143 - WINDOWS CLEAN EXE INSTALLER COMPILE REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Inno Setup ISCC.exe found
- Frontend production build passed
- Clean installer stage created
- Clean stage contains no dev/backup scripts
- Clean Inno Setup script created
- Clean Inno Setup compile passed
- Clean setup EXE created
- Dirty compile words check passed
- Final clean EXE copied to backup folder

VERIFY:
$VERIFY

CLEAN STAGE:
$STAGE

ISCC:
$ISCC

SOURCE EXE:
$EXE

FINAL CLEAN INSTALLER EXE:
$FINALCOPY

EXE SIZE:
$($FINALINFO.Length) bytes

NEXT:
Test installer on same PC, then test on another clean Windows PC.
"@ | Set-Content "$VERIFY\WINDOWS_CLEAN_EXE_INSTALLER_COMPILE_REPORT.txt" -Encoding UTF8

Write-Host "WINDOWS CLEAN EXE INSTALLER COMPILE PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Clean Installer EXE:" -ForegroundColor Yellow
Write-Host $FINALCOPY -ForegroundColor Yellow
Write-Host "EXE size:" -ForegroundColor Yellow
Write-Host "$($FINALINFO.Length) bytes" -ForegroundColor Yellow