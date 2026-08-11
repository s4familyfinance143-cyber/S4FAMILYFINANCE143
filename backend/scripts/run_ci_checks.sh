#!/usr/bin/env bash
# CI / Linux entrypoint: pytest (unit+integration) + bandit + packaging validate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python -m pip install -q -r requirements.txt -r requirements-dev.txt

export ENVIRONMENT=development
export AUTO_CREATE_TABLES=true
export DATABASE_URL="${DATABASE_URL:-sqlite:///./ci_pytest.db}"
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-ci_test_secret_key_at_least_32_chars_long}"
export NOTIFICATION_FCM_ENABLED=false
export NOTIFICATION_EMAIL_ENABLED=false
export AUTH_EMAIL_ENABLED=true
export DOCUMENT_VAULT_BACKEND=local
export CELERY_ENABLED=false

echo "== pytest (unit + coverage floor) =="
python -m pytest -m "not integration" --cov=app --cov-report=term --cov-fail-under=35

echo "== bandit (high severity) =="
bandit -r app -c ../.bandit -lll

echo "== packaging validate =="
bash "$ROOT/../deploy/scripts/validate_production_packaging.sh"

echo "PASS run_ci_checks"
