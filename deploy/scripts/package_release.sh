#!/usr/bin/env bash
# Build a lean release tarball for VM/VPS transfer (no secrets, no venv/node_modules).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DIST="$ROOT/deploy/dist"
mkdir -p "$DIST"
OUT="$DIST/s4-family-finance-release-${STAMP}.tar.gz"

cd "$ROOT"
tar -czf "$OUT" \
  --exclude='backend/.venv' \
  --exclude='backend/.env' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  --exclude='mobile/node_modules' \
  --exclude='mobile/.expo' \
  --exclude='deploy/dist' \
  --exclude='deploy/docker/.env.production' \
  --exclude='.git' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache' \
  --exclude='*.db' \
  --exclude='*.sqlite' \
  --exclude='*.sqlite3' \
  backend \
  frontend \
  deploy \
  mobile \
  MAIN_ARCHITECTURE_PROGRESS_CHECK.md

SIZE_MB="$(du -m "$OUT" | awk '{print $1}')"
echo "PASS package_release"
echo "OUT  $OUT (${SIZE_MB} MB)"
echo "NOTE: Copy to VM/VPS, extract, then fill deploy/docker/.env.production from examples."
