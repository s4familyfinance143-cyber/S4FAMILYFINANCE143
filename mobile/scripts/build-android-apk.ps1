param(
  [ValidateSet("all", "x86_64", "arm64-v8a")]
  [string]$Arch = "all"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\setup-android-env.ps1"

Set-Location "$root\android"
$argsList = @("assembleDebug", "--no-daemon")
if ($Arch -ne "all") {
  $argsList += "-PreactNativeArchitectures=$Arch"
}

Write-Host "Building APK ($Arch) with GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
& .\gradlew.bat @argsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Get-ChildItem ".\app\build\outputs\apk\debug\*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apk) {
  Write-Host "APK_OK=$($apk.FullName) ($([math]::Round($apk.Length/1MB,1)) MB)"
} else {
  Write-Host "APK not found under app/build/outputs/apk/debug"
  exit 1
}
