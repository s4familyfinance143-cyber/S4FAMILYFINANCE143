$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$FRONTEND="$PROJECT\frontend"
$DEPLOY="$PROJECT\deploy"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\PRODUCTION_PACKAGING_FINISH_CHECK_$TS"

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

Set-Location $BACKEND

Write-Host "1) Check required production packaging files..." -ForegroundColor Cyan

$required = @(
  "$BACKEND\.env.production.example",
  "$BACKEND\requirements-production.lock.txt",
  "$DEPLOY\windows\01_install_backend_dependencies.bat",
  "$DEPLOY\windows\02_run_backend_local_sqlite.bat",
  "$DEPLOY\windows\03_run_backend_postgres_production.bat",
  "$DEPLOY\windows\04_run_frontend_preview.bat",
  "$DEPLOY\docker\Dockerfile.backend",
  "$DEPLOY\docker\docker-compose.production.yml",
  "$DEPLOY\nginx\s4_family_finance_nginx.conf",
  "$DEPLOY\installer\S4_FAMILY_FINANCE_143_InnoSetup.iss",
  "$DEPLOY\README_PRODUCTION_DEPLOYMENT.md",
  "$FRONTEND\dist\index.html"
)

$missing = @()
foreach ($p in $required) {
  if (-not (Test-Path $p)) { $missing += $p }
}

$missing | Set-Content "$VERIFY\01_missing_required_files.txt" -Encoding UTF8

if ($missing.Count -gt 0) {
  Write-Host "Missing files:" -ForegroundColor Red
  $missing
  throw "Production packaging required files missing"
}

Write-Host "required_files_missing: []" -ForegroundColor Green

Write-Host "2) Backend compile check..." -ForegroundColor Cyan

$env:PYTHONPATH=$BACKEND
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "Backend compile failed" }

"Backend compile PASS" | Set-Content "$VERIFY\02_backend_compile_PASS.txt" -Encoding UTF8

Write-Host "3) Frontend build check..." -ForegroundColor Cyan

Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\03_frontend_build.txt"
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

if (-not (Test-Path "$FRONTEND\dist\index.html")) {
  throw "frontend dist/index.html missing after build"
}

Set-Location $BACKEND

Write-Host "4) Create clean production package ZIP..." -ForegroundColor Cyan

@'
from pathlib import Path
import shutil
import zipfile
import fnmatch
from datetime import datetime

PROJECT = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL")
BACKEND = PROJECT / "backend"
FRONTEND = PROJECT / "frontend"
DEPLOY = PROJECT / "deploy"
BACKUPROOT = Path(r"S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS")
TS = datetime.now().strftime("%Y%m%d-%H%M%S")

stage = BACKUPROOT / f"STAGE-PRODUCTION-PACKAGING-FINAL-{TS}"
zip_path = BACKUPROOT / f"S4-FAMILY-FINANCE-143-PRODUCTION-PACKAGING-DEPLOYMENT-SETUP-FINAL-{TS}.zip"

exclude_dirs = {
    ".venv", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".git", ".vite"
}

exclude_patterns = [
    "*.pyc", "*.pyo", "*.db", "*.sqlite", "*.sqlite3", "*.log",
    "phase*.ps1", "fix*.ps1", "patch*.ps1",
    "final_release_real_fix_and_run.ps1",
    "production_packaging_setup.ps1",
    "production_packaging_finish_check.ps1",
]

def should_ignore(path: Path):
    if path.name in exclude_dirs:
        return True
    for pat in exclude_patterns:
        if fnmatch.fnmatch(path.name.lower(), pat.lower()):
            return True
    return False

def copy_clean(src: Path, dst: Path):
    if not src.exists():
        raise FileNotFoundError(str(src))

    for item in src.rglob("*"):
        rel = item.relative_to(src)
        parts = set(rel.parts)

        if parts.intersection(exclude_dirs):
            continue

        if should_ignore(item):
            continue

        target = dst / rel

        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)

