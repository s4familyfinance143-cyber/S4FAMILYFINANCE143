$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$FRONTEND="$PROJECT\frontend"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FRONTEND_UI_POLISH_AUDIT_$TS"

New-Item -ItemType Directory -Force $VERIFY | Out-Null

Write-Host "1) Frontend folder check..." -ForegroundColor Cyan
if(-not (Test-Path $FRONTEND)){ throw "frontend folder not found" }

Write-Host "2) Package check..." -ForegroundColor Cyan
Get-Content "$FRONTEND\package.json" | Set-Content "$VERIFY\package.json.txt" -Encoding UTF8

Write-Host "3) Frontend file tree create..." -ForegroundColor Cyan
Get-ChildItem "$FRONTEND\src" -Recurse -File |
  Select-Object FullName,Length,LastWriteTime |
  Out-File "$VERIFY\frontend_src_tree.txt" -Encoding UTF8

Write-Host "4) Key files copy..." -ForegroundColor Cyan

$keyFiles=@(
  "$FRONTEND\src\App.jsx",
  "$FRONTEND\src\App.tsx",
  "$FRONTEND\src\main.jsx",
  "$FRONTEND\src\main.tsx",
  "$FRONTEND\src\App.css",
  "$FRONTEND\src\index.css"
)

foreach($f in $keyFiles){
  if(Test-Path $f){
    Copy-Item $f "$VERIFY\" -Force
    Write-Host "Copied:" $f -ForegroundColor Green
  }
}

Write-Host "5) Build test..." -ForegroundColor Cyan
Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\frontend_build_test.txt"
if($LASTEXITCODE -ne 0){ throw "Frontend build failed" }

@"
S4 FAMILY FINANCE 143 - FRONTEND UI POLISH AUDIT

STATUS: PASS
Time: $TS

VERIFY:
$VERIFY

NEXT:
Send this output to ChatGPT.
Then start UI polish:
- Login page polish
- Dashboard polish
- Mobile responsive polish
- Form/table/button polish
"@ | Set-Content "$VERIFY\FRONTEND_UI_POLISH_AUDIT_REPORT.txt" -Encoding UTF8

Write-Host "FRONTEND UI POLISH AUDIT PASS" -ForegroundColor Green
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow