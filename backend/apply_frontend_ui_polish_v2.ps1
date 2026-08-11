$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$FRONTEND="$PROJECT\frontend"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FRONTEND_UI_POLISH_V2_$TS"
$BACKUP="$PROJECT\BACKUP_FRONTEND_BEFORE_UI_POLISH_V2_$TS"

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Write-Host "1) Backup current UI files..." -ForegroundColor Cyan
Copy-Item "$FRONTEND\src\App.css" "$BACKUP\App.css" -Force
Copy-Item "$FRONTEND\src\index.css" "$BACKUP\index.css" -Force
Copy-Item "$FRONTEND\src\App.jsx" "$BACKUP\App.jsx" -Force

Write-Host "2) Add UI polish V2 CSS overrides..." -ForegroundColor Cyan

@'

/* =========================
   S4 UI POLISH V2 OVERRIDES
   ========================= */

html {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 212, 42, 0.55) rgba(7, 26, 47, 0.35);
}

body::-webkit-scrollbar,
.sidebar::-webkit-scrollbar,
.modal-card::-webkit-scrollbar {
  width: 8px;
}

body::-webkit-scrollbar-track,
.sidebar::-webkit-scrollbar-track,
.modal-card::-webkit-scrollbar-track {
  background: rgba(7, 26, 47, 0.25);
}

body::-webkit-scrollbar-thumb,
.sidebar::-webkit-scrollbar-thumb,
.modal-card::-webkit-scrollbar-thumb {
  background: rgba(255, 212, 42, 0.55);
  border-radius: 999px;
}

.sidebar {
  width: 264px;
  min-width: 264px;
  padding: 18px 14px;
  gap: 0;
}

.sidebar h2 {
  font-size: 24px;
  padding: 16px 10px;
  margin-bottom: 18px;
}

.sidebar button {
  min-height: 52px;
  padding: 12px 16px;
  margin-bottom: 9px;
  font-size: 15px;
  border-radius: 15px;
}

.main-content {
  width: calc(100% - 264px);
  padding: 24px 28px 40px;
}

.topbar {
  min-height: 132px;
  padding: 22px 26px;
  margin-bottom: 24px;
  border-radius: 26px;
}

.topbar h1 {
  font-size: clamp(34px, 3.6vw, 46px);
}

.topbar p {
  font-size: 17px;
  margin-top: 8px;
}

.topbar button {
  min-height: 58px;
  min-width: 128px;
}

section > h2 {
  font-size: 28px;
  margin: 6px 0 18px;
}

.grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 18px;
  margin-bottom: 26px;
}

.card {
  min-height: 132px;
  padding: 22px 24px;
  border-radius: 23px;
}

.card span {
  font-size: 16px;
  margin-bottom: 12px;
}

.card strong {
  font-size: clamp(25px, 2.35vw, 30px);
}

.panel {
  padding: 26px 28px;
  border-radius: 26px;
  margin-top: 26px;
}

.panel h2,
.panel h3 {
  font-size: 28px;
  margin-bottom: 20px;
}

.row {
  min-height: 58px;
  padding: 16px 20px;
  border-radius: 17px;
  grid-template-columns: minmax(220px, 2fr) minmax(110px, 1fr) minmax(150px, 1fr);
}

.row strong {
  font-size: 15px;
}

.wallet-form,
.transaction-form,
.savings-form {
  margin-top: 14px;
}

input,
select,
textarea {
  font-size: 16px;
}

.login-card {
  max-width: 500px;
}

@media (min-width: 1280px) {
  .main-content {
    padding-right: 32px;
  }

  .grid {
    grid-template-columns: repeat(4, minmax(210px, 1fr));
  }
}

@media (max-width: 900px) {
  .sidebar {
    width: 100%;
    min-width: 100%;
    height: auto;
    max-height: none;
    position: relative;
    padding: 14px;
  }

  .sidebar h2 {
    font-size: 22px;
  }

  .main-content {
    width: 100%;
    padding: 14px;
  }

  .topbar {
    min-height: auto;
    padding: 20px;
  }

  .topbar button {
    width: 100%;
  }

  .card {
    min-height: 118px;
  }

  .panel {
    padding: 20px;
  }
}

@media (max-width: 520px) {
  .sidebar button {
    min-height: 48px;
    font-size: 14px;
  }

  .topbar h1 {
    font-size: 28px;
  }

  .card strong {
    font-size: 24px;
  }

  .row {
    padding: 14px;
  }
}
'@ | Add-Content "$FRONTEND\src\App.css" -Encoding UTF8

Write-Host "3) Build test..." -ForegroundColor Cyan
Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\frontend_ui_polish_v2_build.txt"
if($LASTEXITCODE -ne 0){ throw "Frontend UI polish V2 build failed" }

@"
S4 FAMILY FINANCE 143 - FRONTEND UI POLISH V2 REPORT

STATUS: PASS
Time: $TS

CHANGED:
- Sidebar size improved
- Sidebar/browser scrollbar polished
- Dashboard cards compacted
- Header/topbar compacted
- Wallet rows spacing improved
- Mobile responsive override improved

BACKUP:
$BACKUP

VERIFY:
$VERIFY
"@ | Set-Content "$VERIFY\FRONTEND_UI_POLISH_V2_REPORT.txt" -Encoding UTF8

Write-Host "FRONTEND UI POLISH V2 PASS" -ForegroundColor Green
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow