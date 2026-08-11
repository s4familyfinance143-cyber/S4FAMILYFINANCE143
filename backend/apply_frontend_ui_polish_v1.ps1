$ErrorActionPreference="Stop"

$PROJECT=(Get-Location).Path
$FRONTEND="$PROJECT\frontend"
$TS=Get-Date -Format "yyyyMMdd-HHmmss"
$VERIFY="$PROJECT\FRONTEND_UI_POLISH_V1_$TS"
$BACKUP="$PROJECT\BACKUP_FRONTEND_BEFORE_UI_POLISH_V1_$TS"

New-Item -ItemType Directory -Force $VERIFY | Out-Null
New-Item -ItemType Directory -Force $BACKUP | Out-Null

Write-Host "1) Backup old frontend files..." -ForegroundColor Cyan
Copy-Item "$FRONTEND\src\App.jsx" "$BACKUP\App.jsx" -Force
Copy-Item "$FRONTEND\src\App.css" "$BACKUP\App.css" -Force
Copy-Item "$FRONTEND\src\index.css" "$BACKUP\index.css" -Force
Copy-Item "$FRONTEND\src\main.jsx" "$BACKUP\main.jsx" -Force

Write-Host "2) Add active sidebar button style support..." -ForegroundColor Cyan

$appPath="$FRONTEND\src\App.jsx"
$app=Get-Content $appPath -Raw

$menus=@(
  @("dashboard","Dashboard"),
  @("wallets","Wallets"),
  @("transactions","Transactions"),
  @("savings","Savings"),
  @("loans","Loans"),
  @("budgets","Budgets"),
  @("recurring","Recurring"),
  @("goals","Goals"),
  @("reports","Reports"),
  @("settings","Settings")
)

foreach($m in $menus){
  $key=$m[0]
  $label=$m[1]
  $old='<button onClick={() => setActiveMenu("' + $key + '")}>' + $label + '</button>'
  $new='<button className={activeMenu === "' + $key + '" ? "nav-active" : ""} onClick={() => setActiveMenu("' + $key + '")}>' + $label + '</button>'
  $app=$app.Replace($old,$new)
}

Set-Content $appPath $app -Encoding UTF8

Write-Host "3) Replace App.css with polished UI..." -ForegroundColor Cyan

@'
:root {
  --bg-root: #07140f;
  --bg-root-2: #0b1d17;
  --bg-sidebar: #071a2f;
  --bg-card: rgba(12, 31, 69, 0.92);
  --bg-card-soft: rgba(8, 25, 53, 0.92);
  --bg-input: #07111f;
  --border: rgba(125, 181, 255, 0.22);
  --border-strong: rgba(255, 212, 42, 0.38);
  --gold: #ffd42a;
  --gold-2: #ffe985;
  --blue: #2f65e5;
  --blue-2: #5b8cff;
  --green: #22c55e;
  --red: #ef4444;
  --purple: #7c3aed;
  --text: #f8fafc;
  --muted: #9fb7d9;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
  --radius: 22px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
}

body {
  background:
    radial-gradient(circle at top left, rgba(34, 197, 94, 0.20), transparent 30%),
    radial-gradient(circle at top right, rgba(47, 101, 229, 0.24), transparent 34%),
    linear-gradient(135deg, var(--bg-root), var(--bg-root-2));
  color: var(--text);
  font-family: Inter, Segoe UI, Arial, sans-serif;
}

button,
input,
select,
textarea {
  font-family: inherit;
}

button {
  border: none;
  cursor: pointer;
  transition: transform 0.18s ease, filter 0.18s ease, background 0.18s ease, border 0.18s ease;
}

button:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
}

button:active {
  transform: translateY(0);
}

input,
select,
textarea {
  outline: none;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--gold) !important;
  box-shadow: 0 0 0 4px rgba(255, 212, 42, 0.12);
}

.app-layout {
  display: flex;
  width: 100%;
  min-height: 100vh;
}

.sidebar {
  width: 280px;
  min-width: 280px;
  background:
    linear-gradient(180deg, rgba(7, 26, 47, 0.98), rgba(3, 13, 28, 0.98));
  border-right: 1px solid var(--border);
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  position: sticky;
  top: 0;
  height: 100vh;
  box-shadow: 18px 0 60px rgba(0, 0, 0, 0.25);
}

