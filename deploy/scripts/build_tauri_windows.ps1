# Build normal Windows desktop installer (Tauri + Firebase — no Python backend)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "desktop\src-tauri\Cargo.toml"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$Desktop = Join-Path $Root "desktop"
$FrontendDist = Join-Path $Root "frontend\dist\index.html"

Write-Host "Building S4 desktop installer (Firebase cloud — no backend)..." -ForegroundColor Cyan

$Frontend = Join-Path $Root "frontend"
Set-Location $Frontend
if (-not (Test-Path "node_modules")) {
  npm ci
}

Set-Location $Desktop
if (-not (Test-Path "node_modules")) {
  npm install
}

$env:TAURI_PLATFORM = "windows"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }

$bundleDir = Join-Path $Desktop "src-tauri\target\release\bundle\nsis"
if (-not (Test-Path $bundleDir)) {
  throw "NSIS bundle folder not found: $bundleDir"
}

$setup = Get-ChildItem $bundleDir -Filter "*setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) {
  throw "Tauri NSIS setup.exe not found in $bundleDir"
}

$releaseCopy = Join-Path $Root "S4-Family-Finance-143-Setup.exe"
Copy-Item $setup.FullName $releaseCopy -Force

Write-Host "PASS Windows desktop installer: $releaseCopy" -ForegroundColor Green
Write-Host "Install like normal software — double-click Setup, then open from Desktop or Start Menu." -ForegroundColor Green
