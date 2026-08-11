# Live verification from Windows host (VM NAT or public URL). Does not print tokens.
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$Email = $env:S4_VERIFY_EMAIL,
  [string]$Password = $env:S4_VERIFY_PASSWORD
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")
$failed = 0

function Pass([string]$msg) { Write-Host "PASS  $msg" }
function Fail([string]$msg) { Write-Host "FAIL  $msg"; $script:failed++ }

Write-Host "Base URL: $BaseUrl"

try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing -TimeoutSec 30
  if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 304) { Pass "frontend HTTP $($r.StatusCode)" }
  else { Fail "frontend HTTP $($r.StatusCode)" }
} catch {
  Fail "frontend $($_.Exception.Message)"
}

try {
  $health = (Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 30).Content
  if ($health -match '"status"\s*:\s*"ok"') { Pass "api /health"; Write-Host "      $health" }
  else { Fail "api /health ($health)" }
} catch {
  Fail "api /health $($_.Exception.Message)"
}

# /api/ root may 404; openapi/docs or prior /health already proves the proxy.
try {
  $api = Invoke-WebRequest -Uri "$BaseUrl/api/openapi.json" -UseBasicParsing -TimeoutSec 30
  Pass "api proxy reachable HTTP $($api.StatusCode)"
} catch {
  $code = $null
  try { $code = [int]$_.Exception.Response.StatusCode } catch { }
  if ($code -and $code -ge 200) { Pass "api proxy reachable HTTP $code" }
  elseif ($health -match '"status"') { Pass "api proxy reachable (via /health)" }
  else { Fail "api proxy unreachable" }
}

if ($Email -and $Password) {
  try {
    $body = @{ email = $Email; password = $Password } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 30
    if (-not $login.access_token) { Fail "auth login (no access_token)" }
    else {
      Pass "auth login (token not printed)"
      $headers = @{ Authorization = "Bearer $($login.access_token)" }
      $me = Invoke-RestMethod -Uri "$BaseUrl/api/auth/me" -Headers $headers -TimeoutSec 30
      if ($me.email) { Pass "auth /me" } else { Fail "auth /me" }
      $families = Invoke-RestMethod -Uri "$BaseUrl/api/families" -Headers $headers -TimeoutSec 30
      if ($families -is [System.Array] -or $families -is [System.Collections.IEnumerable]) { Pass "families list" }
      else { Fail "families list" }
    }
  } catch {
    Fail "auth smoke $($_.Exception.Message)"
  }
} else {
  Write-Host "SKIP  login smoke (pass -Email/-Password or set S4_VERIFY_EMAIL / S4_VERIFY_PASSWORD)"
}

if ($failed -gt 0) {
  Write-Host "FAIL verify_live ($failed)"
  exit 1
}
Write-Host "PASS verify_live"
