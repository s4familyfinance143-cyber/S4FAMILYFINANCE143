# Start Redis + Mailpit for local Celery and email testing
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "Starting Redis + Mailpit..." -ForegroundColor Cyan
docker compose -f docker-compose.local.yml up -d

Write-Host ""
Write-Host "Mailpit UI: http://127.0.0.1:8025" -ForegroundColor Green
Write-Host "Redis:      redis://:s4redis_dev@127.0.0.1:6380/0" -ForegroundColor Green
Write-Host ""
Write-Host "Next: copy SMTP settings from deploy/EMAIL_FCM_SETUP.md into backend/.env" -ForegroundColor Yellow
Write-Host "Then: celery -A app.workers.celery_app.celery_app worker --loglevel=info --pool=solo" -ForegroundColor Yellow
