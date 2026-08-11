#!/usr/bin/env bash
# Pull GHCR images and restart the production compose stack on a remote VPS/VM.
# Called from GitHub Actions (staging or production).
#
# Usage (on server, from repo root):
#   export S4_BACKEND_IMAGE=ghcr.io/org/repo/s4-backend:sha
#   export S4_FRONTEND_IMAGE=ghcr.io/org/repo/s4-nginx:sha
#   export GHCR_USERNAME=...   # required for private GHCR packages
#   export GHCR_TOKEN=...      # PAT with read:packages (or GITHUB_TOKEN)
#   bash deploy/scripts/remote_ghcr_deploy.sh staging|production
set -euo pipefail

TARGET="${1:-production}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="deploy/docker/docker-compose.production.yml"
GHCR_FILE="deploy/docker/docker-compose.ghcr.yml"
ENV_FILE="deploy/docker/.env.production"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE on server"
  exit 1
fi

if [[ -z "${S4_BACKEND_IMAGE:-}" || -z "${S4_FRONTEND_IMAGE:-}" ]]; then
  echo "ERROR: Set S4_BACKEND_IMAGE and S4_FRONTEND_IMAGE"
  exit 1
fi

PROFILE_ARGS=()
if [[ "$TARGET" == "staging" ]]; then
  PROFILE_ARGS=(--profile staging)
fi

# Propagate release marker into containers when Sentry is configured
export SENTRY_RELEASE="${SENTRY_RELEASE:-${S4_IMAGE_TAG:-}}"

echo "Deploy target: $TARGET"
echo "Backend image:  $S4_BACKEND_IMAGE"
echo "Frontend image: $S4_FRONTEND_IMAGE"
echo "Sentry release: ${SENTRY_RELEASE:-none}"

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "Logging in to GHCR..."
  echo "$GHCR_TOKEN" | docker login ghcr.io \
    -u "${GHCR_USERNAME:?Set GHCR_USERNAME when GHCR_TOKEN is set}" \
    --password-stdin
elif [[ -f "${HOME}/.docker/config.json" ]] && grep -q 'ghcr.io' "${HOME}/.docker/config.json"; then
  echo "Using existing GHCR credentials in Docker config"
else
  echo "ERROR: GHCR auth missing. Set GHCR_USERNAME + GHCR_TOKEN (read:packages) on the server,"
  echo "       or run: echo \$TOKEN | docker login ghcr.io -u USER --password-stdin"
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$GHCR_FILE" config >/tmp/s4-ghcr-compose.out

echo "Pulling images..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$GHCR_FILE" pull backend nginx celery_worker celery_beat

echo "Starting stack..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$GHCR_FILE" "${PROFILE_ARGS[@]}" up -d --no-build --remove-orphans

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$GHCR_FILE" ps

echo "DEPLOY COMPLETE ($TARGET)"
