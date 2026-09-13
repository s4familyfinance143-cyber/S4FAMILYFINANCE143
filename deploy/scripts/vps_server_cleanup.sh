#!/usr/bin/env bash
# Remove dev-only / duplicate files from the production VPS (safe — never touches secrets or DB volumes).
#
# Usage on VPS:
#   APP_ROOT=/opt/s4-family-finance SITE_ROOT=/opt/s4 bash deploy/scripts/vps_server_cleanup.sh
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/s4-family-finance}"
SITE_ROOT="${SITE_ROOT:-/opt/s4}"

echo "==> S4 server cleanup audit"
echo "    APP_ROOT=$APP_ROOT"
echo "    SITE_ROOT=$SITE_ROOT"

removed=0

remove_path() {
  local p="$1"
  if [[ -e "$p" ]]; then
    local size
    size="$(du -sh "$p" 2>/dev/null | awk '{print $1}' || echo "?")"
    echo "REMOVE: $p ($size)"
    rm -rf "$p"
    removed=$((removed + 1))
  fi
}

# Not used by production Docker (backend + frontend images only).
for rel in \
  mobile \
  desktop \
  backend/tests \
  backend/.pytest_cache \
  backend/.venv \
  backend/__pycache__ \
  deploy/dist \
  frontend/node_modules \
  frontend/dist \
  .git
do
  remove_path "$APP_ROOT/$rel"
done

# Stray dev databases / local artifacts (never production Postgres data).
find "$APP_ROOT" -maxdepth 4 -type f \( \
  -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.apk' -o -name '*.exe' \
\) ! -path '*/secrets/*' -print -delete 2>/dev/null || true

# Temp CI scripts on VPS.
rm -f /tmp/vps_ci_auto_deploy.sh /tmp/vps_server_cleanup.sh 2>/dev/null || true

# Marketing site host copy — runtime lives in Docker; drop heavy build caches on host.
for rel in s4-website/node_modules s4-website/.next; do
  remove_path "$SITE_ROOT/$rel"
done

# Public hotlink copies (secure download uses installer-binaries + container inject).
rm -f "$SITE_ROOT/s4-website/public/downloads/"*.apk \
      "$SITE_ROOT/s4-website/public/downloads/"*.exe 2>/dev/null || true

if command -v docker >/dev/null 2>&1; then
  echo "==> Docker prune (dangling images + old build cache)"
  docker image prune -f 2>/dev/null || true
  docker builder prune -f --keep-storage 2GB 2>/dev/null || docker builder prune -f 2>/dev/null || true
fi

echo "==> Cleanup done (removed $removed top-level paths)"
du -sh "$APP_ROOT" 2>/dev/null || true
du -sh "$SITE_ROOT" 2>/dev/null || true
