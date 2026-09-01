# Build Android APK (Capacitor)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Frontend = Join-Path $Root "frontend"

Write-Host "==> Icons + Capacitor web build"
Set-Location $Frontend
npm run build:android

Write-Host "==> Gradle assembleDebug"
Set-Location (Join-Path $Frontend "android")
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: Java JDK 21 required. Install Android Studio or JDK 21." -ForegroundColor Red
  exit 1
}
.\gradlew.bat assembleDebug

$Apk = Join-Path $Frontend "android\app\build\outputs\apk\debug\app-debug.apk"
$Out = Join-Path $Root "deploy\dist\S4-Family-Finance-143-debug.apk"
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
Copy-Item $Apk $Out -Force
Write-Host "PASS APK: $Out" -ForegroundColor Green
