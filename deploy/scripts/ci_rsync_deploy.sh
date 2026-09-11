#!/usr/bin/env bash
# Sync this checkout onto the VPS over SSH, preserving server secrets.
# Used by GitHub Actions (and can be run from a laptop with DEPLOY_* env vars).
#
# Required env:
#   DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY_PATH (or uses default ssh agent)
# Optional:
#   DEPLOY_APP=1 DEPLOY_WEBSITE=1
#   APP_REMOTE_PATH=/opt/s4-family-finance
#   SITE_REMOTE_PATH=/opt/s4
#   SITE_LOCAL_PATH=sales-website
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST}"
DEPLOY_USER="${DEPLOY_USER:-root}"
APP_REMOTE_PATH="${APP_REMOTE_PATH:-/opt/s4-family-finance}"
SITE_REMOTE_PATH="${SITE_REMOTE_PATH:-/opt/s4}"
SITE_LOCAL_PATH="${SITE_LOCAL_PATH:-sales-website}"
DEPLOY_APP="${DEPLOY_APP:-1}"
DEPLOY_WEBSITE="${DEPLOY_WEBSITE:-1}"

SSH_OPTS=(-o StrictHostKeyChecking=yes -o ServerAliveInterval=30)
if [[ -n "${DEPLOY_SSH_KEY_PATH:-}" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_SSH_KEY_PATH")
fi

ssh_cmd() {
  ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"
}

rsync_ssh() {
  local rsh="ssh ${SSH_OPTS[*]}"
  rsync -az --delete -e "$rsh" "$@"
}

echo "==> Ensuring remote directories"
ssh_cmd "mkdir -p '$APP_REMOTE_PATH' '$SITE_REMOTE_PATH/s4-website' /opt/s4/secrets-backup"

if [[ "$DEPLOY_APP" == "1" ]]; then
  echo "==> Rsync Family Finance app → $APP_REMOTE_PATH"
  # Preserve production env + secrets on server
  rsync_ssh \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'frontend/node_modules/' \
    --exclude 'frontend/dist/' \
    --exclude 'mobile/node_modules/' \
    --exclude 'desktop/node_modules/' \
    --exclude 'desktop/src-tauri/target/' \
    --exclude 'backend/.venv/' \
    --exclude 'backend/**/__pycache__/' \
    --exclude 'deploy/dist/' \
    --exclude 'deploy/docker/.env.production' \
    --exclude 'deploy/docker/.env' \
    --exclude 'secrets/' \
    --exclude 'sales-website/' \
    --exclude '.env' \
    --exclude '*.apk' \
    --exclude '*.exe' \
    --exclude 'deploy/scripts/_tmp*' \
    ./ "${DEPLOY_USER}@${DEPLOY_HOST}:${APP_REMOTE_PATH}/"
fi

if [[ "$DEPLOY_WEBSITE" == "1" ]]; then
  if [[ ! -d "$SITE_LOCAL_PATH" ]]; then
    echo "ERROR: missing local $SITE_LOCAL_PATH (marketing site source)"
    exit 1
  fi
  echo "==> Backup website env on server (if present)"
  ssh_cmd "if [ -f '$SITE_REMOTE_PATH/s4-website/.env.local' ]; then cp -a '$SITE_REMOTE_PATH/s4-website/.env.local' /opt/s4/secrets-backup/s4-website.env.local; fi"
  ssh_cmd "if [ -f '$SITE_REMOTE_PATH/.env' ]; then cp -a '$SITE_REMOTE_PATH/.env' /opt/s4/secrets-backup/s4-compose.env; fi"

  echo "==> Rsync marketing website → $SITE_REMOTE_PATH/s4-website"
  rsync_ssh \
    --exclude 'node_modules/' \
    --exclude '.next/' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '.env*.local' \
    --exclude '.git/' \
    --exclude 'tsconfig.tsbuildinfo' \
    --exclude 'public/downloads/' \
    --exclude 'public/uploads/' \
    "$SITE_LOCAL_PATH/" "${DEPLOY_USER}@${DEPLOY_HOST}:${SITE_REMOTE_PATH}/s4-website/"

  echo "==> Restore website env if wiped"
  ssh_cmd "if [ ! -f '$SITE_REMOTE_PATH/s4-website/.env.local' ] && [ -f /opt/s4/secrets-backup/s4-website.env.local ]; then cp -a /opt/s4/secrets-backup/s4-website.env.local '$SITE_REMOTE_PATH/s4-website/.env.local'; fi"
fi

echo "==> Upload auto-deploy script and run on VPS"
scp "${SSH_OPTS[@]}" \
  "$ROOT/deploy/scripts/vps_ci_auto_deploy.sh" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/vps_ci_auto_deploy.sh"

ssh_cmd "install -m 0755 /tmp/vps_ci_auto_deploy.sh '$APP_REMOTE_PATH/deploy/scripts/vps_ci_auto_deploy.sh' 2>/dev/null || true; \
  DEPLOY_APP='$DEPLOY_APP' DEPLOY_WEBSITE='$DEPLOY_WEBSITE' APP_ROOT='$APP_REMOTE_PATH' SITE_ROOT='$SITE_REMOTE_PATH' \
  bash /tmp/vps_ci_auto_deploy.sh"

echo "==> Remote sync+deploy finished"
