$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$BACKUPROOT=($PROJECT -replace "-FINAL$","-FINAL-BACKUPS")
$TS=Get-Date -Format "yyyyMMdd-HHmmss"

$HANDOVER="$PROJECT\FINAL_HANDOVER_PACKAGE_$TS"
$OUTZIP="$BACKUPROOT\S4-FAMILY-FINANCE-143-FINAL-HANDOVER-PACKAGE-$TS.zip"

New-Item -ItemType Directory -Force $HANDOVER | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\01_INSTALLER_EXE" | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\02_RELEASE_ZIPS" | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\03_TEST_PROOF_REPORTS" | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\04_GUIDES" | Out-Null
New-Item -ItemType Directory -Force "$HANDOVER\05_HASHES" | Out-Null
New-Item -ItemType Directory -Force $BACKUPROOT | Out-Null

Write-Host "1) Find final V6 installer EXE..." -ForegroundColor Cyan

$installer=Get-ChildItem $BACKUPROOT -File -Filter "S4-FAMILY-FINANCE-143-WINDOWS-SETUP-INSTALLER-CLEAN-V6-*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $installer){
  throw "Final V6 installer EXE not found in $BACKUPROOT"
}

Copy-Item $installer.FullName "$HANDOVER\01_INSTALLER_EXE\" -Force

Write-Host "Installer copied:" $installer.FullName -ForegroundColor Green

Write-Host "2) Copy release ZIPs if found..." -ForegroundColor Cyan

$releaseZips=@(
  "S4-FAMILY-FINANCE-143-FINAL-PRODUCTION-RELEASE-LOCKED-*.zip",
  "S4-FAMILY-FINANCE-143-PRODUCTION-PACKAGING-DEPLOYMENT-SETUP-FINAL-*.zip"
)

foreach($pattern in $releaseZips){
  $z=Get-ChildItem $BACKUPROOT -File -Filter $pattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if($z){
    Copy-Item $z.FullName "$HANDOVER\02_RELEASE_ZIPS\" -Force
    Write-Host "Copied:" $z.Name -ForegroundColor Green
  } else {
    Write-Host "Not found:" $pattern -ForegroundColor Yellow
  }
}

Write-Host "3) Copy proof report folders..." -ForegroundColor Cyan

$reportPatterns=@(
  "FINAL_PRODUCTION_FULL_SYSTEM_QA_RELEASE_LOCK_*",
  "PRODUCTION_PACKAGING_FINISH_CHECK_*",
  "WINDOWS_EXE_INSTALLER_CLEAN_COMPILE_V5_*",
  "WINDOWS_INSTALLER_V6_SAME_PC_TEST_*",
  "WINDOWS_INSTALLER_NEW_PC_RUNTIME_TEST_*",
  "POSTGRESQL_PRODUCTION_DEPLOYMENT_NEW_PC_TEST_*"
)

foreach($pattern in $reportPatterns){
  $folder=Get-ChildItem $PROJECT -Directory -Filter $pattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if($folder){
    Copy-Item $folder.FullName "$HANDOVER\03_TEST_PROOF_REPORTS\$($folder.Name)" -Recurse -Force
    Write-Host "Copied report folder:" $folder.Name -ForegroundColor Green
  } else {
    Write-Host "Report folder not found:" $pattern -ForegroundColor Yellow
  }
}

Write-Host "4) Create guides..." -ForegroundColor Cyan

@"
# S4 FAMILY FINANCE 143 - FINAL STATUS

## Current Locked Status

- Final Production Full System QA / Release Lock: LOCKED
- Production Packaging / Installer / Deployment Setup: LOCKED
- Windows Clean EXE Installer Compile V5: LOCKED
- Windows Installer V6 Same PC Install Test: LOCKED
- Windows Installer New PC Runtime Test: LOCKED
- PostgreSQL Production Deployment New PC Test: LOCKED

## Final Installer

Use this EXE:

01_INSTALLER_EXE\$($installer.Name)

## Important Note

This is the Windows/backend production handover package.

Mobile apps are not included yet:
- Android APK: not started
- iPhone IPA: not started

## Main Stack

- Backend: FastAPI
- Production DB: PostgreSQL
- Local runtime test: SQLite mode
- Frontend build: Vite dist
- Installer: Inno Setup per-user V6 installer
"@ | Set-Content "$HANDOVER\04_GUIDES\FINAL_STATUS.md" -Encoding UTF8

@"
# WINDOWS LOCAL SQLITE INSTALL GUIDE

## 1. Install

Run:

$($installer.Name)

Recommended install mode:
- Normal double click
- Or silent install:

````powershell
.\$($installer.Name) /VERYSILENT /SUPPRESSMSGBOXES /NORESTART