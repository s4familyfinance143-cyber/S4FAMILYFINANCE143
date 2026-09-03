# Push S4 Family Finance 143 to GitHub + Release
# Repo: https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> Remote" -ForegroundColor Cyan
git remote set-url origin "https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143.git"
git remote -v

Write-Host ""
Write-Host "IMPORTANT: Login as GitHub user: s4familyfinance143-cyber" -ForegroundColor Yellow
Write-Host "If push fails with 403, run in a NEW terminal:" -ForegroundColor Yellow
Write-Host '  cmdkey /delete:LegacyGeneric:target=git:https://github.com' -ForegroundColor Gray
Write-Host "Then run this script again — browser will ask for login." -ForegroundColor Yellow
Write-Host ""

Write-Host "==> Push main" -ForegroundColor Cyan
git push -u origin main

Write-Host "==> Push release tag v1.0.12 (builds PWA zip + APK + EXE on GitHub Actions)" -ForegroundColor Cyan
git push origin v1.0.12

Write-Host ""
Write-Host "PASS: Code pushed. Check:" -ForegroundColor Green
Write-Host "  Code:    https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143"
Write-Host "  Actions: https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/actions"
Write-Host "  Release: https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases"
Write-Host ""
Write-Host "After Actions finish (~10 min), download:" -ForegroundColor Cyan
Write-Host "  - s4-pwa-dist.zip (PWA)"
Write-Host "  - s4-family-finance-143-debug.apk (Android)"
Write-Host ""
Write-Host "PWA live (run once on your PC):" -ForegroundColor Cyan
Write-Host "  .\deploy\scripts\deploy_firebase_hosting.ps1"
Write-Host "  URL: https://s4-family-finance.web.app"
Write-Host ""
Write-Host "Windows EXE (manual on your PC):" -ForegroundColor Cyan
Write-Host "  cd backend; .\compile_windows_exe_installer_clean_v4.ps1"
