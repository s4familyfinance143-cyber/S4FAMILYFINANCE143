# Email (SMTP) — S4 Family Finance

In-app notifications and live updates run on the VPS (database + WebSocket). Email is the only external channel; there is no push service.

## Local development — Mailpit (recommended)

1. Start local stack:

```powershell
docker compose -f docker-compose.local.yml up -d
```

2. Backend `.env`:

```env
AUTH_EMAIL_ENABLED=true
NOTIFICATION_EMAIL_ENABLED=true
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM_EMAIL=noreply@s4family.local
SMTP_FROM_NAME=S4 Family Finance
SMTP_USE_TLS=false
APP_PUBLIC_URL=http://127.0.0.1:5173
```

3. Open **http://127.0.0.1:8025** to read test emails.

## Production SMTP (Gmail / SendGrid / etc.)

```env
AUTH_EMAIL_ENABLED=true
NOTIFICATION_EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your@gmail.com
SMTP_PASSWORD=app-specific-password
SMTP_FROM_EMAIL=your@gmail.com
SMTP_FROM_NAME=S4 Family Finance
SMTP_USE_TLS=true
APP_PUBLIC_URL=https://your-domain.com
```

**Gmail:** use [App Password](https://myaccount.google.com/apppasswords), not your main password.

## Verify

| Feature | Test |
|---------|------|
| Email | Forgot password on login screen → check Mailpit |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Email not sent | Check `AUTH_EMAIL_ENABLED`, SMTP host/port, Celery worker running |
| Connection refused :1025 | Run `docker-compose.local.yml` |
