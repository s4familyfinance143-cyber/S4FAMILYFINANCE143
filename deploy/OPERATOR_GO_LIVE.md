# Operator go-live checklist — S4 Family Finance 143

Code/CI can ship without these. **Live `app.s4family.app` needs this list completed by you.**

## 1) Ubuntu VPS

1. Create Ubuntu 22.04/24.04 VPS (2 vCPU / 4GB+ RAM recommended).
2. Install Docker + Compose plugin.
3. Clone or copy release to `/opt/s4-family-finance`.
4. Copy `deploy/docker/.env.production.example` → `.env.production` and fill secrets.
5. Run:

```bash
cd /opt/s4-family-finance/deploy/docker
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
# optional monitoring:
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f ../monitoring/docker-compose.monitoring.prod.yml up -d --build
```

Or GHCR path after CI pushes images: `deploy/scripts/remote_ghcr_deploy.sh production`.

## 2) DNS (Cloudflare / registrar)

| Hostname | Type | Points to |
|----------|------|-----------|
| `app.s4family.app` | A/AAAA | VPS public IP |
| `staging.s4family.app` | A/AAAA | Staging VPS (or same) |
| `grafana.s4family.app` | A/AAAA | VPS public IP |

Then issue TLS (Certbot / Cloudflare proxy).

## 3) GitHub Environment secrets

Repo → Settings → Environments → **production** (and **staging**):

| Secret | Purpose |
|--------|---------|
| `PRODUCTION_HOST` | VPS IP/hostname |
| `PRODUCTION_USER` | SSH user |
| `PRODUCTION_SSH_KEY` | Private key PEM |
| `PRODUCTION_DEPLOY_PATH` | e.g. `/opt/s4-family-finance` |
| `STAGING_HOST` / `STAGING_USER` / `STAGING_SSH_KEY` | Staging SSH |

Until these exist, CI **skips** remote deploy (build still green).

## 4) Sentry (operator account)

1. Create project at https://sentry.io
2. Set on VPS `.env.production`:

```
SENTRY_DSN=https://...@o....ingest.sentry.io/...
SENTRY_ENVIRONMENT=production
```

3. Frontend build arg / env:

```
VITE_SENTRY_DSN=https://...@o....ingest.sentry.io/...
```

4. Optional GitHub vars/secrets for release markers: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`

## 5) Alert webhooks (Slack / PagerDuty / Email bridge)

Set in `.env.production` (monitoring overlay):

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
PAGERDUTY_WEBHOOK_URL=https://events.pagerduty.com/...
EMAIL_WEBHOOK_URL=https://your-email-bridge/...
```

Rebuild alertmanager after changing webhooks.

Until set, alerts still evaluate in Prometheus UI; notifications are discarded.

## 6) Verify

```bash
bash deploy/scripts/verify_live.sh https://app.s4family.app
curl -fsS http://127.0.0.1:8000/metrics | head
docker logs s4-family-finance-postgres 2>&1 | grep duration  # slow queries ≥500ms
```

## 7) App login (users)

- Production: https://app.s4family.app  
- Local: http://127.0.0.1:5173  
- Grafana (ops only): https://grafana.s4family.app (or http://localhost:3000)
