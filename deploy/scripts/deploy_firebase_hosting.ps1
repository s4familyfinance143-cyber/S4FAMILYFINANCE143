# Deploy PWA to Firebase Hosting (HTTPS)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "==> Build PWA"
Set-Location (Join-Path $Root "frontend")
npm run build:pwa

Write-Host "==> Firebase deploy hosting"
Set-Location $Root
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  npm install -g firebase-tools
}
firebase deploy --only hosting --project s4-family-finance
Write-Host "PASS PWA live at https://s4-family-finance.web.app" -ForegroundColor Green
