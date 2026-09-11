# Per-user Google Drive backup (recommended)

Each user stores **their own** family-finance backup JSON in **their Google Drive**.  
This is **not** the company service-account vault (`deploy/GOOGLE_DRIVE_VAULT_SETUP.md`).

## How it works

1. User clicks **Connect Google Drive** (Settings → Cloud, or first-login onboarding).
2. Google OAuth grants `drive.file` (only files this app creates).
3. App uploads `s4-backup-*.json` to that user’s Drive.
4. Same Google account on another device: **Connect** → empty device auto-restores latest backup; if local data exists, user confirms overwrite.

## Operator setup (OAuth Web client)

1. [Google Cloud Console](https://console.cloud.google.com/) → select project (e.g. Firebase `s4-family-finance` or your Drive project).
2. Enable **Google Drive API**.
3. **OAuth consent screen** — add scope `https://www.googleapis.com/auth/drive.file`. While in Testing, add test users.
4. **Credentials → Create OAuth client ID → Web application**:
   - Authorized JavaScript origins:
     - `https://app.s4businessthinking.com`
     - `http://localhost:5173`
     - `http://127.0.0.1:5173`
   - Redirect URIs: leave empty (GIS token popup).
5. Copy Client ID into env (never commit secrets beyond the public client id):

```env
# frontend/.env (local)
VITE_GOOGLE_CLIENT_ID=YOUR_ID.apps.googleusercontent.com

# deploy/docker/.env.production (VPS build arg)
VITE_GOOGLE_CLIENT_ID=YOUR_ID.apps.googleusercontent.com
```

6. Rebuild frontend so Vite bakes the ID into the bundle:

```bash
cd /opt/s4-family-finance/deploy/docker
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f docker-compose.host-nginx.yml \
  -f docker-compose.vps-shared-slim.yml \
  build frontend
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f docker-compose.host-nginx.yml \
  -f docker-compose.vps-shared-slim.yml \
  up -d frontend
```

## Vs company Drive vault

| | Per-user Drive (this doc) | Company SA vault |
|--|--|--|
| Who owns files | Each user’s Google account | Company Shared Drive folder |
| Auth | OAuth Web client (`VITE_GOOGLE_CLIENT_ID`) | Service account JSON |
| What is stored | App backup JSON | Encrypted document-vault blobs |
| Env | Frontend build | `DOCUMENT_VAULT_BACKEND=gdrive` |

Product default for “my data in my Drive” is **this** flow. Keep MinIO/`s3` for server document vault unless you explicitly enable company SA.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Drive not configured” | Missing `VITE_GOOGLE_CLIENT_ID` in the **built** frontend |
| `origin_mismatch` | Add exact origin (incl. `https://app.s4businessthinking.com`) |
| `access_denied` | Add user as OAuth test user; allow popups |
| Token gone after refresh | Expected (sessionStorage) — Connect Drive again |
