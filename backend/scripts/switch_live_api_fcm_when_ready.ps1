# Enable live FCM only when a real Firebase service-account JSON is present.
# Refuses to set NOTIFICATION_FCM_ENABLED=true without the file (no fake push).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$EnvFile = Join-Path $Root ".env"
$Cutover = Join-Path $Root ".env.fcm.local.cutover"
$DefaultJson = Join-Path $Root "secrets\firebase-service-account.json"
$JsonPath = $env:FCM_JSON_PATH
if (-not $JsonPath) { $JsonPath = $DefaultJson }

if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }
if (-not (Test-Path $Cutover)) { throw "Missing $Cutover" }

Write-Host "== FCM when-ready cutover =="
Write-Host "credentials expected at: $JsonPath"

if (-not (Test-Path $JsonPath)) {
  Write-Host ""
  Write-Host "BLOCKED: Firebase service-account JSON not found."
  Write-Host "1) Firebase Console → Project settings → Service accounts → Generate private key"
  Write-Host "2) Save as: $DefaultJson"
  Write-Host "   (or set FCM_JSON_PATH to your file and re-run)"
  Write-Host "3) Re-run this script"
  Write-Host ""
  Write-Host "Until then FCM stays disabled (honest can_send/configured=false)."
  exit 2
}

# Read project_id from JSON if cutover still has placeholder
$json = Get-Content $JsonPath -Raw | ConvertFrom-Json
$projectId = [string]$json.project_id
if (-not $projectId) { throw "JSON missing project_id: $JsonPath" }

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root "storage\live_switch_backups\$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item $EnvFile (Join-Path $BackupDir ".env")
Write-Host "OK .env backup -> $BackupDir"

# Ensure package
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
& $py -m pip install "firebase-admin>=6.5.0" -q
if ($LASTEXITCODE -ne 0) { throw "pip install firebase-admin failed" }

# Resolve path stored in .env (prefer relative under backend)
$relOrAbs = "secrets/firebase-service-account.json"
$dest = Join-Path $Root $relOrAbs
if ((Resolve-Path $JsonPath).Path -ne (Resolve-Path $dest -ErrorAction SilentlyContinue).Path) {
  New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
  Copy-Item $JsonPath $dest -Force
  Write-Host "OK copied credentials -> $dest"
}
$credForEnv = $relOrAbs

$cutMap = @{
  "NOTIFICATION_FCM_ENABLED" = "true"
  "FCM_PROJECT_ID" = $projectId
  "FCM_CREDENTIALS_PATH" = $credForEnv
}

$out = New-Object System.Collections.Generic.List[string]
$seen = @{}
Get-Content $EnvFile | ForEach-Object {
  $line = $_
  $trim = $line.Trim()
  if ($trim -and -not $trim.StartsWith("#") -and $trim.Contains("=")) {
    $idx = $trim.IndexOf("=")
    $k = $trim.Substring(0, $idx).Trim()
    if ($cutMap.ContainsKey($k)) {
      $out.Add("$k=$($cutMap[$k])")
      $seen[$k] = $true
      return
    }
  }
  if ($trim -match '^#\s*(NOTIFICATION_FCM_ENABLED|FCM_PROJECT_ID|FCM_CREDENTIALS_PATH)=') {
    return
  }
  $out.Add($line)
}
foreach ($k in $cutMap.Keys) {
  if (-not $seen.ContainsKey($k)) { $out.Add("$k=$($cutMap[$k])") }
}
Set-Content -Path $EnvFile -Value $out -Encoding UTF8
Write-Host "OK .env FCM keys updated (project_id=$projectId)"

Write-Host "Restarting API on :8000..."
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {}
  }
Start-Sleep -Seconds 2

$logDir = Join-Path $Root "storage\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "uvicorn.fcm.$Stamp.out.log"
$errLog = Join-Path $logDir "uvicorn.fcm.$Stamp.err.log"
Remove-Item Env:AUTO_CREATE_TABLES -ErrorAction SilentlyContinue

Start-Process -FilePath $py `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden

# Login + fcm-status check
$ready = $false
$deadline = (Get-Date).AddSeconds(55)
$email = "owner@s4family.com"
$password = "S4Family143!"
while ((Get-Date) -lt $deadline) {
  try {
    $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/auth/login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 5
    $headers = @{ Authorization = "Bearer $($login.access_token)" }
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/notifications/fcm-status" -Headers $headers -TimeoutSec 5
    if ($status.configured -eq $true) {
      $ready = $true
      $status | ConvertTo-Json -Compress | Write-Host
      break
    }
    Write-Host "waiting configured... $($status.note)"
  } catch {
    Start-Sleep -Milliseconds 900
  }
}
if (-not $ready) {
  if (Test-Path $errLog) { Get-Content $errLog -Tail 40 }
  throw "API did not report FCM configured=true"
}

Write-Host "PASS FCM cutover (configured=true)"
Write-Host "NOTE: test-push still needs a real device token from the mobile/web client."
Write-Host "Backup: $BackupDir"