if stage.exists():
    shutil.rmtree(stage)

(stage / "backend").mkdir(parents=True, exist_ok=True)
(stage / "frontend").mkdir(parents=True, exist_ok=True)
(stage / "deploy").mkdir(parents=True, exist_ok=True)

copy_clean(BACKEND, stage / "backend")
copy_clean(FRONTEND, stage / "frontend")
copy_clean(DEPLOY, stage / "deploy")

readme = DEPLOY / "README_PRODUCTION_DEPLOYMENT.md"
if readme.exists():
    shutil.copy2(readme, stage / "README_PRODUCTION_DEPLOYMENT.md")

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for file in stage.rglob("*"):
        if file.is_file():
            z.write(file, file.relative_to(stage))

size = zip_path.stat().st_size

if size <= 0:
    raise RuntimeError("ZIP created but empty")

required_inside = [
    stage / "backend" / ".env.production.example",
    stage / "backend" / "requirements-production.lock.txt",
    stage / "frontend" / "dist" / "index.html",
    stage / "deploy" / "windows" / "02_run_backend_local_sqlite.bat",
    stage / "deploy" / "installer" / "S4_FAMILY_FINANCE_143_InnoSetup.iss",
]

missing_inside = [str(p) for p in required_inside if not p.exists()]
if missing_inside:
    raise RuntimeError("Missing inside stage: " + repr(missing_inside))

print("PACKAGE_STAGE:", stage)
print("PACKAGE_ZIP:", zip_path)
print("ZIP_SIZE:", size)
print("MISSING_INSIDE_STAGE:", missing_inside)
'@ | Set-Content "$VERIFY\04_create_clean_package_zip.py" -Encoding UTF8

& $PY "$VERIFY\04_create_clean_package_zip.py" | Tee-Object "$VERIFY\04_create_clean_package_zip.txt"
if ($LASTEXITCODE -ne 0) { throw "Production clean package ZIP failed" }

$zipLine = Select-String -Path "$VERIFY\04_create_clean_package_zip.txt" -Pattern "^PACKAGE_ZIP:" | Select-Object -First 1
$sizeLine = Select-String -Path "$VERIFY\04_create_clean_package_zip.txt" -Pattern "^ZIP_SIZE:" | Select-Object -First 1

if (-not $zipLine) { throw "PACKAGE_ZIP line not found" }
if (-not $sizeLine) { throw "ZIP_SIZE line not found" }

$ZIP = ($zipLine.Line -replace "^PACKAGE_ZIP:\s*", "").Trim()
$SIZE = ($sizeLine.Line -replace "^ZIP_SIZE:\s*", "").Trim()

if (-not (Test-Path $ZIP)) { throw "ZIP file not found after create: $ZIP" }

@"
S4 FAMILY FINANCE 143 - PRODUCTION PACKAGING / INSTALLER / DEPLOYMENT FINISH REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- Required production packaging files exist
- Backend compile passed
- Frontend production build passed
- frontend\dist\index.html exists
- Clean production package ZIP created
- Installer skeleton exists
- Windows run scripts exist
- Docker/nginx deployment skeleton exists

VERIFY:
$VERIFY

DEPLOY FOLDER:
$DEPLOY

PACKAGE ZIP:
$ZIP

ZIP SIZE:
$SIZE bytes

NEXT:
Windows .exe installer compile OR production server deployment
"@ | Set-Content "$VERIFY\PRODUCTION_PACKAGING_FINISH_CHECK_REPORT.txt" -Encoding UTF8

Write-Host "PRODUCTION PACKAGING / INSTALLER / DEPLOYMENT SETUP PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Deploy folder:" -ForegroundColor Yellow
Write-Host $DEPLOY -ForegroundColor Yellow
Write-Host "Package ZIP:" -ForegroundColor Yellow
Write-Host $ZIP -ForegroundColor Yellow
Write-Host "ZIP size:" -ForegroundColor Yellow
Write-Host "$SIZE bytes" -ForegroundColor Yellow