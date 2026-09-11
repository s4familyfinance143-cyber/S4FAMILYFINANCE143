# Sets Android SDK + JDK env for this PowerShell session (SQLCipher native builds).
$ErrorActionPreference = "Stop"

$sdk = $env:ANDROID_HOME
if (-not $sdk -or -not (Test-Path $sdk)) {
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk",
    "C:\Android\Sdk"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $sdk = $c; break }
  }
}

if (-not $sdk -or -not (Test-Path $sdk)) {
  throw "Android SDK not found. Install Android Studio SDK first."
}

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

# Short Gradle home avoids Windows 260-char path failures under Cursor sandbox caches.
if (-not $env:GRADLE_USER_HOME -or $env:GRADLE_USER_HOME -match "cursor-sandbox-cache") {
  New-Item -ItemType Directory -Force -Path "C:\g" | Out-Null
  $env:GRADLE_USER_HOME = "C:\g"
}

$jdk = $env:JAVA_HOME
if (-not $jdk -or -not (Test-Path $jdk)) {
  $jdkCandidates = @(
    "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot",
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Java\jdk-17"
  )
  foreach ($c in $jdkCandidates) {
    if (Test-Path $c) { $jdk = $c; break }
  }
}
if ($jdk -and (Test-Path $jdk)) {
  $env:JAVA_HOME = $jdk
}

$parts = @(
  "$sdk\platform-tools",
  "$sdk\emulator",
  "$sdk\cmdline-tools\latest\bin"
)
if ($env:JAVA_HOME) { $parts += "$env:JAVA_HOME\bin" }
$env:Path = (($parts + ($env:Path -split ";")) | Where-Object { $_ } | Select-Object -Unique) -join ";"

Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
adb version | Select-Object -First 1
Write-Host "Ready. Next: npm run prebuild:native ; npm run android:native"
Write-Host "Tip (emulator): .\\android\\gradlew.bat assembleDebug -PreactNativeArchitectures=x86_64"
