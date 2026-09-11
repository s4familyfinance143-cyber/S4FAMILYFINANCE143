# Auto-deploy (production VPS)

Push to `main` / `master` runs [`.github/workflows/auto-deploy-vps.yml`](../.github/workflows/auto-deploy-vps.yml):

1. Rsync this repo → `/opt/s4-family-finance` (keeps `.env.production` + `secrets/`)
2. Rebuild Family Finance with `SHARED_HOST_NGINX=1 SLIM=1`
3. Rsync `sales-website/` → `/opt/s4/s4-website` (keeps `.env.local`)
4. Rebuild marketing website container

## What updates automatically

| Change in git | Live after push |
|---------------|-----------------|
| `frontend/` / `backend/` / app docker | https://app.s4businessthinking.com |
| `sales-website/` | https://www.s4businessthinking.com |
| APK/EXE under `sales-website/public/downloads/` | `/downloads/...` on www |

## What does NOT auto-update

- Already-installed Android APK / Windows EXE on user devices (they must download again)
- iPhone PWA (users reopen Safari / Home Screen app; hard refresh if needed)
- Server secret files (SMTP, JWT, `.env.production`, website `.env.local`)

## Required GitHub repo secrets

| Secret | Value |
|--------|--------|
| `PRODUCTION_HOST` | VPS IP |
| `PRODUCTION_USER` | `root` |
| `PRODUCTION_SSH_KEY` | private key (ed25519) whose public key is in VPS `authorized_keys` |
| `PRODUCTION_DEPLOY_PATH` | `/opt/s4-family-finance` |
| `PRODUCTION_SITE_PATH` | `/opt/s4` |

Manual run: GitHub → Actions → **Auto deploy VPS** → Run workflow.

## Local emergency deploy

```bash
export DEPLOY_HOST=YOUR_VPS_IP
export DEPLOY_USER=root
export DEPLOY_SSH_KEY_PATH=/path/to/key
bash deploy/scripts/ci_rsync_deploy.sh
```
