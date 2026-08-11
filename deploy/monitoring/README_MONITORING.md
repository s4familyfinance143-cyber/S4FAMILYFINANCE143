# S4 Monitoring — Grafana + Prometheus + Alertmanager

Architecture target: `grafana.s4family.app` for API latency, DB connections, CPU, memory.

Configs are baked into local images (avoids Docker Desktop bind-mount issues on Windows).
Alertmanager reads `SLACK_WEBHOOK_URL` / `PAGERDUTY_WEBHOOK_URL` / `EMAIL_WEBHOOK_URL` from env (see `deploy/OPERATOR_GO_LIVE.md`).

## Local

From repo root (app stack already defined):

```bash
docker compose -f docker-compose.yml -f deploy/monitoring/docker-compose.monitoring.yml up -d --build
```

| UI | URL | Login |
|----|-----|-------|
| Grafana | http://localhost:3000 | admin / s4grafana_dev |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |
| API metrics | http://localhost:8000/metrics | — |

Host CPU/disk exporter (Linux VPS / WSL2 only — not Docker Desktop Windows):

```bash
docker compose -f docker-compose.yml -f deploy/monitoring/docker-compose.monitoring.yml --profile host-metrics up -d
```

## Production

From `deploy/docker` (set `GRAFANA_ADMIN_PASSWORD` in `.env.production`):

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f ../monitoring/docker-compose.monitoring.prod.yml up -d --build
```

DNS: point `grafana.s4family.app` → VPS. Nginx `server_name` is already in
`deploy/nginx/s4_family_finance_nginx.conf`.

## Alerts

Rules: `deploy/monitoring/prometheus/alerts.yml`

Set webhook env vars (`SLACK_WEBHOOK_URL`, `PAGERDUTY_WEBHOOK_URL`, `EMAIL_WEBHOOK_URL`)
then rebuild alertmanager. Template file:
`deploy/monitoring/alertmanager/alertmanager.yml.template`.
Until set, notifications are discarded; firing alerts still appear in Prometheus UI.

## What is scraped

| Job | Target | Metrics |
|-----|--------|---------|
| s4-backend | backend:8000/metrics | HTTP rate, latency, DB pool |
| postgres | postgres-exporter:9187 | DB connections, activity |
| redis | redis-exporter:9121 | Redis memory / clients |
| flower | flower:5555/metrics | Celery task activity |
| node | node-exporter:9100 | CPU, memory, disk (`host-metrics` profile) |

## Operator checklist

1. Set `GRAFANA_ADMIN_PASSWORD` (production).
2. Set `GRAFANA_ROOT_URL=https://grafana.s4family.app`.
3. DNS + TLS for `grafana.s4family.app`.
4. Replace Alertmanager webhook placeholders, rebuild alertmanager.
5. Rebuild backend image after pull so `/metrics` is available.
