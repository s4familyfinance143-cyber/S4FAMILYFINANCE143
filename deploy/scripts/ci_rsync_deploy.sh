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
SKIP_INSTALLER_CURL=0

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

  # Private-repo releases need auth — download on the Actions runner, then rsync.
  INSTALLER_TAG="${SYNC_INSTALLERS_TAG:-}"
  if [[ -z "$INSTALLER_TAG" && -f "$ROOT/deploy/release/CURRENT_INSTALLER_TAG" ]]; then
    INSTALLER_TAG="$(tr -d '[:space:]' < "$ROOT/deploy/release/CURRENT_INSTALLER_TAG")"
  fi
  if [[ -n "$INSTALLER_TAG" ]]; then
    echo "==> Fetching installers for $INSTALLER_TAG (authenticated) → VPS public/downloads"
    DL_TMP="$(mktemp -d)"
    INSTALLER_TAG="$INSTALLER_TAG" DL_TMP="$DL_TMP" GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}" python3 - <<'PY'
import json, os, urllib.request

tag = os.environ["INSTALLER_TAG"]
token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
out = os.environ["DL_TMP"]
wanted = {
    "S4-Family-Finance-143.apk",
    "S4-Family-Finance-143-Setup.exe",
}
headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "s4-ci-rsync-deploy",
}
if token:
    headers["Authorization"] = f"Bearer {token}"

req = urllib.request.Request(
    f"https://api.github.com/repos/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases/tags/{tag}",
    headers=headers,
)
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)

for asset in data.get("assets", []):
    name = asset.get("name")
    if name not in wanted:
        continue
    areq = urllib.request.Request(
        asset["url"],
        headers={
            "Accept": "application/octet-stream",
            "User-Agent": "s4-ci-rsync-deploy",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    dest = os.path.join(out, name)
    print(f"downloading {name} …")
    with urllib.request.urlopen(areq) as aresp, open(dest, "wb") as f:
        while True:
            chunk = aresp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    print(f"saved {dest} ({os.path.getsize(dest)} bytes)")

missing = wanted - set(os.listdir(out))
if missing:
    raise SystemExit(f"missing release assets: {sorted(missing)}")
PY
    ssh_cmd "mkdir -p '$SITE_REMOTE_PATH/s4-website/public/downloads' '$SITE_REMOTE_PATH/installer-binaries'"
    rsync_ssh \
      "$DL_TMP/S4-Family-Finance-143.apk" \
      "$DL_TMP/S4-Family-Finance-143-Setup.exe" \
      "${DEPLOY_USER}@${DEPLOY_HOST}:${SITE_REMOTE_PATH}/s4-website/public/downloads/"
    rsync_ssh \
      "$DL_TMP/S4-Family-Finance-143.apk" \
      "$DL_TMP/S4-Family-Finance-143-Setup.exe" \
      "${DEPLOY_USER}@${DEPLOY_HOST}:${SITE_REMOTE_PATH}/installer-binaries/"
    rm -rf "$DL_TMP"
    # Skip VPS-side GitHub curl (private repo → 404 without token).
    SKIP_INSTALLER_CURL=1
  fi
fi

echo "==> Upload auto-deploy script and run on VPS"
scp "${SSH_OPTS[@]}" \
  "$ROOT/deploy/scripts/vps_ci_auto_deploy.sh" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/vps_ci_auto_deploy.sh"

ssh_cmd "install -m 0755 /tmp/vps_ci_auto_deploy.sh '$APP_REMOTE_PATH/deploy/scripts/vps_ci_auto_deploy.sh' 2>/dev/null || true; \
  DEPLOY_APP='$DEPLOY_APP' DEPLOY_WEBSITE='$DEPLOY_WEBSITE' APP_ROOT='$APP_REMOTE_PATH' SITE_ROOT='$SITE_REMOTE_PATH' \
  SKIP_INSTALLER_CURL='${SKIP_INSTALLER_CURL:-0}' \
  bash /tmp/vps_ci_auto_deploy.sh"

echo "==> Remote sync+deploy finished"
