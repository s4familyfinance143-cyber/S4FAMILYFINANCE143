#!/usr/bin/env bash
# S4 FAMILY FINANCE 143 — VPS go-live (production compose).
# Run from project root on the VPS after copying the package.
# Does not create secrets. Fill deploy/docker/.env.production first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="deploy/docker/docker-compose.production.yml"
ENV_FILE="deploy/docker/.env.production"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: Missing $COMPOSE_FILE"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE"
  echo "Create it from deploy/docker/.env.production.example (or .env.staging.example for VM only)."
  exit 1
fi

required_vars=(
  "POSTGRES_PASSWORD"
  "DATABASE_URL"
  "JWT_SECRET_KEY"
  "REDIS_PASSWORD"
  "MINIO_ROOT_PASSWORD"
  "CORS_ORIGINS"
  "APP_PUBLIC_URL"
)

for var_name in "${required_vars[@]}"; do
  if ! grep -qE "^${var_name}=" "$ENV_FILE"; then
    echo "ERROR: $ENV_FILE missing $var_name"
    exit 1
  fi
  value="$(grep -E "^${var_name}=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f2-)"
  if [[ -z "$value" ]]; then
    echo "ERROR: $var_name is empty in $ENV_FILE"
    exit 1
  fi
  if echo "$value" | grep -qiE 'CHANGE_ME|your-domain\.example|example\.com'; then
    echo "ERROR: $var_name still contains a placeholder value"
    exit 1
  fi
done

if grep -qE '^AUTO_CREATE_TABLES=true' "$ENV_FILE"; then
  echo "ERROR: AUTO_CREATE_TABLES must not be true in production env"
  exit 1
fi

echo "Docker version:"
docker --version
echo "Docker Compose version:"
docker compose version

echo "Validating compose config..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/tmp/s4-compose-config.out

echo "Building and starting production stack (no Mailpit / staging profile)..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo "Container status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "Recent backend logs:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=80 backend || true

echo "Recent nginx logs:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=40 nginx || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=20 frontend || true

echo "DEPLOY SCRIPT COMPLETE"
echo "Next:"
echo "  1) bash deploy/scripts/verify_live.sh https://YOUR_DOMAIN"
echo "  2) sudo bash deploy/scripts/vps_ssl_certbot.sh app.s4family.app grafana.s4family.app you@email.com"
echo "  3) sudo bash deploy/scripts/vps_backup_cron.sh"
echo "  4) bash deploy/scripts/verify_fcm_ready.sh deploy/docker/.env.production"
echo "Full checklist: deploy/OPERATOR_GO_LIVE.md"
