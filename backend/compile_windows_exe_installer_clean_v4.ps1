$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$FRONTEND="$PROJECT\frontend"
$DEPLOY="$PROJECT\deploy"
$INSTALLER="$DEPLOY\installer"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\WINDOWS_EXE_INSTALLER_CLEAN_COMPILE_V4_$TS"
$STAGE="$BACKUPROOT\STAGE-WINDOWS-INSTALLER-CLEAN-V4-$TS"

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
  throw "ISCC.exe not found"
}

Write-Host "ISCC FOUND: $ISCC" -ForegroundColor Green

Write-Host "2) Frontend build..." -ForegroundColor Cyan

Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\01_frontend_build.txt"
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

if (-not (Test-Path "$FRONTEND\dist\index.html")) {
  throw "frontend dist/index.html missing"
}

Write-Host "3) Build clean installer stage by whitelist..." -ForegroundColor Cyan

@'
from pathlib import Path
import shutil
import fnmatch
import json

PROJECT = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL")
BACKEND = PROJECT / "backend"
FRONTEND = PROJECT / "frontend"
DEPLOY = PROJECT / "deploy"
STAGE = Path(r"__STAGE__")
VERIFY = Path(r"__VERIFY__")

if STAGE.exists():
    shutil.rmtree(STAGE)

(STAGE / "backend").mkdir(parents=True, exist_ok=True)
(STAGE / "frontend" / "dist").mkdir(parents=True, exist_ok=True)
(STAGE / "deploy" / "windows").mkdir(parents=True, exist_ok=True)

bad_name_parts = [
    ".before",
    "before-",
    "backup",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    "node_modules",
]

bad_patterns = [
    "phase*.ps1",
    "fix*.ps1",
    "patch*.ps1",
    "*before*",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
    "*.log",
    "*.pyc",
    "*.pyo",
    "compile_windows_exe_installer*.ps1",
    "production_packaging*.ps1",
    "final_release*.ps1",
    "s4_backup_*",
    "s4_auto_backup_*",
]

def is_bad(path: Path) -> bool:
    s = str(path).lower()
    name = path.name.lower()

    for part in bad_name_parts:
        if part in s:
            return True

    for pat in bad_patterns:
        if fnmatch.fnmatch(name, pat.lower()):
            return True

    return False

def copy_file(src: Path, dst: Path):
    if is_bad(src):
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True

copied = []

# backend/app: only clean .py files
for src in (BACKEND / "app").rglob("*.py"):
    if copy_file(src, STAGE / "backend" / "app" / src.relative_to(BACKEND / "app")):
        copied.append(str(src))

# backend/alembic: clean files only
for src in (BACKEND / "alembic").rglob("*"):
    if src.is_file():
        if src.suffix.lower() in [".py", ".mako", ".md"] and copy_file(src, STAGE / "backend" / "alembic" / src.relative_to(BACKEND / "alembic")):
            copied.append(str(src))

# root backend production files only
root_files = [
    "alembic.ini",
    "requirements.txt",
    "requirements-production.lock.txt",
    ".env.production.example",
]

for name in root_files:
    src = BACKEND / name
    if src.exists():
        if copy_file(src, STAGE / "backend" / name):
            copied.append(str(src))

# frontend/dist only
for src in (FRONTEND / "dist").rglob("*"):
    if src.is_file():
        if copy_file(src, STAGE / "frontend" / "dist" / src.relative_to(FRONTEND / "dist")):
            copied.append(str(src))

# deploy/windows only .bat + .md
for src in (DEPLOY / "windows").rglob("*"):
    if src.is_file() and src.suffix.lower() in [".bat", ".md"]:
        if copy_file(src, STAGE / "deploy" / "windows" / src.relative_to(DEPLOY / "windows")):
            copied.append(str(src))

required = [
    STAGE / "backend" / "app" / "main.py",
    STAGE / "backend" / "app" / "core" / "config.py",
    STAGE / "backend" / "alembic.ini",
    STAGE / "backend" / "requirements-production.lock.txt",
    STAGE / "backend" / ".env.production.example",
    STAGE / "frontend" / "dist" / "index.html",
    STAGE / "deploy" / "windows" / "01_install_backend_dependencies.bat",
    STAGE / "deploy" / "windows" / "02_run_backend_local_sqlite.bat",
    STAGE / "deploy" / "windows" / "04_run_frontend_preview.bat",
]

missing = [str(p) for p in required if not p.exists()]

bad_found = []
for p in STAGE.rglob("*"):
    if is_bad(p):
        bad_found.append(str(p))

report = {
    "stage": str(STAGE),
    "copied_count": len(copied),
    "missing_required": missing,
    "bad_found": bad_found,
}

