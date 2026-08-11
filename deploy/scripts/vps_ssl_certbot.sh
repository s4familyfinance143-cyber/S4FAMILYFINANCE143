#!/usr/bin/env bash
# Issue Let's Encrypt certs for app + grafana hostnames (host nginx or certbot standalone).
# Run on the VPS as root after DNS A records point here.
set -euo pipefail

DOMAIN_APP="${1:-app.s4family.app}"
DOMAIN_GRAFANA="${2:-grafana.s4family.app}"
EMAIL="${3:-admin@${DOMAIN_APP}}"

if ! command -v certbot >/dev/null 2>&1; then
  echo "Installing certbot..."
  apt-get update -y
  apt-get install -y certbot
fi

echo "Ensure ports 80/443 are free or proxied correctly before continuing."
echo "Domains: $DOMAIN_APP , $DOMAIN_GRAFANA"
echo "Email: $EMAIL"

certbot certonly --standalone \
  -d "$DOMAIN_APP" \
  -d "$DOMAIN_GRAFANA" \
  --agree-tos \
  -m "$EMAIL" \
  --non-interactive || {
    echo "Standalone failed — try nginx plugin after stack is up:"
    echo "  certbot --nginx -d $DOMAIN_APP -d $DOMAIN_GRAFANA -m $EMAIL --agree-tos"
    exit 1
  }

echo "Certs issued under /etc/letsencrypt/live/$DOMAIN_APP/"
echo "Wire nginx SSL using deploy/nginx/s4_family_finance_nginx.ssl.example.conf"
echo "Renewal dry-run: certbot renew --dry-run"
