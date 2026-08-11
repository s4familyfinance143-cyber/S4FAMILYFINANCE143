@echo off
setlocal
cd /d "%~dp0..\..\backend"

call .venv\Scripts\activate.bat

set ENVIRONMENT=development
set AUTO_CREATE_TABLES=true
set ENABLE_RECURRING_WORKER=false
set ENABLE_AUTO_BACKUP_WORKER=false

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
