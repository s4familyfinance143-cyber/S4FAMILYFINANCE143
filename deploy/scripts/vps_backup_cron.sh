#!/usr/bin/env bash
# Install a daily Postgres dump cron; optionally upload gzip to S3/MinIO when env is set.
# Safe: local dump always succeeds even if S3 upload is skipped/fails (logged, non-fatal).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/s4-family}"
COMPOSE_DIR="${COMPOSE_DIR:-$ROOT/deploy/docker}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env.production}"

mkdir -p "$BACKUP_DIR"

WRAPPER="$BACKUP_DIR/s4_daily_backup.sh"
cat >"$WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
STAMP=\$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/\$STAMP"
mkdir -p "\$OUT"
cd "$COMPOSE_DIR"

# Load S3_* from production env if present (does not fail if missing)
set -a
# shellcheck disable=SC1091
source <(grep -E '^(S3_|POSTGRES_|BACKUP_S3_)' "$ENV_FILE" 2>/dev/null | sed 's/\\r\$//' || true)
set +a

docker compose --env-file "$ENV_FILE" -f docker-compose.production.yml exec -T postgres \\
  pg_dump -U "\${POSTGRES_USER:-postgres}" "\${POSTGRES_DB:-s4_family_finance_production}" \\
  | gzip > "\$OUT/postgres.sql.gz"

echo "Local dump OK \$OUT/postgres.sql.gz"

# Optional S3/MinIO upload (architecture: daily dump to object storage)
UPLOAD_BUCKET="\${BACKUP_S3_BUCKET:-\${S3_BUCKET:-}}"
if [[ -n "\${S3_ENDPOINT_URL:-}" && -n "\$UPLOAD_BUCKET" && -n "\${S3_ACCESS_KEY:-}" && -n "\${S3_SECRET_KEY:-}" ]]; then
  KEY="backups/postgres/\$STAMP/postgres.sql.gz"
  if command -v aws >/dev/null 2>&1; then
    AWS_ACCESS_KEY_ID="\$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="\$S3_SECRET_KEY" \\
      aws --endpoint-url "\$S3_ENDPOINT_URL" s3 cp "\$OUT/postgres.sql.gz" "s3://\$UPLOAD_BUCKET/\$KEY" \\
      && echo "S3 upload OK s3://\$UPLOAD_BUCKET/\$KEY" \\
      || echo "WARN: S3 upload failed (local dump kept)"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "\$OUT/postgres.sql.gz" "\$UPLOAD_BUCKET" "\$KEY" <<'PY' \\
      || echo "WARN: S3 upload failed (local dump kept)"
import os, sys
path, bucket, key = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    import boto3
    from botocore.client import Config
except ImportError:
    print("WARN: boto3 not installed; skip S3 upload")
    raise SystemExit(0)
client = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT_URL"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["S3_SECRET_KEY"],
    config=Config(signature_version="s3v4"),
    region_name=os.environ.get("S3_REGION", "us-east-1"),
)
client.upload_file(path, bucket, key)
print(f"S3 upload OK s3://{bucket}/{key}")
PY
  else
    echo "WARN: neither aws nor python3 available for S3 upload"
  fi
else
  echo "S3 upload skipped (set S3_ENDPOINT_URL, S3_BUCKET/BACKUP_S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)"
fi

# Keep 14 days local
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "Backup OK \$OUT"
EOF
chmod +x "$WRAPPER"

CRON_LINE="15 2 * * * $WRAPPER >> $BACKUP_DIR/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v 's4_daily_backup.sh' || true; echo "$CRON_LINE") | crontab -

echo "Installed daily backup cron (02:15 UTC) → $BACKUP_DIR"
echo "S3 upload runs when S3_* (or BACKUP_S3_BUCKET) is set in $ENV_FILE"
echo "Test now: $WRAPPER"