.sidebar h2 {
  color: var(--gold);
  font-size: 28px;
  font-weight: 950;
  margin-bottom: 24px;
  text-align: center;
  line-height: 1.12;
  letter-spacing: 0.4px;
  padding: 18px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(255, 212, 42, 0.13), rgba(47, 101, 229, 0.10));
}

.sidebar button {
  width: 100%;
  background: rgba(11, 37, 82, 0.78);
  color: #eef6ff;
  padding: 15px 16px;
  border-radius: 16px;
  margin-bottom: 10px;
  font-size: 16px;
  font-weight: 800;
  text-align: left;
  border: 1px solid rgba(125, 181, 255, 0.13);
}

.sidebar button:hover,
.sidebar .nav-active {
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  border-color: rgba(255, 212, 42, 0.52);
  color: #ffffff;
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.25);
}

.logout {
  margin-top: auto;
  background: linear-gradient(135deg, #dc2626, #991b1b) !important;
  text-align: center !important;
}

.main-content {
  flex: 1;
  width: calc(100% - 280px);
  padding: 24px;
  overflow-x: hidden;
}

.topbar {
  background:
    linear-gradient(135deg, rgba(11, 31, 69, 0.96), rgba(8, 25, 53, 0.92));
  border: 1px solid var(--border);
  border-radius: 28px;
  padding: 26px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 22px;
  margin-bottom: 26px;
  box-shadow: var(--shadow);
}

.topbar h1 {
  font-size: clamp(30px, 4vw, 48px);
  color: var(--gold);
  font-weight: 950;
  line-height: 1.05;
  letter-spacing: -0.8px;
}

.topbar p {
  color: var(--muted);
  font-size: 18px;
  margin-top: 10px;
  word-break: break-word;
}

.topbar button {
  min-width: 130px;
  min-height: 62px;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--blue), #1746c9);
  color: white;
  font-size: 17px;
  font-weight: 900;
  box-shadow: 0 14px 32px rgba(47, 101, 229, 0.28);
}

section > h2 {
  text-align: left;
  font-size: 30px;
  margin-bottom: 18px;
  color: #ffffff;
  letter-spacing: -0.3px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  margin-bottom: 26px;
}

.card {
  background: linear-gradient(145deg, rgba(11, 31, 69, 0.95), rgba(6, 20, 42, 0.94));
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 24px;
  text-align: left;
  min-height: 142px;
  box-shadow: 0 16px 46px rgba(0, 0, 0, 0.24);
  position: relative;
  overflow: hidden;
}

.card::after {
  content: "";
  position: absolute;
  inset: auto -30px -40px auto;
  width: 110px;
  height: 110px;
  background: rgba(255, 212, 42, 0.09);
  border-radius: 50%;
}

.card span {
  display: block;
  color: var(--muted);
  font-size: 17px;
  margin-bottom: 14px;
  line-height: 1.25;
  font-weight: 700;
}

.card strong {
  color: var(--gold);
  font-size: clamp(22px, 2.6vw, 30px);
  line-height: 1.12;
  word-break: break-word;
  font-weight: 950;
}

.panel {
  background: linear-gradient(145deg, rgba(11, 31, 69, 0.95), rgba(6, 20, 42, 0.94));
  border: 1px solid var(--border);
  border-radius: 28px;
  padding: 26px;
  width: 100%;
  overflow-x: hidden;
  box-shadow: var(--shadow);
}

.panel h2,
.panel h3 {
  text-align: left;
  margin-bottom: 20px;
  font-size: 28px;
  color: var(--gold);
}

.table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: grid;
  grid-template-columns: minmax(180px, 2fr) minmax(110px, 1fr) minmax(120px, 1fr);
  align-items: center;
  gap: 12px;
  background: rgba(2, 19, 46, 0.82);
  padding: 17px 20px;
  border-radius: 18px;
  font-size: 16px;
  border: 1px solid rgba(125, 181, 255, 0.12);
}

.row span {
  color: #dbeafe;
  word-break: break-word;
}

.row strong {
  text-align: right;
  color: var(--gold-2);
  word-break: break-word;
}

.wallet-form,
.transaction-form,
.savings-form {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  margin-bottom: 26px;
  width: 100%;
  align-items: center;
}