(VERIFY / "02_clean_stage_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

print("STAGE:", STAGE)
print("COPIED_COUNT:", len(copied))
print("MISSING_REQUIRED:", missing)
print("BAD_FOUND_COUNT:", len(bad_found))

if missing:
    raise SystemExit("Missing required files: " + repr(missing))

if bad_found:
    raise SystemExit("Bad files found: " + repr(bad_found[:30]))
'@.Replace("__STAGE__", $STAGE.Replace("\", "\\")).Replace("__VERIFY__", $VERIFY.Replace("\", "\\")) |
Set-Content "$VERIFY\02_build_clean_stage.py" -Encoding UTF8

& $PY "$VERIFY\02_build_clean_stage.py" | Tee-Object "$VERIFY\02_build_clean_stage.txt"
if ($LASTEXITCODE -ne 0) { throw "Clean stage build failed" }

Write-Host "4) Create clean Inno Setup script..." -ForegroundColor Cyan

$OUTPUT="$INSTALLER\OutputCleanV4"
$CLEAN_ISS="$INSTALLER\S4_FAMILY_FINANCE_143_CLEAN_V4_$TS.iss"

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
OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup-CLEAN-V4
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

Write-Host "5) Compile clean installer v4..." -ForegroundColor Cyan

Set-Location $INSTALLER

& $ISCC $CLEAN_ISS /O"$OUTPUT" /F"S4-FAMILY-FINANCE-143-Setup-CLEAN-V4-$TS" | Tee-Object "$VERIFY\03_inno_clean_v4_compile_output.txt"
if ($LASTEXITCODE -ne 0) { throw "Clean installer v4 compile failed" }

Write-Host "6) Verify compile output clean..." -ForegroundColor Cyan

$compileText = Get-Content "$VERIFY\03_inno_clean_v4_compile_output.txt" -Raw

$dirtyWords = @(
  "phase7c",
  "phase8",
  "phase9",
  "phase10",
  "fix_config",
  "patch_final",
  "final_release_qa_lock",
  "production_packaging",
  "backups\auto",
  "s4_backup_",
  ".before-"
)

$dirtyFound = @()
foreach ($w in $dirtyWords) {
  if ($compileText -like "*$w*") { $dirtyFound += $w }
}

if ($dirtyFound.Count -gt 0) {
  $dirtyFound | Set-Content "$VERIFY\04_dirty_words_found.txt" -Encoding UTF8
  throw "Dirty words found in clean compile output"
}

"dirty_words_found: []" | Set-Content "$VERIFY\04_dirty_words_found.txt" -Encoding UTF8
Write-Host "dirty_words_found: []" -ForegroundColor Green

Write-Host "7) Copy final clean installer EXE..." -ForegroundColor Cyan

$exeCandidates = Get-ChildItem $OUTPUT -File -Filter "*.exe" |
  Where-Object { $_.Name -like "S4-FAMILY-FINANCE-143-Setup-CLEAN-V4*.exe" } |
  Sort-Object LastWriteTime -Descending

if (-not $exeCandidates -or $exeCandidates.Count -eq 0) {
  throw "Clean V4 setup EXE not found"
}

$EXE=$exeCandidates[0].FullName
$EXEINFO=Get-Item $EXE

if ($EXEINFO.Length -le 0) {
  throw "Clean V4 EXE size is zero"
}

$FINALCOPY="$BACKUPROOT\S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V4-$TS.exe"
Copy-Item $EXE $FINALCOPY -Force
$FINALINFO=Get-Item $FINALCOPY

@"
S4 FAMILY FINANCE 143 - WINDOWS CLEAN EXE INSTALLER COMPILE V4 REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- ISCC found
- Frontend production build passed
- Clean stage created by whitelist
- Missing required files: []
- Bad dev/backup files: []
- Inno Setup compile passed
- Dirty compile words: []
- Final clean installer EXE created

VERIFY:
$VERIFY

CLEAN STAGE:
$STAGE

FINAL CLEAN INSTALLER EXE:
$FINALCOPY

EXE SIZE:
$($FINALINFO.Length) bytes
"@ | Set-Content "$VERIFY\WINDOWS_CLEAN_EXE_INSTALLER_COMPILE_V4_REPORT.txt" -Encoding UTF8

Write-Host "WINDOWS CLEAN EXE INSTALLER COMPILE V4 PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Clean Installer EXE:" -ForegroundColor Yellow
Write-Host $FINALCOPY -ForegroundColor Yellow
Write-Host "EXE size:" -ForegroundColor Yellow
Write-Host "$($FINALINFO.Length) bytes" -ForegroundColor Yellow