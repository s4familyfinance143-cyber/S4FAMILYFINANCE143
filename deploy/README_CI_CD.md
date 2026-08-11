# S4 CI/CD Pipeline

GitHub Actions workflow: `.github/workflows/ci.yml`

## Flow

```
git push / PR open
  → pytest (unit + integration)
  → ESLint
  → bandit
  → npm audit
  → frontend build + packaging validate
  → Docker build (+ push to GHCR on develop/main push)
  → auto deploy staging (develop)
  → manual approval → deploy production (main)
  → Sentry deployment marker (optional)
```

## Environments

| Environment | Branch | Deploy | URL |
|-------------|--------|--------|-----|
| Local (WSL) | any | `docker compose up` | http://localhost:8000 |
| Staging | `develop` | auto on push | https://staging.s4family.app |
| Production | `main` | manual approval in GitHub | https://app.s4family.app |

## GitHub repository setup

### Environments (Settings → Environments)

1. **staging** — no required reviewers (auto deploy)
2. **production** — add required reviewers for manual approval gate

### Secrets

| Secret | Used for |
|--------|----------|
| `STAGING_HOST` | Staging VPS/VM SSH host |
| `STAGING_USER` | SSH username |
| `STAGING_SSH_KEY` | Private key (PEM) |
| `STAGING_DEPLOY_PATH` | Optional repo path on server (default `/opt/s4-family-finance`) |
| `PRODUCTION_HOST` | Production VPS SSH host |
| `PRODUCTION_USER` | SSH username |
| `PRODUCTION_SSH_KEY` | Private key (PEM) |
| `PRODUCTION_DEPLOY_PATH` | Optional repo path on server |
| `SENTRY_AUTH_TOKEN` | Optional Sentry release marker |
| `GITHUB_TOKEN` | Auto-provided — used for GHCR push |

### Variables (optional)

| Variable | Example |
|----------|---------|
| `SENTRY_ORG` | your-sentry-org |
| `SENTRY_PROJECT` | s4-family-finance |

### Server preparation (staging + production)

On each VPS/VM:

1. Clone or extract this repo (e.g. `/opt/s4-family-finance`)
2. Copy env: `deploy/docker/.env.production.example` → `.env.production` and fill secrets
3. Set real URLs (`staging.s4family.app` / `app.s4family.app`) in `CORS_ORIGINS` and `APP_PUBLIC_URL`
4. Ensure Docker + Docker Compose v2 installed
5. For GHCR pull: server needs read access to package (public GHCR or `GHCR_TOKEN` on server)

First deploy can use local build:

```bash
bash deploy/scripts/vps_go_live_deploy.sh
```

CI deploys use pre-built images:

```bash
export S4_BACKEND_IMAGE=ghcr.io/OWNER/REPO/s4-backend:SHA
export S4_FRONTEND_IMAGE=ghcr.io/OWNER/REPO/s4-nginx:SHA
bash deploy/scripts/remote_ghcr_deploy.sh staging   # or production
```

| Quality gate | Command in CI |
|--------------|---------------|
| npm audit | `npm audit --audit-level=high` (fails on high+) |
| bandit | high severity only (`-lll`) |
| ESLint | `npm run lint` (0 errors) |
| pytest | unit + PostgreSQL integration |

## Operator-only (cannot live in git)

Fill once so deploy is fully live:

1. GitHub Environments: `staging` + `production` (production → Required reviewers)
2. Secrets: `STAGING_HOST/USER/SSH_KEY`, `PRODUCTION_HOST/USER/SSH_KEY`
3. VPS `.env.production` with real secrets (no `CHANGE_ME`)
4. DNS: `staging.s4family.app`, `app.s4family.app`
5. Optional Sentry: `SENTRY_AUTH_TOKEN` + vars `SENTRY_ORG` / `SENTRY_PROJECT`; `SENTRY_DSN` on server

GHCR login during CI deploy uses `GITHUB_TOKEN` automatically.

```bash
# Backend unit + bandit + packaging
bash backend/scripts/run_ci_checks.sh

# Frontend
cd frontend && npm ci && npm run lint && npm run audit:ci && npm run build

# Integration tests (requires local Postgres on :5432)
cd backend
export INTEGRATION_TESTS=true
export DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/s4_ci
python -m pytest -m integration
```

## Images (GHCR)

- `ghcr.io/<owner>/<repo>/s4-backend:<sha|branch|latest>`
- `ghcr.io/<owner>/<repo>/s4-nginx:<sha|branch|latest>`

`latest` tag is applied on `main` / `master` pushes only.
