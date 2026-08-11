# Point live document vault at local MinIO and restart API on :8000.
# Does not change DATABASE_URL / SMTP / FCM settings.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root "storage\live_switch_backups\$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$EnvFile = Join-Path $Root ".env"
$Cutover = Join-Path $Root ".env.minio.local.cutover"
$MinioCompose = Join-Path (Split-Path -Parent $Root) "deploy\minio\docker-compose.yml"

if (-not (Test-Path $Cutover)) { throw "Missing $Cutover" }
if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }
if (-not (Test-Path $MinioCompose)) { throw "Missing $MinioCompose" }

Write-Host "Backup dir: $BackupDir"
Copy-Item $EnvFile (Join-Path $BackupDir ".env")
Write-Host "OK .env backup"

Write-Host "Ensuring MinIO..."
docker compose -f $MinioCompose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

$deadline = (Get-Date).AddSeconds(40)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:9002/minio/health/live" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 800
  }
}
if (-not $ready) { throw "MinIO not ready on :9002" }
Write-Host "OK MinIO ready"

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
  if ($trim -match '^#\s*(DOCUMENT_VAULT_BACKEND|S3_ENDPOINT_URL|S3_BUCKET|S3_ACCESS_KEY|S3_SECRET_KEY|S3_REGION)=') {
    return
  }
  $out.Add($line)
}
foreach ($k in $cutMap.Keys) {
  if (-not $seen.ContainsKey($k)) { $out.Add("$k=$($cutMap[$k])") }
}
Set-Content -Path $EnvFile -Value $out -Encoding UTF8
Write-Host "OK .env MinIO vault keys updated"

$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
& $py -c "import boto3" 2>$null
if ($LASTEXITCODE -ne 0) {
  & $py -m pip install "boto3>=1.34" -q
  if ($LASTEXITCODE -ne 0) { throw "pip install boto3 failed" }
}

Write-Host "Restarting API on :8000..."
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {}
  }
Start-Sleep -Seconds 2

$logDir = Join-Path $Root "storage\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "uvicorn.minio.$Stamp.out.log"
$errLog = Join-Path $logDir "uvicorn.minio.$Stamp.err.log"
Remove-Item Env:AUTO_CREATE_TABLES -ErrorAction SilentlyContinue

Start-Process -FilePath $py `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden

$email = "owner@s4family.com"
$password = "S4Family143!"
$apiReady = $false
$deadline = (Get-Date).AddSeconds(55)
while ((Get-Date) -lt $deadline) {
  try {
    $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/auth/login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 5
    $headers = @{ Authorization = "Bearer $($login.access_token)" }
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/phase16/vault-status" -Headers $headers -TimeoutSec 5
    if ($status.backend -eq "s3" -and $status.s3_configured -eq $true) {
      $ensure = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/phase16/vault-ensure-bucket" -Method POST -Headers $headers -TimeoutSec 20
      Write-Host ($status | ConvertTo-Json -Compress)
      Write-Host ("ensure: " + ($ensure | ConvertTo-Json -Compress))
      $apiReady = $true
      break
    }
    Write-Host "waiting s3 backend... backend=$($status.backend) s3=$($status.s3_configured)"
  } catch {
    Start-Sleep -Milliseconds 900
  }
}
if (-not $apiReady) {
  if (Test-Path $errLog) { Get-Content $errLog -Tail 40 }
  throw "API did not report vault backend=s3"
}

Write-Host "PASS MinIO vault live cutover (backend=s3)"
Write-Host "Console: http://127.0.0.1:9003"
Write-Host "Backup: $BackupDir"
