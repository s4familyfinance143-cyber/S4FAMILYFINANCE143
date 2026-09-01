# Opens Firebase + Google Cloud setup pages and shows what to paste in frontend/.env
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root "frontend\.env"

Write-Host "S4 Cloud Setup Wizard" -ForegroundColor Cyan
Write-Host "====================="
Write-Host ""
Write-Host "1) Create Firebase project: https://console.firebase.google.com/"
Write-Host "2) Add Web app -> copy config to: $EnvFile"
Write-Host "3) Enable Auth: Email + Google"
Write-Host "4) Firestore -> paste rules from deploy/firebase/firestore.rules"
Write-Host "5) GCP Credentials -> OAuth Web client -> VITE_GOOGLE_CLIENT_ID"
Write-Host ""
Write-Host "Guides:"
Write-Host "  deploy/FIREBASE_SETUP.md"
Write-Host "  deploy/GOOGLE_DRIVE_SETUP.md"
Write-Host ""

$open = Read-Host "Open Firebase Console in browser? (y/n)"
if ($open -eq "y") {
  Start-Process "https://console.firebase.google.com/"
  Start-Process "https://console.cloud.google.com/apis/credentials"
}

Write-Host ""
Write-Host "After filling frontend/.env, restart: npm run dev" -ForegroundColor Green
