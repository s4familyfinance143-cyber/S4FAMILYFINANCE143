@echo off
setlocal
cd /d "%~dp0..\..\frontend"

if not exist node_modules (
  echo node_modules not found. Running npm install...
  npm install
)

npm run build
npm run preview -- --host 127.0.0.1 --port 4173
pause
