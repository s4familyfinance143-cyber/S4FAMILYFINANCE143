#!/usr/bin/env bash
# Validates S4 production packaging artifacts (no real deploy / no real secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0

checks=(
  "deploy/docker/docker-compose.production.yml"
  "deploy/docker/Dockerfile.backend"
  "deploy/docker/Dockerfile.frontend"
  "deploy/docker/.env.production.example"
  "deploy/nginx/s4_family_finance_nginx.conf"
  "deploy/nginx/s4_family_finance_nginx.ssl.example.conf"
  "deploy/README_PRODUCTION_DEPLOYMENT.md"
  "deploy/README_RELEASE_KIT.md"
  "deploy/docker/.env.staging.example"
  "deploy/scripts/remote_ghcr_deploy.sh"
  "deploy/scripts/ghcr_login.sh"
  "deploy/docker/docker-compose.ghcr.yml"
  "deploy/README_CI_CD.md"
  "deploy/scripts/verify_live.sh"
  "deploy/scripts/package_release.sh"
  "backend/.env.production.example"
  "backend/requirements.txt"
  "backend/alembic.ini"
  "deploy/monitoring/README_MONITORING.md"
  "deploy/monitoring/docker-compose.monitoring.yml"
  "deploy/monitoring/docker-compose.monitoring.prod.yml"
  "deploy/monitoring/prometheus/prometheus.yml"
  "deploy/monitoring/prometheus/alerts.yml"
  "deploy/monitoring/grafana/provisioning/datasources/datasource.yml"
  "deploy/OPERATOR_GO_LIVE.md"
  "deploy/SECURITY_AUDIT_REPORT.md"
  "deploy/BETA_TESTING_PLAN.md"
  "deploy/BUILD_ORDER_GAPS_CLOSED.md"
  "deploy/scripts/verify_fcm_ready.sh"
  "deploy/scripts/vps_ssl_certbot.sh"
  "deploy/scripts/vps_backup_cron.sh"
)

for rel in "${checks[@]}"; do
  if [[ -f "$ROOT/$rel" ]]; then
    echo "OK  $rel"
  else
    echo "MISS $rel"
    FAILED=$((FAILED + 1))
  fi
done

NGINX="$ROOT/deploy/nginx/s4_family_finance_nginx.conf"
if grep -qE 'server backend:8000|proxy_pass http://s4_backend|proxy_pass http://backend:8000' "$NGINX"; then
  echo "OK  nginx proxies to docker service 'backend'"
else
  echo "FAIL nginx must proxy to backend:8000 (direct or via upstream s4_backend)"
  FAILED=$((FAILED + 1))
fi
if grep -q 'Upgrade' "$NGINX"; then
  echo "OK  nginx websocket Upgrade headers present"
else
  echo "FAIL nginx missing websocket Upgrade headers"
  FAILED=$((FAILED + 1))
fi

# GHCR override compose must parse when image env is set
export S4_BACKEND_IMAGE=ghcr.io/example/s4-backend:validate
export S4_FRONTEND_IMAGE=ghcr.io/example/s4-nginx:validate
if docker compose -f "$ROOT/deploy/docker/docker-compose.production.yml" \
  -f "$ROOT/deploy/docker/docker-compose.ghcr.yml" \
  --env-file "$ROOT/deploy/docker/.env.production.example" config --quiet; then
  echo "OK  docker compose GHCR overlay config"
else
  echo "FAIL docker compose GHCR overlay config"
  FAILED=$((FAILED + 1))
fi
unset S4_BACKEND_IMAGE S4_FRONTEND_IMAGE

export POSTGRES_PASSWORD=validate_only_postgres
export REDIS_PASSWORD=validate_only_redis
export MINIO_ROOT_USER=validate_minio
export MINIO_ROOT_PASSWORD=validate_only_minio
export DATABASE_URL='postgresql+psycopg://s4_user:validate_only_postgres@postgres:5432/s4_family_finance_production'
export JWT_SECRET_KEY='validate_only_jwt_secret_key_32chars_min_xx'

if docker compose -f "$ROOT/deploy/docker/docker-compose.production.yml" \
  --env-file "$ROOT/deploy/docker/.env.production.example" config --quiet; then
  echo "OK  docker compose config (with example/dummy env)"
else
  echo "FAIL docker compose config"
  FAILED=$((FAILED + 1))
fi

unset POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD DATABASE_URL JWT_SECRET_KEY

export POSTGRES_PASSWORD=validate_only_postgres
export REDIS_PASSWORD=validate_only_redis
export MINIO_ROOT_USER=validate_minio
export MINIO_ROOT_PASSWORD=validate_only_minio
export DATABASE_URL='postgresql+psycopg://s4_user:validate_only_postgres@postgres:5432/s4_family_finance_production'
export JWT_SECRET_KEY='validate_only_jwt_secret_key_32chars_min_xx'
export GRAFANA_ADMIN_PASSWORD=validate_only_grafana
export POSTGRES_DB=s4_family_finance_production
export POSTGRES_USER=s4_user

if docker compose -f "$ROOT/deploy/docker/docker-compose.production.yml" \
  -f "$ROOT/deploy/monitoring/docker-compose.monitoring.prod.yml" \
  --env-file "$ROOT/deploy/docker/.env.production.example" config --quiet; then
  echo "OK  docker compose production + monitoring overlay"
else
  echo "FAIL docker compose production + monitoring overlay"
  FAILED=$((FAILED + 1))
fi

unset POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD DATABASE_URL JWT_SECRET_KEY
unset GRAFANA_ADMIN_PASSWORD POSTGRES_DB POSTGRES_USER

if [[ "$FAILED" -gt 0 ]]; then
  echo "FAIL production_packaging_validate ($FAILED)"
  exit 1
fi
echo "PASS production_packaging_validate"
echo "NOTE: Real VPS still needs domain DNS, TLS certs, and filled .env.production secrets."