.wallet-form {
  grid-template-columns: minmax(220px, 2fr) minmax(150px, 1fr) minmax(160px, 1fr) minmax(150px, auto) minmax(150px, auto);
}

.transaction-form,
.savings-form {
  grid-template-columns: repeat(2, minmax(240px, 1fr));
}

.wallet-form input,
.wallet-form select,
.wallet-form button,
.transaction-form input,
.transaction-form select,
.transaction-form button,
.savings-form input,
.savings-form select,
.savings-form button,
.modal-card input,
.modal-card textarea,
.login-card input {
  min-height: 56px;
  border-radius: 15px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  padding: 14px 16px;
  font-size: 16px;
  width: 100%;
}

.wallet-form input,
.wallet-form select,
.transaction-form input,
.transaction-form select,
.savings-form input,
.savings-form select,
.modal-card input,
.modal-card textarea,
.login-card input {
  background: rgba(7, 17, 31, 0.92);
  color: var(--text);
}

.wallet-form input::placeholder,
.transaction-form input::placeholder,
.savings-form input::placeholder,
.modal-card input::placeholder,
.modal-card textarea::placeholder,
.login-card input::placeholder {
  color: #8ba3c7;
}

.wallet-form button,
.transaction-form button,
.savings-form button,
.report-card button,
.modal-actions button,
.login-card button {
  background: linear-gradient(135deg, var(--blue), #1746c9);
  border: none;
  color: white;
  font-weight: 900;
  box-shadow: 0 12px 26px rgba(47, 101, 229, 0.22);
}

.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 18px;
}

.report-card {
  background: linear-gradient(145deg, rgba(8, 25, 53, 0.96), rgba(5, 15, 32, 0.96));
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 24px;
  text-align: left;
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.22);
}

.report-card h3 {
  color: var(--gold);
  margin-bottom: 16px;
  font-size: 22px;
}

.report-card button {
  padding: 12px 16px;
  border-radius: 14px;
  margin: 6px 6px 6px 0;
  font-size: 15px;
}

.login-page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at 15% 10%, rgba(255, 212, 42, 0.20), transparent 30%),
    radial-gradient(circle at 85% 15%, rgba(47, 101, 229, 0.26), transparent 34%),
    linear-gradient(135deg, #06130e, #071a2f);
}

.login-card {
  width: 100%;
  max-width: 520px;
  background: rgba(11, 31, 69, 0.88);
  border: 1px solid var(--border-strong);
  border-radius: 32px;
  padding: 38px;
  text-align: center;
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.46);
  backdrop-filter: blur(12px);
}

.login-card h1 {
  color: var(--gold);
  font-size: clamp(34px, 6vw, 46px);
  margin-bottom: 12px;
  line-height: 1.05;
  font-weight: 950;
}

.login-card p {
  color: var(--muted);
  margin-bottom: 18px;
  font-size: 17px;
}

.login-card button {
  width: 100%;
  min-height: 58px;
  border-radius: 16px;
  font-size: 18px;
}

.status {
  margin-top: 18px;
  text-align: center;
  color: #86efac;
  font-size: 17px;
  font-weight: 900;
}

.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 9999;
  min-width: 280px;
  max-width: 420px;
  padding: 16px 20px;
  border-radius: 16px;
  font-size: 17px;
  font-weight: 900;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42);
}

.toast-success {
  background: #052e16;
  border: 1px solid #22c55e;
  color: #86efac;
}

.toast-error {
  background: #450a0a;
  border: 1px solid #ef4444;
  color: #fecaca;
}

.toast-warning {
  background: #451a03;
  border: 1px solid #f59e0b;
  color: #fde68a;
}

.savings-card {
  background: linear-gradient(145deg, rgba(8, 25, 53, 0.96), rgba(5, 15, 32, 0.96));
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.20);
}

.savings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}

.savings-title {
  font-size: 22px;
  font-weight: 950;
  color: var(--gold);
}

.savings-status {
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 950;
}

.savings-active {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
  border: 1px solid #22c55e;
}

.savings-closed {
  background: rgba(239, 68, 68, 0.15);
  color: #fecaca;
  border: 1px solid #ef4444;
}

.progress-wrapper {
  width: 100%;
  height: 18px;
  background: #0f172a;
  border-radius: 999px;
  overflow: hidden;
  margin: 14px 0;
  border: 1px solid #1e293b;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--blue), var(--green));
  border-radius: 999px;
  transition: width 0.4s ease;
}

