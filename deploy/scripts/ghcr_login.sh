#!/usr/bin/env bash
# One-time (or cron) GHCR login helper for staging/production VPS.
# Usage:
#   export GHCR_USERNAME=your-github-username
#   export GHCR_TOKEN=ghp_xxx_or_fine_grained_read_packages
#   bash deploy/scripts/ghcr_login.sh
set -euo pipefail

if [[ -z "${GHCR_USERNAME:-}" || -z "${GHCR_TOKEN:-}" ]]; then
  echo "ERROR: Set GHCR_USERNAME and GHCR_TOKEN"
  echo "Token needs: read:packages (and write:packages if pushing from this host)"
  exit 1
fi

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
echo "PASS ghcr_login — credentials stored in Docker config"
