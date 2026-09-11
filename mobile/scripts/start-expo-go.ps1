# Expo Go via USB (adb reverse) — Windows-safe
# Phone cannot reach PC LAN IP if firewall blocks; USB reverse + 127.0.0.1 works.
$ErrorActionPreference = "Stop"
$env:EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK = "1"
$env:EXPO_NO_TELEMETRY = "1"
$env:CHOKIDAR_USEPOLLING = "true"
# Metro on S: drive needs a large heap (avoids OOM during full crawl).
if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = "--max-old-space-size=8192"
}
if (-not $env:EXPO_PUBLIC_API_BASE_URL) {
  $env:EXPO_PUBLIC_API_BASE_URL = "http://127.0.0.1:8000"
}
# Manifest host the phone will fetch (must match adb reverse target)
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"

$port = 8082
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
Write-Host ""
Write-Host "Expo Go USB path (polished)" -ForegroundColor Cyan
Write-Host "1) API base: $($env:EXPO_PUBLIC_API_BASE_URL)  (paths already include /api/v1)"
Write-Host "2) USB reverse:"
Write-Host "   & `"$adb`" reverse tcp:$port tcp:$port"
Write-Host "   & `"$adb`" reverse tcp:8000 tcp:8000"
Write-Host "3) Open on phone: exp://127.0.0.1:$port"
Write-Host "4) If queue_uuid / DB errors: clear Expo Go app data (uses go_v4 DB)"
Write-Host "5) Prefer native APK for SQLCipher runtime proof"
Write-Host ""

if (Test-Path $adb) {
  try {
    & $adb reverse "tcp:$port" "tcp:$port" 2>$null
    & $adb reverse tcp:8000 tcp:8000 2>$null
    Write-Host "adb reverse applied (if a device was connected)." -ForegroundColor Green
  } catch {
    Write-Host "adb reverse skipped — connect phone then re-run reverses." -ForegroundColor Yellow
  }
}

npx expo start --port $port --lan @args
