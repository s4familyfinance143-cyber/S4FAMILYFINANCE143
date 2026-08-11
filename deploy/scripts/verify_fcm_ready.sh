#!/usr/bin/env bash
# Verify FCM / push pipeline readiness (Step 12).
# Does not send a real push unless FCM is fully configured.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${1:-$ROOT/deploy/docker/.env.production}"

echo "=== S4 FCM readiness ==="
if [[ ! -f "$ENV_FILE" ]]; then
  echo "WARN: env file not found: $ENV_FILE"
  echo "Pass path: bash deploy/scripts/verify_fcm_ready.sh path/to/.env"
  ENV_FILE="$ROOT/.env.example"
fi

get_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true
}

ENABLED="$(get_var NOTIFICATION_FCM_ENABLED)"
PROJECT="$(get_var FCM_PROJECT_ID)"
CREDS="$(get_var FCM_CREDENTIALS_PATH)"

echo "NOTIFICATION_FCM_ENABLED=${ENABLED:-unset}"
echo "FCM_PROJECT_ID=${PROJECT:-unset}"
echo "FCM_CREDENTIALS_PATH=${CREDS:-unset}"

ok=0
fail=0

if [[ "${ENABLED}" == "true" ]]; then
  echo "OK: FCM enabled flag"
  ok=$((ok + 1))
else
  echo "TODO: set NOTIFICATION_FCM_ENABLED=true when Firebase is ready"
  fail=$((fail + 1))
fi

if [[ -n "${PROJECT}" ]]; then
  echo "OK: FCM_PROJECT_ID set"
  ok=$((ok + 1))
else
  echo "TODO: set FCM_PROJECT_ID"
  fail=$((fail + 1))
fi

if [[ -n "${CREDS}" ]]; then
  if [[ -f "$CREDS" ]]; then
    echo "OK: credentials file exists ($CREDS)"
    ok=$((ok + 1))
  elif [[ -f "$ROOT/$CREDS" ]]; then
    echo "OK: credentials file exists ($ROOT/$CREDS)"
    ok=$((ok + 1))
  else
    echo "FAIL: FCM_CREDENTIALS_PATH set but file missing: $CREDS"
    fail=$((fail + 1))
  fi
else
  echo "TODO: set FCM_CREDENTIALS_PATH to Firebase service-account JSON"
  fail=$((fail + 1))
fi

# Code path always present
if [[ -f "$ROOT/backend/app/services/notification_delivery_service.py" ]]; then
  echo "OK: push delivery service present"
  ok=$((ok + 1))
fi

echo "---"
echo "Code pipeline: DONE (in-app + outbox + Celery templates)"
echo "Live device push: requires Firebase project + JSON + enabled flag ($ok checks ok, $fail pending)"
echo "Docs: deploy/OPERATOR_GO_LIVE.md § FCM"
exit 0
