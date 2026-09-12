#!/usr/bin/env bash
# CI/VPS auto-deploy for shared host (app subdomain + marketing site).
# Expects code already synced into DEST paths, or syncs from CURRENT checkout when run locally.
#
# Usage on VPS (after rsync from GitHub Actions):
#   bash deploy/scripts/vps_ci_auto_deploy.sh
#
# Env:
#   DEPLOY_APP=1          (default 1) rebuild Family Finance stack
#   DEPLOY_WEBSITE=1      (default 1) rebuild marketing website
#   APP_ROOT=/opt/s4-family-finance
#   SITE_ROOT=/opt/s4
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/s4-family-finance}"
SITE_ROOT="${SITE_ROOT:-/opt/s4}"
DEPLOY_APP="${DEPLOY_APP:-1}"
DEPLOY_WEBSITE="${DEPLOY_WEBSITE:-1}"

echo "==> S4 CI auto-deploy"
echo "    APP_ROOT=$APP_ROOT"
echo "    SITE_ROOT=$SITE_ROOT"
echo "    DEPLOY_APP=$DEPLOY_APP DEPLOY_WEBSITE=$DEPLOY_WEBSITE"

if [[ "$DEPLOY_APP" == "1" ]]; then
  if [[ ! -f "$APP_ROOT/deploy/docker/.env.production" ]]; then
    echo "ERROR: missing $APP_ROOT/deploy/docker/.env.production (keep secrets on server)"
    exit 1
  fi
  if [[ ! -f "$APP_ROOT/deploy/scripts/vps_go_live_deploy.sh" ]]; then
    echo "ERROR: missing app deploy script under $APP_ROOT"
    exit 1
  fi
  echo "==> Rebuilding Family Finance (SHARED_HOST_NGINX=1 SLIM=1)"
  (
    cd "$APP_ROOT"
    export SHARED_HOST_NGINX=1
    export SLIM=1
    bash deploy/scripts/vps_go_live_deploy.sh
  )
  echo "==> App health check"
  bash "$APP_ROOT/deploy/scripts/verify_live.sh" https://app.s4businessthinking.com || true
fi

if [[ "$DEPLOY_WEBSITE" == "1" ]]; then
  if [[ ! -f "$SITE_ROOT/docker-compose.prod.yml" ]]; then
    echo "ERROR: missing $SITE_ROOT/docker-compose.prod.yml"
    exit 1
  fi
  if [[ ! -d "$SITE_ROOT/s4-website" ]]; then
    echo "ERROR: missing $SITE_ROOT/s4-website"
    exit 1
  fi
  # Preserve server-only env files if overlay wiped them (should not happen with rsync excludes)
  if [[ ! -f "$SITE_ROOT/s4-website/.env.local" ]]; then
    echo "WARN: $SITE_ROOT/s4-website/.env.local missing — website may need secrets restored"
  fi

  # Installers are normally pushed by CI (private GitHub releases need a token).
  # Optional fallback: curl from GitHub when SKIP_INSTALLER_CURL!=1 and tag is set.
  INSTALLER_TAG="${SYNC_INSTALLERS_TAG:-}"
  if [[ -z "$INSTALLER_TAG" && -f "$APP_ROOT/deploy/release/CURRENT_INSTALLER_TAG" ]]; then
    INSTALLER_TAG="$(tr -d '[:space:]' < "$APP_ROOT/deploy/release/CURRENT_INSTALLER_TAG")"
  fi
  if [[ "${SKIP_INSTALLER_CURL:-0}" != "1" && -n "$INSTALLER_TAG" ]]; then
    DL_DIR="$SITE_ROOT/s4-website/public/downloads"
    BASE="https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases/download/${INSTALLER_TAG}"
    echo "==> Syncing installers from GitHub Release ${INSTALLER_TAG}"
    mkdir -p "$DL_DIR"
    curl -fsSL -o "$DL_DIR/S4-Family-Finance-143.apk" "$BASE/S4-Family-Finance-143.apk"
    curl -fsSL -o "$DL_DIR/S4-Family-Finance-143-Setup.exe" "$BASE/S4-Family-Finance-143-Setup.exe"
    ls -lh "$DL_DIR/S4-Family-Finance-143.apk" "$DL_DIR/S4-Family-Finance-143-Setup.exe"
  else
    echo "==> Skipping VPS installer curl (CI-synced or no tag)"
    ls -lh "$SITE_ROOT/s4-website/public/downloads/"*.{apk,exe} 2>/dev/null || true
  fi

  echo "==> Rebuilding marketing website (no-deps)"
  (
    cd "$SITE_ROOT"
    # Avoid touching broken/unrelated api if possible — rebuild website image only
    docker compose -f docker-compose.prod.yml build website
    docker compose -f docker-compose.prod.yml up -d --no-deps website
  )

  # Host nginx often serves /downloads/*.apk|exe from the bind-mounted public
  # folder and bypasses Next middleware. Keep binaries inside the image for
  # /api/secure-download, but remove host copies so hotlinks 404.
  echo "==> Removing host-public installer hotlinks (secure API keeps image copies)"
  rm -f "$SITE_ROOT/s4-website/public/downloads/"*.apk \
        "$SITE_ROOT/s4-website/public/downloads/"*.exe || true

  sleep 5
  curl -fsS -o /dev/null -w "website_http=%{http_code}\n" http://127.0.0.1:3000/downloads || true
  curl -fsS -o /dev/null -w "website_public=%{http_code}\n" https://www.s4businessthinking.com/downloads || true
fi

echo "==> AUTO-DEPLOY COMPLETE"
