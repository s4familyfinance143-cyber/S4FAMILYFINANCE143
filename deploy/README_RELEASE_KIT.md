# S4 FAMILY FINANCE 143 — Release Kit

One operator path from **validate → package → stage (VM) → VPS go-live → verify**.

Canonical env for Docker Compose: **`deploy/docker/.env.production`**  
(Windows-only Postgres bat still uses `backend/.env.production` — do not mix those paths.)

Domain, DNS, Let's Encrypt, real SMTP, and Firebase JSON remain **operator-owned**. This kit refuses placeholders; it does not invent secrets.

---

## Spine (do in order)

| Step | What | Command |
|------|------|---------|
| 1 | Validate packaging | `deploy/scripts/validate_production_packaging.ps1` (or `.sh`) |
| 2 | Package transfer archive | `deploy/scripts/package_release.ps1` (or `.sh`) |
| 3 | Stage on local VM | See [`README_LOCAL_VM_STAGING.md`](README_LOCAL_VM_STAGING.md) + Mailpit `--profile staging` |
| 4 | Fill production env on VPS | Copy `.env.production.example` → `.env.production` (no `CHANGE_ME`) |
| 5 | Go-live deploy | `bash deploy/scripts/vps_go_live_deploy.sh` (on VPS, from repo root) |
| 6 | Verify | `bash deploy/scripts/verify_live.sh https://your-domain` |
| 7 | TLS | Host nginx/Caddy using `deploy/nginx/s4_family_finance_nginx.ssl.example.conf` |

Quick checklist on Windows host:

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL
powershell -ExecutionPolicy Bypass -File deploy\scripts\run_release_kit_checklist.ps1
```

---

## 1) Validate (no VPS)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\validate_production_packaging.ps1
```

```bash
bash deploy/scripts/validate_production_packaging.sh
```

---

## 2) Package

Creates a lean archive (no `.venv`, `node_modules`, `.env*`, secrets):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\package_release.ps1
# → deploy/dist/s4-family-finance-release-YYYYMMDD-HHMMSS.tar.gz
```

```bash
bash deploy/scripts/package_release.sh
```

Copy the tarball to the VM or VPS, extract, then use the env examples under `deploy/docker/`.

---

## 3) Local VM staging

- Guide: [`README_LOCAL_VM_STAGING.md`](README_LOCAL_VM_STAGING.md)
- Env template: `deploy/docker/.env.staging.example` → `.env.production` on the VM
- Start with Mailpit:

```bash
cd deploy/docker
cp .env.staging.example .env.production   # edit passwords
docker compose --env-file .env.production -f docker-compose.production.yml --profile staging up -d --build
```

Host browser (NAT forward): http://127.0.0.1:8088 · Mailpit http://127.0.0.1:8025

---

## 4–5) VPS production go-live

On the VPS (Ubuntu + Docker Compose), from extracted project root:

```bash
cp deploy/docker/.env.production.example deploy/docker/.env.production
# Edit secrets: POSTGRES_PASSWORD, JWT_SECRET_KEY, REDIS_*, MINIO_*, CORS_ORIGINS, APP_PUBLIC_URL
# Optional: real SMTP_* and FCM_* — leave disabled until ready

bash deploy/scripts/vps_go_live_deploy.sh
```

Notes:
- Script uses **`deploy/docker/.env.production`** (not `backend/.env.production`).
- Does **not** enable `--profile staging` (no Mailpit on public VPS).
- Compose publishes frontend on host **`:80`**. For HTTPS, either:
  - put host TLS proxy on 443 and proxy to `127.0.0.1:80`, or
  - change compose frontend publish to `127.0.0.1:8080:80` then proxy to 8080.

---

## 6) Verify

```bash
# Health / frontend / API proxy only
bash deploy/scripts/verify_live.sh https://your-domain.example

# Optional login smoke (token never printed)
S4_VERIFY_EMAIL='owner@example.com' S4_VERIFY_PASSWORD='...' \
  bash deploy/scripts/verify_live.sh https://your-domain.example
```

Windows host against VM NAT:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\verify_live.ps1 -BaseUrl http://127.0.0.1:8088
```

---

## Env path rules

| Use case | Env file |
|----------|----------|
| Docker Compose (VM or VPS) | `deploy/docker/.env.production` |
| Staging template | `deploy/docker/.env.staging.example` |
| Windows bat Postgres-only | `backend/.env.production` |

Never commit filled `.env.production`. Never ship `CHANGE_ME` / `your-domain.example` to a public host.

---

## Operator-owned (kit stops here)

1. Public VPS + DNS A/AAAA  
2. Let's Encrypt / TLS  
3. Production SMTP provider  
4. Firebase service-account JSON for FCM  
5. Mobile `EXPO_PUBLIC_API_BASE_URL=https://your-domain`

Related: [`README_PRODUCTION_DEPLOYMENT.md`](README_PRODUCTION_DEPLOYMENT.md) · cutovers in `deploy/postgres` · `deploy/minio`
