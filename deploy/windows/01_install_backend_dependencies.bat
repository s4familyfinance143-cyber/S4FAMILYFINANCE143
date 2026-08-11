@echo off
setlocal
cd /d "%~dp0..\..\backend"

echo Installing backend dependencies...
if not exist ".venv" (
  py -3 -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip

if exist requirements.txt (
  pip install -r requirements.txt
) else (
  if exist requirements-production.lock.txt (
    pip install -r requirements-production.lock.txt
  ) else (
    echo requirements.txt not found.
    exit /b 1
  )
)

echo Backend dependency install complete.
pause
