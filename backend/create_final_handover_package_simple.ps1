$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$BACKUPROOT=($PROJECT -replace "-FINAL$","-FINAL-BACKUPS")
$TS=Get-Date -Format "yyyyMMdd-HHmmss"

$HANDOVER="$PROJECT\FINAL_HANDOVER_PACKAGE_$TS"
$OUTZIP="$BACKUPROOT\S4-FAMILY-FINANCE-143-FINAL-HANDOVER-PACKAGE-$TS.zip"

New-Item -ItemType Directory -Force "$HANDOVER\INSTALLER" | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\GUIDES" | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\PROOF" | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

Write-Host "1) Final installer khuja hocce..." -ForegroundColor Cyan

$installer=Get-ChildItem $BACKUPROOT -File -Filter "S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V6-*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $installer){
  throw "Final installer EXE pawa jay nai"
}

Copy-Item $installer.FullName "$HANDOVER\INSTALLER\" -Force

Write-Host "2) Test proof folders copy hocce..." -ForegroundColor Cyan

$patterns=@(
  "WINDOWS_INSTALLER_NEW_PC_RUNTIME_TEST_*",
  "POSTGRESQL_PRODUCTION_DEPLOYMENT_NEW_PC_TEST_*",
  "WINDOWS_INSTALLER_V6_SAME_PC_TEST_*"
)

foreach($p in $patterns){
  $f=Get-ChildItem $PROJECT -Directory -Filter $p -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if($f){
    Copy-Item $f.FullName "$HANDOVER\PROOF\$($f.Name)" -Recurse -Force
  }
}

Write-Host "3) Guide banano hocce..." -ForegroundColor Cyan

@"
S4 FAMILY FINANCE 143 - FINAL HANDOVER

Final Installer:
$($installer.Name)

Status:
- Windows Installer: PASS
- New PC Runtime Test: PASS
- PostgreSQL Production Test: PASS

Important:
- Android APK ekhono banano hoy nai
- iPhone IPA ekhono banano hoy nai

Install:
1. INSTALLER folder open koro
2. EXE double click koro
3. Install complete koro

PostgreSQL:
- PostgreSQL 17 tested
- Alembic migration passed
- Backend root 200 passed
- OpenAPI 200 passed
"@ | Set-Content "$HANDOVER\GUIDES\README_FINAL.txt" -Encoding UTF8

Write-Host "4) Hash banano hocce..." -ForegroundColor Cyan

Get-FileHash $installer.FullName -Algorithm SHA256 |
  Format-List |
  Out-File "$HANDOVER\INSTALLER_SHA256.txt" -Encoding UTF8

Write-Host "5) Final ZIP banano hocce..." -ForegroundColor Cyan

Compress-Archive -Path "$HANDOVER\*" -DestinationPath $OUTZIP -Force

$zip=Get-Item $OUTZIP

Write-Host "FINAL HANDOVER PACKAGE PASS" -ForegroundColor Green
Write-Host "Folder:" -ForegroundColor Yellow
Write-Host $HANDOVER -ForegroundColor Yellow
Write-Host "ZIP:" -ForegroundColor Yellow
Write-Host $OUTZIP -ForegroundColor Yellow
Write-Host "ZIP size:" -ForegroundColor Yellow
Write-Host "$($zip.Length) bytes" -ForegroundColor Yellow