.savings-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  color: #cbd5e1;
  margin-top: 10px;
  font-size: 15px;
}

.savings-note {
  color: #b8c7dd;
  margin-top: 10px;
}

.savings-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.savings-actions button {
  min-height: 46px;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 900;
}

.edit-btn {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
}

.history-btn {
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: white;
}

.close-btn {
  background: linear-gradient(135deg, #dc2626, #991b1b);
  color: white;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(6px);
}

.modal-card {
  width: min(720px, 95vw);
  max-height: 85vh;
  overflow-y: auto;
  background: linear-gradient(145deg, rgba(11, 31, 69, 0.98), rgba(6, 20, 42, 0.98));
  border: 1px solid var(--border);
  border-radius: 28px;
  padding: 24px;
  color: #ffffff;
  box-shadow: var(--shadow);
}

.modal-card h3 {
  color: var(--gold);
  margin-bottom: 16px;
  font-size: 24px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.modal-actions button {
  border-radius: 14px;
  padding: 12px 18px;
  font-weight: 900;
}

@media (max-width: 1100px) {
  .wallet-form {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}

@media (max-width: 900px) {
  .app-layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    min-width: 100%;
    height: auto;
    position: relative;
    padding: 16px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .sidebar h2 {
    margin-bottom: 14px;
    font-size: 24px;
  }

  .sidebar button {
    padding: 13px 14px;
    margin-bottom: 8px;
  }

  .main-content {
    width: 100%;
    padding: 16px;
  }

  .topbar {
    flex-direction: column;
    text-align: center;
    padding: 22px;
  }

  .topbar h1 {
    font-size: 32px;
  }

  section > h2,
  .panel h2,
  .panel h3 {
    text-align: center;
  }

  .grid,
  .wallet-form,
  .transaction-form,
  .savings-form,
  .report-grid {
    grid-template-columns: 1fr;
  }

  .row {
    grid-template-columns: 1fr;
    text-align: center;
  }

  .row strong {
    text-align: center;
  }

  .savings-header,
  .savings-meta {
    flex-direction: column;
    align-items: flex-start;
  }

  .toast {
    left: 16px;
    right: 16px;
    top: 16px;
    min-width: auto;
    max-width: none;
  }
}

@media (max-width: 520px) {
  .login-card,
  .panel,
  .topbar {
    border-radius: 22px;
    padding: 20px;
  }

  .card {
    border-radius: 20px;
    padding: 20px;
  }

  .topbar h1,
  .login-card h1 {
    font-size: 30px;
  }
}
'@ | Set-Content "$FRONTEND\src\App.css" -Encoding UTF8

Write-Host "4) Replace index.css clean root style..." -ForegroundColor Cyan

@'
:root {
  font-family: Inter, Segoe UI, Arial, sans-serif;
  color: #f8fafc;
  background: #07140f;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html {
  width: 100%;
  min-height: 100%;
}

body {
  margin: 0;
  width: 100%;
  min-height: 100vh;
}

#root {
  width: 100%;
  min-height: 100vh;
}
'@ | Set-Content "$FRONTEND\src\index.css" -Encoding UTF8

Write-Host "5) Frontend build test..." -ForegroundColor Cyan
Set-Location $FRONTEND
npm run build | Tee-Object "$VERIFY\frontend_ui_polish_v1_build.txt"
if($LASTEXITCODE -ne 0){ throw "Frontend UI polish build failed" }

@"
S4 FAMILY FINANCE 143 - FRONTEND UI POLISH V1 REPORT

STATUS: PASS
Time: $TS

CHANGED:
- App.jsx sidebar active button class support added
- App.css fully polished
- index.css cleaned

BACKUP:
$BACKUP

VERIFY:
$VERIFY

NEXT:
Open frontend and visually check login/dashboard/mobile layout.
"@ | Set-Content "$VERIFY\FRONTEND_UI_POLISH_V1_REPORT.txt" -Encoding UTF8

Write-Host "FRONTEND UI POLISH V1 PASS" -ForegroundColor Green
Write-Host "Backup folder:" -ForegroundColor Yellow
Write-Host $BACKUP -ForegroundColor Yellow
Write-Host "Verify folder:" -ForegroundColor Yellow
Write-Host $VERIFY -ForegroundColor Yellow