#!/usr/bin/env bash
# Install a daily Postgres + volume backup cron on the VPS.
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
docker compose --env-file "$ENV_FILE" -f docker-compose.production.yml exec -T postgres \\
  pg_dump -U "\${POSTGRES_USER:-postgres}" "\${POSTGRES_DB:-s4_family_finance_production}" \\
  | gzip > "\$OUT/postgres.sql.gz"
# Keep 14 days
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "Backup OK \$OUT"
EOF
chmod +x "$WRAPPER"

CRON_LINE="15 2 * * * $WRAPPER >> $BACKUP_DIR/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v 's4_daily_backup.sh' || true; echo "$CRON_LINE") | crontab -

echo "Installed daily backup cron (02:15 UTC) → $BACKUP_DIR"
echo "Test now: $WRAPPER"
