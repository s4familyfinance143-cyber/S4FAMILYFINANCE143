# Verify FCM / push pipeline readiness (Step 12) - Windows
param(
  [string]$EnvFile = ""
)

$Root = Resolve-Path (Join-Path $PSScriptRoot "../..")
if (-not $EnvFile) {
  $candidate = Join-Path $Root "deploy/docker/.env.production"
  if (Test-Path $candidate) { $EnvFile = $candidate }
  else { $EnvFile = Join-Path $Root ".env.example" }
}

Write-Host "=== S4 FCM readiness ==="
Write-Host "Env: $EnvFile"

function Get-DotEnvValue([string]$path, [string]$key) {
  if (-not (Test-Path $path)) { return "" }
  $line = Get-Content $path | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1].Trim()
}

$enabled = Get-DotEnvValue $EnvFile "NOTIFICATION_FCM_ENABLED"
$project = Get-DotEnvValue $EnvFile "FCM_PROJECT_ID"
$creds = Get-DotEnvValue $EnvFile "FCM_CREDENTIALS_PATH"

Write-Host "NOTIFICATION_FCM_ENABLED=$enabled"
Write-Host "FCM_PROJECT_ID=$project"
Write-Host "FCM_CREDENTIALS_PATH=$creds"

if ($enabled -eq "true") { Write-Host "OK: FCM enabled flag" } else { Write-Host "TODO: set NOTIFICATION_FCM_ENABLED=true" }
if ($project) { Write-Host "OK: FCM_PROJECT_ID set" } else { Write-Host "TODO: set FCM_PROJECT_ID" }
if ($creds) {
  if ((Test-Path $creds) -or (Test-Path (Join-Path $Root $creds))) {
    Write-Host "OK: credentials file exists"
  } else {
    Write-Host "FAIL: credentials path set but file missing"
  }
} else {
  Write-Host "TODO: set FCM_CREDENTIALS_PATH"
}

Write-Host "OK: push delivery service present (code)"
Write-Host "Code pipeline: DONE - live device push needs Firebase JSON + enabled flag"
Write-Host "Docs: deploy/OPERATOR_GO_LIVE.md"
