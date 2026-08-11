# Validates S4 production packaging artifacts (no real deploy, no secret values required).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "deploy\docker\docker-compose.production.yml"))) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}

$checks = @(
  "deploy\docker\docker-compose.production.yml",
  "deploy\docker\docker-compose.ghcr.yml",
  "deploy\docker\Dockerfile.backend",
  "deploy\docker\Dockerfile.frontend",
  "deploy\docker\.env.production.example",
  "deploy\nginx\s4_family_finance_nginx.conf",
  "deploy\nginx\s4_family_finance_nginx.ssl.example.conf",
  "deploy\README_PRODUCTION_DEPLOYMENT.md",
  "deploy\README_RELEASE_KIT.md",
  "deploy\README_CI_CD.md",
  "deploy\docker\.env.staging.example",
  "deploy\scripts\vps_go_live_deploy.sh",
  "deploy\scripts\remote_ghcr_deploy.sh",
  "deploy\scripts\ghcr_login.sh",
  "deploy\scripts\verify_live.sh",
  "deploy\scripts\package_release.ps1",
  "backend\.env.production.example",
  "backend\requirements.txt",
  "backend\alembic.ini"
)

$failed = 0
foreach ($rel in $checks) {
  $path = Join-Path $Root $rel
  if (Test-Path $path) {
    Write-Host "OK  $rel"
  } else {
    Write-Host "MISS $rel"
    $failed++
  }
}

$nginx = Get-Content (Join-Path $Root "deploy\nginx\s4_family_finance_nginx.conf") -Raw
if ($nginx -match "server backend:8000|proxy_pass http://s4_backend|proxy_pass http://backend:8000") {
  Write-Host "OK  nginx proxies to docker service 'backend'"
} else {
  Write-Host "FAIL nginx must proxy to backend:8000 (direct or via upstream s4_backend)"
  $failed++
}
if ($nginx -match "Upgrade") {
  Write-Host "OK  nginx websocket Upgrade headers present"
} else {
  Write-Host "FAIL nginx missing websocket Upgrade headers"
  $failed++
}

$envFile = Join-Path $Root "deploy\docker\.env.production.example"
$compose = Join-Path $Root "deploy\docker\docker-compose.production.yml"
$ghcr = Join-Path $Root "deploy\docker\docker-compose.ghcr.yml"

# Dummy secrets only for `docker compose config` validation
$env:POSTGRES_PASSWORD = "validate_only_postgres"
$env:REDIS_PASSWORD = "validate_only_redis"
$env:MINIO_ROOT_USER = "validate_minio"
$env:MINIO_ROOT_PASSWORD = "validate_only_minio"
$env:DATABASE_URL = "postgresql+psycopg://s4_user:validate_only_postgres@postgres:5432/s4_family_finance_production"
$env:JWT_SECRET_KEY = "validate_only_jwt_secret_key_32chars_min_xx"
$env:S4_BACKEND_IMAGE = "ghcr.io/example/s4-backend:validate"
$env:S4_FRONTEND_IMAGE = "ghcr.io/example/s4-nginx:validate"

docker compose -f $compose --env-file $envFile config --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL docker compose config"
  $failed++
} else {
  Write-Host "OK  docker compose config (with example/dummy env)"
}

docker compose -f $compose -f $ghcr --env-file $envFile config --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL docker compose GHCR overlay config"
  $failed++
} else {
  Write-Host "OK  docker compose GHCR overlay config"
}

Remove-Item Env:POSTGRES_PASSWORD, Env:REDIS_PASSWORD, Env:MINIO_ROOT_USER, Env:MINIO_ROOT_PASSWORD, Env:DATABASE_URL, Env:JWT_SECRET_KEY, Env:S4_BACKEND_IMAGE, Env:S4_FRONTEND_IMAGE -ErrorAction SilentlyContinue

if ($failed -gt 0) {
  Write-Host "FAIL production_packaging_validate ($failed)"
  exit 1
}
Write-Host "PASS production_packaging_validate"
Write-Host "NOTE: Real VPS still needs domain DNS, TLS certs, and filled .env.production secrets."
