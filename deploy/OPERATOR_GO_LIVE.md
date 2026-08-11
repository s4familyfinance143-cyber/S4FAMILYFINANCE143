# Operator go-live checklist — S4 Family Finance 143

Code/CI can ship without these. **Live `app.s4family.app` needs this list completed by you.**

Related: `deploy/BUILD_ORDER_GAPS_CLOSED.md` · `deploy/SECURITY_AUDIT_REPORT.md` · `deploy/BETA_TESTING_PLAN.md`

## 0) Before production (Step 18)

1. Read `deploy/SECURITY_AUDIT_REPORT.md` (PASS — no High findings).
2. Run beta with 2–3 families using `deploy/BETA_TESTING_PLAN.md`.
3. File bugs via GitHub **Beta feedback** issue template.
4. Clear P0 / accept remaining P1 in writing.

## 1) Ubuntu VPS

1. Create Ubuntu 22.04/24.04 VPS (2 vCPU / 4GB+ RAM recommended).
2. Install Docker + Compose plugin.
3. Clone or copy release to `/opt/s4-family-finance`.
4. Copy `deploy/docker/.env.production.example` → `.env.production` and fill secrets.
5. Deploy:

```bash
bash deploy/scripts/vps_go_live_deploy.sh
# optional monitoring:
cd deploy/docker
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f ../monitoring/docker-compose.monitoring.prod.yml up -d --build
```

Or GHCR path: `deploy/scripts/remote_ghcr_deploy.sh production`.

## 2) DNS

| Hostname | Type | Points to |
|----------|------|-----------|
| `app.s4family.app` | A/AAAA | VPS public IP |
| `staging.s4family.app` | A/AAAA | Staging VPS (or same) |
| `grafana.s4family.app` | A/AAAA | VPS public IP |

## 3) TLS (SSL)

```bash
sudo bash deploy/scripts/vps_ssl_certbot.sh app.s4family.app grafana.s4family.app you@email.com
```

Then enable `deploy/nginx/s4_family_finance_nginx.ssl.example.conf` (or Cloudflare proxy).

## 4) Daily backup (local + optional S3)

```bash
sudo bash deploy/scripts/vps_backup_cron.sh
```

Dumps gzip locally under `/var/backups/s4-family`. When `S3_*` (and optional
`BACKUP_S3_BUCKET`) are set in `.env.production`, the same job uploads
`backups/postgres/<stamp>/postgres.sql.gz` to MinIO/S3. Local dump is kept even
if upload fails.

## 5) GitHub Environment secrets

| Secret | Purpose |
|--------|---------|
| `PRODUCTION_HOST` | VPS IP/hostname |
| `PRODUCTION_USER` | SSH user |
| `PRODUCTION_SSH_KEY` | Private key PEM |
| `PRODUCTION_DEPLOY_PATH` | e.g. `/opt/s4-family-finance` |
| `STAGING_*` | Staging SSH |

Until set, CI **skips** remote deploy (build still green).

## 6) Sentry

```
SENTRY_DSN=https://...@o....ingest.sentry.io/...
SENTRY_ENVIRONMENT=production
VITE_SENTRY_DSN=https://...@o....ingest.sentry.io/...
```

## 7) FCM push (Step 12 live)

1. Firebase Console → service account JSON on VPS (e.g. `/secrets/firebase.json`).
2. In `.env.production`:

```
NOTIFICATION_FCM_ENABLED=true
FCM_PROJECT_ID=your-project
FCM_CREDENTIALS_PATH=/secrets/firebase.json
```

3. Verify:

```bash
bash deploy/scripts/verify_fcm_ready.sh deploy/docker/.env.production
```

## 8) Alert webhooks

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
PAGERDUTY_WEBHOOK_URL=https://events.pagerduty.com/...
EMAIL_WEBHOOK_URL=https://your-email-bridge/...
```

Rebuild alertmanager after changing webhooks.

## 9) SQLCipher mobile (Step 6 runtime)

```bash
cd mobile
npm run verify:sqlcipher
npm run eas:build:dev   # or android:native — not Expo Go
```

Confirm Sync status shows **SQLCipher ON**.

## 10) Verify live

```bash
bash deploy/scripts/verify_live.sh https://app.s4family.app
curl -fsS http://127.0.0.1:8000/metrics | head
docker logs s4-family-finance-postgres 2>&1 | grep duration
```

## 11) App login (users)

- Production: https://app.s4family.app  
- Local: http://127.0.0.1:5173  
- Grafana (ops): https://grafana.s4family.app  
