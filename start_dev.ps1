# Start backend + frontend dev servers (two windows)
$Root = $PSScriptRoot
$Py = Join-Path $Root "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $Py)) {
  Write-Host "Run .\setup_local.ps1 first" -ForegroundColor Red
  exit 1
}

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$($Root)\backend'; Write-Host 'Backend http://127.0.0.1:8000' -ForegroundColor Green; & '$Py' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$($Root)\frontend'; Write-Host 'Frontend http://127.0.0.1:5173' -ForegroundColor Green; npm run dev"
)

Write-Host "Started backend + frontend in new windows." -ForegroundColor Cyan
Write-Host "Login: owner@s4family.com / S4Family143!"
