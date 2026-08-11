@echo off
setlocal
cd /d "%~dp0..\..\backend"

if not exist ".env.production" (
  echo backend\.env.production not found.
  echo Copy backend\.env.production.example to backend\.env.production and edit it first.
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat

for /f "usebackq tokens=1,* delims==" %%A in (".env.production") do (
  if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
