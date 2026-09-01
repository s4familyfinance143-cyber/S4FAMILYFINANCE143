# Build Windows EXE installer (CI + local)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "backend\app"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$Frontend = Join-Path $Root "frontend"
$Iss = Join-Path $Root "deploy\installer\S4_FAMILY_FINANCE_143_InnoSetup.iss"
$DistIndex = Join-Path $Frontend "dist\index.html"

if (-not (Test-Path $DistIndex)) {
  Write-Host "Building frontend..."
  Set-Location $Frontend
  npm ci
  npm run build:pwa
  Set-Location $Root
}

if (-not (Test-Path $DistIndex)) {
  throw "frontend/dist/index.html missing"
}

$IsccCandidates = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$ISCC = $IsccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ISCC) {
  throw "ISCC.exe not found. Install Inno Setup 6: https://jrsoftware.org/isinfo.php"
}

$outDir = Join-Path $Root "deploy\installer\Output"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "Compiling installer with Inno Setup..."
& $ISCC $Iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed" }

$exe = Get-ChildItem $outDir -Filter "S4-FAMILY-FINANCE-143-Setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  $exe = Get-ChildItem $outDir -Filter "*.exe" | Select-Object -First 1
}
if (-not $exe) {
  throw "Installer EXE not found in $outDir"
}

$releaseCopy = Join-Path $Root "S4-Family-Finance-143-Setup.exe"
Copy-Item $exe.FullName $releaseCopy -Force
Write-Host "PASS Windows EXE: $releaseCopy" -ForegroundColor Green
