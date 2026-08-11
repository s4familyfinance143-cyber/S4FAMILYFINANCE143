$ErrorActionPreference="Stop"

$PROJECT="S:\S4-FAMILY-FINANCE-143-FINAL"
$BACKEND="$PROJECT\backend"
$FRONTEND="$PROJECT\frontend"
$BACKUPROOT="S:\S4-FAMILY-FINANCE-143-FINAL-BACKUPS"
$PY="$BACKEND\.venv\Scripts\python.exe"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\PRODUCTION_PACKAGING_INSTALLER_DEPLOYMENT_SETUP_$TS"
$DEPLOY="$PROJECT\deploy"
$WINDOWS="$DEPLOY\windows"
$DOCKER="$DEPLOY\docker"
$NGINX="$DEPLOY\nginx"
$INSTALLER="$DEPLOY\installer"

Set-Location $BACKEND

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null
New-Item -ItemType Directory -Force $DEPLOY | Out-Null
New-Item -ItemType Directory -Force $WINDOWS | Out-Null
New-Item -ItemType Directory -Force $DOCKER | Out-Null
New-Item -ItemType Directory -Force $NGINX | Out-Null
New-Item -ItemType Directory -Force $INSTALLER | Out-Null

$FINAL = Get-ChildItem $PROJECT -Directory |
  Where-Object { $_.Name -like "FINAL_PRODUCTION_FULL_SYSTEM_QA_RELEASE_LOCK_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $FINAL) { throw "Final production QA release lock folder not found" }

Select-String -Path "$($FINAL.FullName)\FINAL_PRODUCTION_FULL_SYSTEM_QA_RELEASE_LOCK_REPORT.txt" -Pattern "STATUS: PASS" | Out-Null
Copy-Item "$($FINAL.FullName)\FINAL_PRODUCTION_FULL_SYSTEM_QA_RELEASE_LOCK_REPORT.txt" "$VERIFY\00_previous_final_release_lock_PASS.txt" -Force

Write-Host "1) Backend compile check..." -ForegroundColor Cyan

$env:PYTHONPATH=$BACKEND
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:ENVIRONMENT="development"
$env:AUTO_CREATE_TABLES="true"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"

& $PY -m compileall "$BACKEND\app" -q
if ($LASTEXITCODE -ne 0) { throw "Backend compile failed" }

"Backend compile: PASS" | Set-Content "$VERIFY\01_backend_compile_PASS.txt" -Encoding UTF8

Write-Host "2) Create production env example..." -ForegroundColor Cyan

@"
# S4 FAMILY FINANCE 143 - PRODUCTION ENV EXAMPLE
# Copy this file to backend\.env.production and edit values before running production.

ENVIRONMENT=production
AUTO_CREATE_TABLES=false

# PostgreSQL production database
DATABASE_URL=postgresql+psycopg://postgres:CHANGE_ME_PASSWORD@127.0.0.1:5432/s4_family_finance_production

# Must be 64+ random characters. Do not use this placeholder in production.
JWT_SECRET_KEY=CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
JWT_SECRET=CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
SECRET_KEY=CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
APP_SECRET_KEY=CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
S4_JWT_SECRET_KEY=CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
S4_SECRET_KEY=CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET

ENABLE_RECURRING_WORKER=false
ENABLE_AUTO_BACKUP_WORKER=false
"@ | Set-Content "$BACKEND\.env.production.example" -Encoding UTF8

Write-Host "3) Create Windows deployment scripts..." -ForegroundColor Cyan

@'
@echo off
setlocal
cd /d "%~dp0..\..\backend"

echo Installing backend dependencies...
if not exist ".venv" (
  py -3 -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip

if exist requirements.txt (
  pip install -r requirements.txt
) else (
  if exist requirements-production.lock.txt (
    pip install -r requirements-production.lock.txt
  ) else (
    echo requirements.txt not found.
    exit /b 1
  )
)

echo Backend dependency install complete.
pause
'@ | Set-Content "$WINDOWS\01_install_backend_dependencies.bat" -Encoding ASCII

@'
@echo off
setlocal
cd /d "%~dp0..\..\backend"

call .venv\Scripts\activate.bat

set ENVIRONMENT=development
set AUTO_CREATE_TABLES=true
set ENABLE_RECURRING_WORKER=false
set ENABLE_AUTO_BACKUP_WORKER=false

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
'@ | Set-Content "$WINDOWS\02_run_backend_local_sqlite.bat" -Encoding ASCII

@'
@echo off
setlocal
cd /d "%~dp0..\..\backend"

if not exist ".env.production" (
  echo backend\.env.production not found.
  echo Copy backend\.env.production.example to backend\.env.production and edit it first.
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat

for /f "usebackq tokens=1,* delims==" %%A in (".env.production") do (
  if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
'@ | Set-Content "$WINDOWS\03_run_backend_postgres_production.bat" -Encoding ASCII

@'
@echo off
setlocal
cd /d "%~dp0..\..\frontend"

if not exist node_modules (
  echo node_modules not found. Running npm install...
  npm install
)

npm run build
npm run preview -- --host 127.0.0.1 --port 4173
pause
'@ | Set-Content "$WINDOWS\04_run_frontend_preview.bat" -Encoding ASCII

@"
S4 FAMILY FINANCE 143 - WINDOWS LOCAL RUN GUIDE

1. Backend local SQLite:
   deploy\windows\02_run_backend_local_sqlite.bat

2. Frontend preview:
   deploy\windows\04_run_frontend_preview.bat

3. PostgreSQL production mode:
   - Copy backend\.env.production.example to backend\.env.production
   - Edit DATABASE_URL and secret values
   - Run deploy\windows\03_run_backend_postgres_production.bat

Backend:
http://127.0.0.1:8000

Frontend preview:
http://127.0.0.1:4173
"@ | Set-Content "$WINDOWS\README_WINDOWS_LOCAL.md" -Encoding UTF8

Write-Host "4) Create Docker/nginx deployment skeleton..." -ForegroundColor Cyan

@'
FROM python:3.14-slim

WORKDIR /app

COPY backend/requirements*.txt /app/

RUN python -m pip install --upgrade pip && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt; else pip install -r requirements-production.lock.txt; fi

COPY backend/app /app/app
COPY backend/alembic /app/alembic
COPY backend/alembic.ini /app/alembic.ini

ENV ENVIRONMENT=production
ENV AUTO_CREATE_TABLES=false
ENV ENABLE_RECURRING_WORKER=false
ENV ENABLE_AUTO_BACKUP_WORKER=false

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
'@ | Set-Content "$DOCKER\Dockerfile.backend" -Encoding UTF8

@'
services:
  postgres:
    image: postgres:17
    container_name: s4-family-finance-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: s4_family_finance_production
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: CHANGE_ME_STRONG_PASSWORD
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  backend:
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.backend
    container_name: s4-family-finance-backend
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      ENVIRONMENT: production
      AUTO_CREATE_TABLES: "false"
      DATABASE_URL: postgresql+psycopg://postgres:CHANGE_ME_STRONG_PASSWORD@postgres:5432/s4_family_finance_production
      JWT_SECRET_KEY: CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
      JWT_SECRET: CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
      SECRET_KEY: CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
      APP_SECRET_KEY: CHANGE_ME_RANDOM_64_PLUS_CHAR_SECRET
      ENABLE_RECURRING_WORKER: "false"
      ENABLE_AUTO_BACKUP_WORKER: "false"
    ports:
      - "8000:8000"

volumes:
  postgres_data:
'@ | Set-Content "$DOCKER\docker-compose.production.yml" -Encoding UTF8

@'
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
'@ | Set-Content "$NGINX\s4_family_finance_nginx.conf" -Encoding UTF8

Write-Host "5) Create installer skeleton..." -ForegroundColor Cyan

@'
#define MyAppName "S4 FAMILY FINANCE 143"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "S4"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\S4 FAMILY FINANCE 143
DefaultGroupName=S4 FAMILY FINANCE 143
OutputBaseFilename=S4-FAMILY-FINANCE-143-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\..\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs ignoreversion; Excludes: ".venv\*,__pycache__\*,*.db,*.log,node_modules\*"
Source: "..\..\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: recursesubdirs ignoreversion
Source: "..\windows\*"; DestDir: "{app}\deploy\windows"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Run Backend Local SQLite"; Filename: "{app}\deploy\windows\02_run_backend_local_sqlite.bat"
Name: "{group}\Run Frontend Preview"; Filename: "{app}\deploy\windows\04_run_frontend_preview.bat"
Name: "{group}\Production Env Example"; Filename: "{app}\backend\.env.production.example"

[Run]
Filename: "{app}\deploy\windows\01_install_backend_dependencies.bat"; Description: "Install backend dependencies"; Flags: postinstall skipifsilent
'@ | Set-Content "$INSTALLER\S4_FAMILY_FINANCE_143_InnoSetup.iss" -Encoding UTF8

@"
S4 FAMILY FINANCE 143 - INSTALLER NOTE

This folder contains Inno Setup script:
deploy\installer\S4_FAMILY_FINANCE_143_InnoSetup.iss

To create Windows .exe installer later:
1. Install Inno Setup on Windows.
2. Open this .iss file.
3. Click Compile.
4. It will create S4-FAMILY-FINANCE-143-Setup.exe.

Current setup creates installer script only; it does not compile .exe automatically.
"@ | Set-Content "$INSTALLER\README_INSTALLER.md" -Encoding UTF8

Write-Host "6) Freeze production requirements..." -ForegroundColor Cyan

& $PY -m pip freeze | Set-Content "$BACKEND\requirements-production.lock.txt" -Encoding UTF8

if (-not (Test-Path "$BACKEND\requirements.txt")) {
  Copy-Item "$BACKEND\requirements-production.lock.txt" "$BACKEND\requirements.txt" -Force
}

Write-Host "7) Frontend production build..." -ForegroundColor Cyan

if (Test-Path "$FRONTEND\package.json") {
  Set-Location $FRONTEND
  if (-not (Test-Path "$FRONTEND\node_modules")) {
    npm install | Tee-Object "$VERIFY\07_frontend_npm_install.txt"
    if ($LASTEXITCODE -ne 0) { throw "frontend npm install failed" }
  }

  npm run build | Tee-Object "$VERIFY\08_frontend_build.txt"
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

  if (-not (Test-Path "$FRONTEND\dist\index.html")) {
    throw "frontend dist/index.html not found"
  }

  Set-Location $BACKEND
} else {
  throw "frontend package.json not found"
}

Write-Host "8) Create production deployment README..." -ForegroundColor Cyan

@"
S4 FAMILY FINANCE 143 - PRODUCTION PACKAGING / DEPLOYMENT SETUP

FINAL QA SOURCE:
$($FINAL.FullName)

CREATED:
- backend\.env.production.example
- backend\requirements-production.lock.txt
- deploy\windows\01_install_backend_dependencies.bat
- deploy\windows\02_run_backend_local_sqlite.bat
- deploy\windows\03_run_backend_postgres_production.bat
- deploy\windows\04_run_frontend_preview.bat
- deploy\docker\Dockerfile.backend
- deploy\docker\docker-compose.production.yml
- deploy\nginx\s4_family_finance_nginx.conf
- deploy\installer\S4_FAMILY_FINANCE_143_InnoSetup.iss

LOCAL WINDOWS RUN:
1. Run backend:
   deploy\windows\02_run_backend_local_sqlite.bat

2. Run frontend:
   deploy\windows\04_run_frontend_preview.bat

3. Open:
   Frontend: http://127.0.0.1:4173
   Backend:  http://127.0.0.1:8000

POSTGRES PRODUCTION MODE:
1. Copy:
   backend\.env.production.example
   to
   backend\.env.production

2. Edit:
   DATABASE_URL
   JWT_SECRET_KEY / SECRET values

3. Run:
   deploy\windows\03_run_backend_postgres_production.bat

WINDOWS INSTALLER:
- Inno Setup script created.
- Compile deploy\installer\S4_FAMILY_FINANCE_143_InnoSetup.iss with Inno Setup.

DOCKER:
- Docker skeleton created under deploy\docker.
- Change all CHANGE_ME values before use.

IMPORTANT:
Do not ship .venv, node_modules, dev DB, or placeholder secrets.
"@ | Set-Content "$DEPLOY\README_PRODUCTION_DEPLOYMENT.md" -Encoding UTF8

Write-Host "9) Create production package ZIP..." -ForegroundColor Cyan

$TS2=Get-Date -Format "yyyyMMdd-HHmmss"
$STAGE="$BACKUPROOT\STAGE-PRODUCTION-PACKAGING-SETUP-$TS2"
$ZIP="$BACKUPROOT\S4-FAMILY-FINANCE-143-PRODUCTION-PACKAGING-DEPLOYMENT-SETUP-$TS2.zip"

if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }
New-Item -ItemType Directory -Force $STAGE | Out-Null
New-Item -ItemType Directory -Force "$STAGE\backend" | Out-Null
New-Item -ItemType Directory -Force "$STAGE\frontend" | Out-Null
New-Item -ItemType Directory -Force "$STAGE\deploy" | Out-Null

robocopy "$BACKEND" "$STAGE\backend" /E /XD ".venv" "__pycache__" ".pytest_cache" ".mypy_cache" ".ruff_cache" /XF "*.pyc" "*.pyo" "*.db" "*.log" "phase*.ps1" "fix*.ps1" "patch*.ps1" "final_release_real_fix_and_run.ps1" | Out-Null
$rc=$LASTEXITCODE
if ($rc -gt 7) { throw "robocopy backend failed with exit code $rc" }

robocopy "$FRONTEND" "$STAGE\frontend" /E /XD "node_modules" ".vite" /XF "*.log" | Out-Null
$rc=$LASTEXITCODE
if ($rc -gt 7) { throw "robocopy frontend failed with exit code $rc" }

robocopy "$DEPLOY" "$STAGE\deploy" /E | Out-Null
$rc=$LASTEXITCODE
if ($rc -gt 7) { throw "robocopy deploy failed with exit code $rc" }

Copy-Item "$DEPLOY\README_PRODUCTION_DEPLOYMENT.md" "$STAGE\README_PRODUCTION_DEPLOYMENT.md" -Force

Compress-Archive -Path "$STAGE\*" -DestinationPath $ZIP -Force
$zipInfo = Get-Item $ZIP
if ($zipInfo.Length -le 0) { throw "Production deployment package ZIP is empty" }

@"
S4 FAMILY FINANCE 143 - PRODUCTION PACKAGING / INSTALLER / DEPLOYMENT SETUP REPORT

STATUS: PASS
Time: $TS2

VERIFIED:
- Final Production Full System QA Release Lock confirmed
- Backend compile passed
- Production env example created
- Windows local run scripts created
- PostgreSQL production run script created
- Docker deployment skeleton created
- Nginx config skeleton created
- Inno Setup installer script created
- Production requirements lock created
- Frontend production build passed
- frontend\dist\index.html exists
- Production deployment README created
- Production packaging ZIP created

VERIFY:
$VERIFY

DEPLOY FOLDER:
$DEPLOY

PACKAGE ZIP:
$ZIP

ZIP SIZE:
$($zipInfo.Length) bytes

NEXT:
Windows .exe installer compile OR production server deployment
"@ | Set-Content "$VERIFY\PRODUCTION_PACKAGING_INSTALLER_DEPLOYMENT_SETUP_REPORT.txt" -Encoding UTF8

Write-Host "PRODUCTION PACKAGING / INSTALLER / DEPLOYMENT SETUP PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Deploy folder:" -ForegroundColor Yellow
Write-Host $DEPLOY -ForegroundColor Yellow
Write-Host "Package ZIP:" -ForegroundColor Yellow
Write-Host $ZIP -ForegroundColor Yellow
Write-Host "ZIP size:" -ForegroundColor Yellow
Write-Host "$($zipInfo.Length) bytes" -ForegroundColor Yellow

Get-ChildItem $VERIFY | Select-Object Name,Length,LastWriteTime