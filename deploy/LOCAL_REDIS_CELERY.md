# S4 — Local Redis + Mailpit (Windows / dev)

Lightweight stack for **Celery background jobs** and **email testing** without full Docker compose.

## Quick start

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL
docker compose -f docker-compose.local.yml up -d
```

Then in `backend/.env`:

```env
REDIS_URL=redis://:s4redis_dev@127.0.0.1:6380/0
CELERY_ENABLED=true

AUTH_EMAIL_ENABLED=true
NOTIFICATION_EMAIL_ENABLED=true
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=noreply@s4family.local
SMTP_FROM_NAME=S4 Family Finance
SMTP_USE_TLS=false
SMTP_USE_SSL=false
APP_PUBLIC_URL=http://127.0.0.1:5173
```

## Start Celery (second terminal)

```powershell
cd backend
.\.venv\Scripts\activate
celery -A app.workers.celery_app.celery_app worker --loglevel=info --pool=solo
```

Beat (scheduled tasks, optional third terminal):

```powershell
celery -A app.workers.celery_app.celery_app beat --loglevel=info
```

## Mailpit UI

Open http://127.0.0.1:8025 — all outgoing emails appear here (no real send).

## Stop

```powershell
docker compose -f docker-compose.local.yml down
```

See also: `deploy/EMAIL_FCM_SETUP.md`
