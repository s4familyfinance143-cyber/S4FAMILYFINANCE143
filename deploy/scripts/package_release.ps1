# Build a lean release archive for transfer (no secrets, no venv/node_modules).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "backend\app"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Dist = Join-Path $Root "deploy\dist"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

$includeCandidates = @(
  "backend",
  "frontend",
  "deploy",
  "mobile",
  "desktop",
  "docker-compose.yml",
  "docker-compose.local.yml",
  "setup_local.ps1",
  "SETUP_COMPLETE.md"
)
$include = @($includeCandidates | Where-Object { Test-Path (Join-Path $Root $_) })

$OutZip = Join-Path $Dist "s4-family-finance-release-$stamp.zip"
if (Test-Path $OutZip) { Remove-Item $OutZip -Force }

$stage = Join-Path $Dist "stage-$stamp"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

foreach ($item in $include) {
  $src = Join-Path $Root $item
  $dest = Join-Path $stage $item
  if (Test-Path $src -PathType Container) {
    robocopy $src $dest /E /XD .venv node_modules dist .git __pycache__ .pytest_cache .expo /XF *.db *.sqlite *.sqlite3 .env /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  } else {
    $parent = Split-Path $dest -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item $src $dest -Force
  }
}

# Include built frontend dist if present
$feDist = Join-Path $Root "frontend\dist"
if (Test-Path $feDist) {
  $destDist = Join-Path $stage "frontend\dist"
  New-Item -ItemType Directory -Force -Path (Split-Path $destDist -Parent) | Out-Null
  robocopy $feDist $destDist /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $OutZip -Force
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

$sizeMb = [math]::Round((Get-Item $OutZip).Length / 1MB, 2)
Write-Host "PASS package_release"
Write-Host "OUT  $OutZip ($sizeMb MB)"
Write-Host "NOTE: Fill frontend/.env Firebase keys before cloud backup."
