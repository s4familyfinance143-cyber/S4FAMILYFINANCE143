# Point live backend .env SMTP at local Mailpit and restart API on :8000.
# Does not change DATABASE_URL / Postgres settings.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root "storage\live_switch_backups\$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$EnvFile = Join-Path $Root ".env"
$Cutover = Join-Path $Root ".env.smtp.local.cutover"
$MailpitCompose = Join-Path (Split-Path -Parent $Root) "deploy\mailpit\docker-compose.yml"

if (-not (Test-Path $Cutover)) { throw "Missing $Cutover" }
if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }
if (-not (Test-Path $MailpitCompose)) { throw "Missing $MailpitCompose" }

Write-Host "Backup dir: $BackupDir"
Copy-Item $EnvFile (Join-Path $BackupDir ".env")
Write-Host "OK .env backup"

Write-Host "Ensuring Mailpit..."
docker compose -f $MailpitCompose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

$deadline = (Get-Date).AddSeconds(40)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8025/api/v1/info" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 800
  }
}
if (-not $ready) { throw "Mailpit UI/API not ready on :8025" }
Write-Host "OK Mailpit ready"

$cutMap = @{}
Get-Content $Cutover | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $cutMap[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1)
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
  if ($trim -match '^#\s*(SMTP_|AUTH_EMAIL_ENABLED|NOTIFICATION_EMAIL_ENABLED|APP_PUBLIC_URL)=') {
    return
  }
  $out.Add($line)
}
foreach ($k in $cutMap.Keys) {
  if (-not $seen.ContainsKey($k)) {
    $out.Add("$k=$($cutMap[$k])")
  }
}
Set-Content -Path $EnvFile -Value $out -Encoding UTF8
Write-Host "OK .env SMTP keys updated"

Write-Host "Restarting API on :8000..."
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {}
  }
Start-Sleep -Seconds 2

$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$logDir = Join-Path $Root "storage\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "uvicorn.mailpit.$Stamp.out.log"
$errLog = Join-Path $logDir "uvicorn.mailpit.$Stamp.err.log"

Remove-Item Env:AUTO_CREATE_TABLES -ErrorAction SilentlyContinue

Start-Process -FilePath $py `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden

$apiReady = $false
$deadline = (Get-Date).AddSeconds(50)
while ((Get-Date) -lt $deadline) {
  try {
    $body = (Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/auth/email-status" -UseBasicParsing -TimeoutSec 2).Content
    $j = $body | ConvertFrom-Json
    if ($j.can_send -eq $true) {
      $apiReady = $true
      Write-Host $body
      break
    }
    Write-Host "waiting can_send... $($j.can_send)"
    Start-Sleep -Milliseconds 900
  } catch {
    Start-Sleep -Milliseconds 900
  }
}
if (-not $apiReady) {
  Write-Host "API logs: $outLog / $errLog"
  if (Test-Path $errLog) { Get-Content $errLog -Tail 40 }
  throw "API did not report can_send=true"
}

Write-Host "PASS SMTP Mailpit cutover (can_send=true)"
Write-Host "Inbox: http://127.0.0.1:8025"
Write-Host "Backup: $BackupDir"
