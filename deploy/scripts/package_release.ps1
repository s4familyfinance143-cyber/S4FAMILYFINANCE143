# Build a lean release tarball for VM/VPS transfer (no secrets, no venv/node_modules).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "deploy\docker\docker-compose.production.yml"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Dist = Join-Path $Root "deploy\dist"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
$OutName = "s4-family-finance-release-$stamp.tar.gz"
$OutPath = Join-Path $Dist $OutName

$include = @(
  "backend",
  "frontend",
  "deploy",
  "mobile",
  "MAIN_ARCHITECTURE_PROGRESS_CHECK.md"
)

$excludeArgs = @(
  "--exclude=backend/.venv",
  "--exclude=backend/.env",
  "--exclude=frontend/node_modules",
  "--exclude=frontend/dist",
  "--exclude=mobile/node_modules",
  "--exclude=mobile/.expo",
  "--exclude=deploy/dist",
  "--exclude=deploy/docker/.env.production",
  "--exclude=.git",
  "--exclude=__pycache__",
  "--exclude=*.pyc",
  "--exclude=.pytest_cache",
  "--exclude=*.db",
  "--exclude=*.sqlite",
  "--exclude=*.sqlite3"
)

Push-Location $Root
try {
  $tarArgs = @("-czf", $OutPath) + $excludeArgs + $include
  & tar @tarArgs
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

$sizeMb = [math]::Round((Get-Item $OutPath).Length / 1MB, 2)
Write-Host "PASS package_release"
Write-Host "OUT  $OutPath ($sizeMb MB)"
Write-Host "NOTE: Copy to VM/VPS, extract, then fill deploy/docker/.env.production from examples."
