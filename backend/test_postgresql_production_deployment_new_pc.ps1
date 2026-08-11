$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\POSTGRESQL_PRODUCTION_DEPLOYMENT_NEW_PC_TEST_$TS"
$INSTALLDIR="$env:LOCALAPPDATA\S4-FAMILY-FINANCE-143-NEW-PC-TEST"
$BACKEND="$INSTALLDIR\backend"
$PY="$BACKEND\.venv\Scripts\python.exe"

$DBNAME="s4_family_finance_production_test"
$PGUSER="postgres"
$PGPASS="s4m1@v1i2"
$PGHOST="127.0.0.1"
$PGPORT="5432"
$DATABASE_URL="postgresql+psycopg://postgres:s4m1%40v1i2@127.0.0.1:5432/$DBNAME"

New-Item -ItemType Directory -Force $VERIFY | Out-Null

Write-Host "1) Find psql.exe..." -ForegroundColor Cyan

$psqlCmd=Get-Command psql -ErrorAction SilentlyContinue
$PSQL=$null

if($psqlCmd){
  $PSQL=$psqlCmd.Source
} else {
  $found=Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter "psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if($found){ $PSQL=$found.FullName }
}

if(-not $PSQL -or -not (Test-Path $PSQL)){
  throw "psql.exe not found. PostgreSQL install/path not ready."
}

Write-Host "PSQL:" $PSQL -ForegroundColor Green
& $PSQL --version | Tee-Object "$VERIFY\01_psql_version.txt"

Write-Host "2) Check installed backend folder..." -ForegroundColor Cyan

if(-not (Test-Path "$BACKEND\app\main.py")){
  throw "Installed backend not found: $BACKEND"
}

if(-not (Test-Path $PY)){
  throw "Installed backend venv python not found: $PY"
}

Write-Host "Installed backend found:" $BACKEND -ForegroundColor Green

Write-Host "3) Create clean PostgreSQL database..." -ForegroundColor Cyan

$env:PGPASSWORD=$PGPASS

& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d postgres -c "SELECT version();" | Tee-Object "$VERIFY\02_postgres_server_version.txt"
if($LASTEXITCODE -ne 0){ throw "PostgreSQL connection failed" }

& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DBNAME';" | Tee-Object "$VERIFY\03_terminate_db_sessions.txt"
& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d postgres -c "DROP DATABASE IF EXISTS $DBNAME;" | Tee-Object "$VERIFY\04_drop_db.txt"
if($LASTEXITCODE -ne 0){ throw "Drop database failed" }

& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d postgres -c "CREATE DATABASE $DBNAME;" | Tee-Object "$VERIFY\05_create_db.txt"
if($LASTEXITCODE -ne 0){ throw "Create database failed" }

Write-Host "4) Run Alembic migration on PostgreSQL..." -ForegroundColor Cyan

Set-Location $BACKEND

$env:DATABASE_URL=$DATABASE_URL
$env:ENVIRONMENT="production"
$env:AUTO_CREATE_TABLES="false"
$env:ENABLE_RECURRING_WORKER="false"
$env:ENABLE_AUTO_BACKUP_WORKER="false"
$env:JWT_SECRET_KEY="CHANGE_ME_PRODUCTION_TEST_SECRET_143_LONG_SAFE_VALUE"
$env:JWT_REFRESH_SECRET_KEY="CHANGE_ME_PRODUCTION_REFRESH_TEST_SECRET_143_LONG_SAFE_VALUE"

& $PY -m alembic upgrade head | Tee-Object "$VERIFY\06_alembic_upgrade.txt"
if($LASTEXITCODE -ne 0){ throw "Alembic upgrade failed" }

Write-Host "5) Verify PostgreSQL schema..." -ForegroundColor Cyan

& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $DBNAME -c "SELECT version_num FROM alembic_version;" | Tee-Object "$VERIFY\07_alembic_version.txt"
if($LASTEXITCODE -ne 0){ throw "Alembic version check failed" }

& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $DBNAME -c "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema='public';" | Tee-Object "$VERIFY\08_table_count.txt"
if($LASTEXITCODE -ne 0){ throw "PostgreSQL table count check failed" }

Write-Host "6) Backend compile test with PostgreSQL env..." -ForegroundColor Cyan

& $PY -m compileall "$BACKEND\app" -q
if($LASTEXITCODE -ne 0){ throw "Backend compile failed" }

Write-Host "backend_compile: PASS" -ForegroundColor Green

Write-Host "7) Start backend in PostgreSQL production mode..." -ForegroundColor Cyan

$backendProc=Start-Process -FilePath $PY `
  -ArgumentList @("-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8012") `
  -WorkingDirectory $BACKEND `
  -RedirectStandardOutput "$VERIFY\09_backend_postgres_runtime.log" `
  -RedirectStandardError "$VERIFY\09_backend_postgres_runtime_error.log" `
  -PassThru

Start-Sleep -Seconds 10

try{
  $root=Invoke-WebRequest "http://127.0.0.1:8012/" -UseBasicParsing -TimeoutSec 15
  Write-Host "backend_root_status:" $root.StatusCode -ForegroundColor Green
  "backend_root_status: $($root.StatusCode)" | Set-Content "$VERIFY\10_backend_root_status.txt" -Encoding UTF8

  $openapi=Invoke-WebRequest "http://127.0.0.1:8012/openapi.json" -UseBasicParsing -TimeoutSec 15
  Write-Host "openapi_status:" $openapi.StatusCode -ForegroundColor Green
  "openapi_status: $($openapi.StatusCode)" | Set-Content "$VERIFY\11_openapi_status.txt" -Encoding UTF8
} finally {
  if($backendProc -and -not $backendProc.HasExited){
    Stop-Process -Id $backendProc.Id -Force
  }
}

if($root.StatusCode -ne 200){ throw "Backend root PostgreSQL smoke failed" }
if($openapi.StatusCode -ne 200){ throw "OpenAPI PostgreSQL smoke failed" }

@"
S4 FAMILY FINANCE 143 - POSTGRESQL PRODUCTION DEPLOYMENT NEW PC TEST REPORT

STATUS: PASS
Time: $TS

VERIFIED:
- psql found
- PostgreSQL server connection passed
- Clean production test database created
- Alembic migration upgrade head passed
- Alembic version verified
- PostgreSQL public table count checked
- Backend compile passed
- Backend started in PostgreSQL production mode
- Backend root returned 200
- OpenAPI returned 200

DATABASE:
$DBNAME

DATABASE_URL:
$DATABASE_URL

BACKEND:
$BACKEND

VERIFY:
$VERIFY
"@ | Set-Content "$VERIFY\POSTGRESQL_PRODUCTION_DEPLOYMENT_NEW_PC_TEST_REPORT.txt" -Encoding UTF8

Write-Host "POSTGRESQL PRODUCTION DEPLOYMENT NEW PC TEST PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow
Write-Host "Database:" -ForegroundColor Yellow
Write-Host $DBNAME -ForegroundColor Yellow