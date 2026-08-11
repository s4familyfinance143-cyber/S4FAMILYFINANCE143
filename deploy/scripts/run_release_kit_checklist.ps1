# Release kit readiness checklist (host-side; no real VPS deploy).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "deploy\docker\docker-compose.production.yml"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$failed = 0
$kit = @(
  "deploy\README_RELEASE_KIT.md",
  "deploy\docker\.env.production.example",
  "deploy\docker\.env.staging.example",
  "deploy\scripts\package_release.ps1",
  "deploy\scripts\package_release.sh",
  "deploy\scripts\vps_go_live_deploy.sh",
  "deploy\scripts\verify_live.sh",
  "deploy\scripts\verify_live.ps1",
  "deploy\scripts\validate_production_packaging.ps1",
  "deploy\nginx\s4_family_finance_nginx.ssl.example.conf"
)

foreach ($rel in $kit) {
  $path = Join-Path $Root $rel
  if (Test-Path $path) { Write-Host "OK  $rel" }
  else { Write-Host "MISS $rel"; $failed++ }
}

Write-Host ""
Write-Host "--- packaging validate ---"
& powershell -ExecutionPolicy Bypass -File (Join-Path $Root "deploy\scripts\validate_production_packaging.ps1")
if ($LASTEXITCODE -ne 0) { $failed++ }

Write-Host ""
if ($failed -gt 0) {
  Write-Host "FAIL release_kit_checklist ($failed)"
  exit 1
}
Write-Host "PASS release_kit_checklist"
Write-Host "Next: package_release.ps1 → stage on VM → fill secrets → vps_go_live_deploy.sh on VPS."
