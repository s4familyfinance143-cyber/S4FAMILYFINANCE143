#!/usr/bin/env bash
# Live verification after deploy. Does not print access tokens.
# Usage:
#   bash deploy/scripts/verify_live.sh https://your-domain.example
# Optional login smoke:
#   S4_VERIFY_EMAIL=... S4_VERIFY_PASSWORD=... bash deploy/scripts/verify_live.sh https://...
set -euo pipefail

BASE_URL="${1:-${S4_VERIFY_BASE_URL:-}}"
if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 https://your-domain.example"
  exit 1
fi
BASE_URL="${BASE_URL%/}"

FAILED=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=$((FAILED + 1)); }

echo "Base URL: $BASE_URL"

code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$BASE_URL/" || echo 000)"
if [[ "$code" == "200" || "$code" == "304" ]]; then
  pass "frontend HTTP $code"
else
  fail "frontend HTTP $code (expected 200/304)"
fi

health="$(curl -s --connect-timeout 10 --max-time 30 "$BASE_URL/api/health" || true)"
if echo "$health" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  pass "api /health"
  echo "      $health"
else
  fail "api /health ($health)"
fi

api_code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$BASE_URL/api/openapi.json" || echo 000)"
if [[ "$api_code" != "000" && "$api_code" != "000000" ]]; then
  pass "api proxy reachable HTTP $api_code"
elif echo "$health" | grep -q '"status"'; then
  pass "api proxy reachable (via /health)"
else
  fail "api proxy unreachable"
fi

if [[ -n "${S4_VERIFY_EMAIL:-}" && -n "${S4_VERIFY_PASSWORD:-}" ]]; then
  TOKEN="$(
    curl -s --connect-timeout 10 --max-time 30 \
      -X POST "$BASE_URL/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"${S4_VERIFY_EMAIL}\",\"password\":\"${S4_VERIFY_PASSWORD}\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token","") or "")' 2>/dev/null || true
  )"
  if [[ -n "$TOKEN" ]]; then
    pass "auth login (token not printed)"
    me_ok="$(
      curl -s --connect-timeout 10 --max-time 30 \
        "$BASE_URL/api/v1/auth/me" -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print("1" if d.get("email") else "0")' 2>/dev/null || echo 0
    )"
    if [[ "$me_ok" == "1" ]]; then
      pass "auth /me"
    else
      fail "auth /me"
    fi
    fam_ok="$(
      curl -s --connect-timeout 10 --max-time 30 \
        "$BASE_URL/api/v1/families" -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print("1" if isinstance(d,list) else "0")' 2>/dev/null || echo 0
    )"
    if [[ "$fam_ok" == "1" ]]; then
      pass "families list"
    else
      fail "families list"
    fi
  else
    fail "auth login (no access_token)"
  fi
else
  echo "SKIP  login smoke (set S4_VERIFY_EMAIL and S4_VERIFY_PASSWORD to enable)"
fi

# Optional local docker backup size check when running on the VPS host
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 's4-family-finance-postgres'; then
  PGUSER="$(docker exec s4-family-finance-postgres printenv POSTGRES_USER 2>/dev/null || echo postgres)"
  PGDB="$(docker exec s4-family-finance-postgres printenv POSTGRES_DB 2>/dev/null || echo s4_family_finance_production)"
  docker exec s4-family-finance-postgres \
    pg_dump -U "$PGUSER" -d "$PGDB" -Fc -f /tmp/s4_live_backup_check.backup >/dev/null 2>&1 || true
  docker cp s4-family-finance-postgres:/tmp/s4_live_backup_check.backup ./s4_live_backup_check.backup >/dev/null 2>&1 || true
  if [[ -f ./s4_live_backup_check.backup && -s ./s4_live_backup_check.backup ]]; then
    pass "postgres backup drill ($(wc -c < ./s4_live_backup_check.backup) bytes)"
    rm -f ./s4_live_backup_check.backup
  else
    echo "WARN  postgres backup drill skipped or empty (non-fatal)"
  fi
fi

if [[ "$FAILED" -gt 0 ]]; then
  echo "FAIL verify_live ($FAILED)"
  exit 1
fi
echo "PASS verify_live"
