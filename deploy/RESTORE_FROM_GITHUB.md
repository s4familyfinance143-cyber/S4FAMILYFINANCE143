# Restore this project from GitHub (A→Z)

Private repo: https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143

## What is already on GitHub

- Full **backend**, **frontend**, **mobile**, **deploy** scripts/compose/nginx
- Env **templates** (`*.example`) with every production key name
- Docs: OTP/email, per-user Google Drive, optional company Drive vault, VPS go-live

## What is NOT on GitHub (on purpose)

Real secrets must stay off git:

| Item | Where it lives |
|------|----------------|
| `deploy/docker/.env.production` | VPS only |
| `secrets/gdrive.json` (company SA, optional) | VPS `/opt/s4-family-finance/secrets/` |
| Postgres/Redis/MinIO/JWT/SMTP passwords | VPS `.env.production` |
| Live DB data | VPS Postgres volume |

If these were committed, anyone with repo access could take over the app.

## Clone on a new PC

```bash
git clone https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143.git
cd S4FAMILYFINANCE143
```

Local frontend:

```bash
cp frontend/.env.example frontend/.env
# set VITE_GOOGLE_CLIENT_ID if needed
cd frontend && npm ci && npm run dev
```

## Rebuild production on VPS

1. Copy code to `/opt/s4-family-finance` (git pull or rsync).
2. Recreate env from template:

```bash
cp deploy/docker/.env.production.example deploy/docker/.env.production
# edit: fill every CHANGE_ME_* and real Brevo/SMTP/DB passwords
```

3. Mount secrets if used: `secrets/gdrive.json`
4. Start stack:

```bash
cd deploy/docker
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f docker-compose.host-nginx.yml \
  -f docker-compose.vps-shared-slim.yml \
  up -d --build
```

5. Run DB migrations if needed (`alembic upgrade head` inside backend container).

## Checklist after USB delete

- [ ] GitHub repo private + you can log in
- [ ] VPS still running (`https://app.s4businessthinking.com`)
- [ ] You know Brevo SMTP login + password (or can reset in Brevo)
- [ ] You know Google OAuth Web client ID (already in examples)
- [ ] You know VPS root/SSH access

Code A→Z is on GitHub. Live passwords stay on the VPS — copy them from there if you rebuild elsewhere.
