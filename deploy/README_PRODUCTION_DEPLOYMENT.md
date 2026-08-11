S4 FAMILY FINANCE 143 - PRODUCTION PACKAGING / DEPLOYMENT SETUP

## What is ready (packaging)
- `deploy/docker/docker-compose.production.yml` — postgres + redis + minio + backend + celery_worker + celery_beat + flower + nginx
- Root `docker-compose.yml` — WSL local full stack (hot-reload backend)
- See `deploy/README_DOCKER_STACK.md`
- `deploy/docker/Dockerfile.backend` / `Dockerfile.frontend`
- `deploy/docker/.env.production.example` — fill secrets, do not commit real values
- `deploy/nginx/s4_family_finance_nginx.conf` — docker network proxy to `backend:8000` (+ websocket)
- `deploy/nginx/s4_family_finance_nginx.ssl.example.conf` — host TLS example (Let's Encrypt)
- Windows local bats + Inno Setup installer scripts
- Local cutovers: `deploy/postgres`, `deploy/minio`

## Release kit (validate → package → stage → VPS → verify)

Operator spine: [`deploy/README_RELEASE_KIT.md`](README_RELEASE_KIT.md)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\run_release_kit_checklist.ps1
powershell -ExecutionPolicy Bypass -File deploy\scripts\package_release.ps1
```

On VPS (after secrets filled in `deploy/docker/.env.production`):

```bash
bash deploy/scripts/vps_go_live_deploy.sh
bash deploy/scripts/verify_live.sh https://your-domain.example
```

## Local VM / staging (no paid VPS required)

Practice remaining server work on Docker Desktop or a Ubuntu VM:

- Guide: [`deploy/README_LOCAL_VM_STAGING.md`](README_LOCAL_VM_STAGING.md)
- Checklist:

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL
powershell -ExecutionPolicy Bypass -File deploy\scripts\run_local_vm_staging_checklist.ps1
```

## Validate packaging (no VPS required)

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL
powershell -ExecutionPolicy Bypass -File deploy\scripts\validate_production_packaging.ps1
```

Linux / CI:
```bash
bash deploy/scripts/validate_production_packaging.sh
bash backend/scripts/run_ci_checks.sh
```

GitHub Actions: `.github/workflows/ci.yml` — full CI/CD (pytest, ESLint, bandit, npm audit, Docker GHCR, staging/prod deploy). See [`README_CI_CD.md`](README_CI_CD.md).

## Local Windows run
1. Backend: `deploy\windows\02_run_backend_local_sqlite.bat`
2. Frontend: `deploy\windows\04_run_frontend_preview.bat`
3. Open: http://127.0.0.1:4173 · API http://127.0.0.1:8000

## Docker production (VPS) checklist

Prefer the release kit scripts above. Manual equivalent:

1. **VPS** with Docker + Docker Compose, ports 80/443 open
2. **DNS** A/AAAA record → VPS IP (`your-domain.example`)
3. Copy env:
   ```powershell
   copy deploy\docker\.env.production.example deploy\docker\.env.production
   ```
4. Edit `.env.production`: strong `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `REDIS_PASSWORD`, `MINIO_*`, `CORS_ORIGINS`, `APP_PUBLIC_URL`
5. Optional: SMTP + FCM credential paths
6. Build/start: `bash deploy/scripts/vps_go_live_deploy.sh`  
   (or `docker compose --env-file .env.production -f docker-compose.production.yml up -d --build` from `deploy/docker`)
7. Verify: `bash deploy/scripts/verify_live.sh https://your-domain.example`
8. **TLS**: install certbot on host; use `deploy/nginx/s4_family_finance_nginx.ssl.example.conf` (or Caddy/Traefik). Compose frontend binds host `:80` — proxy 443→80 or remap publish port.
9. Point mobile `EXPO_PUBLIC_API_BASE_URL` to `https://your-domain.example`

## Postgres-only Windows mode
1. Copy `backend\.env.production.example` → `backend\.env.production`
2. Edit DATABASE_URL + JWT secrets
3. Run `deploy\windows\03_run_backend_postgres_production.bat`

## Important
- Do not ship `.venv`, `node_modules`, dev DB, or placeholder secrets
- Production must keep `AUTO_CREATE_TABLES=false` (Alembic only)
- Real domain + SSL + secrets are still **operator steps** — packaging cannot invent them
