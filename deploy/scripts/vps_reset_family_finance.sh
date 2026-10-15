#!/usr/bin/env bash
# Reset S4 Family Finance on the shared VPS to a clean, empty install.
#
# DESTRUCTIVE for Family Finance only: deletes its containers, Docker volumes
# (PostgreSQL data, Redis, MinIO, avatars), images and code directory.
# Keeps: deploy/docker/.env.production and secrets/ (restored after the wipe),
# a pg_dump + copies in /root/s4ff-reset-<timestamp>/.
# Never touches s4erp (/www/s4erp), the website stack (/opt/s4, project
# s4-production) or the host Nginx / panel.
#
# Run from your PC (script is streamed over SSH, nothing to copy first):
#   ssh -i ~/.ssh/s4_vps root@app.s4businessthinking.com \
#     'CONFIRM=RESET-FAMILY-FINANCE bash -s' < deploy/scripts/vps_reset_family_finance.sh
#
# Then redeploy Family Finance (fresh DB, alembic upgrade head):
#   gh workflow run auto-deploy-vps.yml -f deploy_app=true -f deploy_website=false
set -euo pipefail

APP_ROOT="/opt/s4-family-finance"
COMPOSE_DIR="$APP_ROOT/deploy/docker"
PROJECT="docker"
ENV_FILE="$COMPOSE_DIR/.env.production"

die() { echo "ABORT: $*" >&2; exit 1; }

[[ "${CONFIRM:-}" == "RESET-FAMILY-FINANCE" ]] || die "set CONFIRM=RESET-FAMILY-FINANCE to run"
[[ "$(id -u)" == "0" ]] || die "run as root"
[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE (production settings)"
command -v docker >/dev/null || die "docker not found"

# Every container of the compose project must live in APP_ROOT — otherwise stop.
mapfile -t CONTAINERS < <(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}')
for c in "${CONTAINERS[@]}"; do
  wd="$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
  [[ "$wd" == "$COMPOSE_DIR" ]] || die "container $c of project '$PROJECT' is from '$wd', not $COMPOSE_DIR"
  [[ "$c" == s4-family-finance-* ]] || die "unexpected container name in project '$PROJECT': $c"
done
echo "Family Finance containers: ${CONTAINERS[*]:-(none)}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/s4ff-reset-$TS"
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"

echo "==> 1/5 Backup to $BACKUP"
if docker ps --format '{{.Names}}' | grep -qx 's4-family-finance-postgres'; then
  docker exec s4-family-finance-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$BACKUP/family_finance.dump"
  [[ -s "$BACKUP/family_finance.dump" ]] || die "pg_dump produced an empty file; nothing was deleted"
  ls -lh "$BACKUP/family_finance.dump"
else
  echo "postgres container not running — no DB dump taken"
fi
cp -a "$ENV_FILE" "$BACKUP/.env.production"
if [[ -d "$APP_ROOT/secrets" ]]; then cp -a "$APP_ROOT/secrets" "$BACKUP/secrets"; fi

echo "==> 2/5 Stop and remove Family Finance containers, volumes, network"
COMPOSE_FILES=()
for f in docker-compose.production.yml docker-compose.host-nginx.yml docker-compose.vps-shared-slim.yml; do
  [[ -f "$COMPOSE_DIR/$f" ]] && COMPOSE_FILES+=(-f "$COMPOSE_DIR/$f")
done
[[ ${#COMPOSE_FILES[@]} -gt 0 ]] || die "no compose files in $COMPOSE_DIR"
docker compose -p "$PROJECT" --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" down -v --remove-orphans

echo "==> 3/5 Remove Family Finance images"
for img in docker-backend:latest docker-nginx:latest docker-frontend:latest; do
  if docker image inspect "$img" >/dev/null 2>&1; then docker rmi "$img" || true; fi
done

echo "==> 4/5 Remove old code, restore settings"
rm -rf /opt/s4-family-finance
mkdir -p "$COMPOSE_DIR"
cp -a "$BACKUP/.env.production" "$ENV_FILE"
chmod 600 "$ENV_FILE"
if [[ -d "$BACKUP/secrets" ]]; then cp -a "$BACKUP/secrets" "$APP_ROOT/secrets"; fi

echo "==> 5/5 Check"
echo "-- remaining Family Finance containers (should be none):"
docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}'
echo "-- remaining Family Finance volumes (should be none):"
docker volume ls --format '{{.Name}}' | grep -E '^docker_(postgres|redis|minio|avatar)_data$' || true
echo "-- other projects still running:"
docker ps --format '{{.Names}}\t{{.Status}}'
echo
echo "Done. Backup: $BACKUP (DB dump, .env.production, secrets)."
echo "Next: redeploy -> gh workflow run auto-deploy-vps.yml -f deploy_app=true -f deploy_website=false"
