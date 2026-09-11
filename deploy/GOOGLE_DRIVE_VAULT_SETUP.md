# Google Drive document vault — operator setup (company SA)

**Product note:** End users who want backups in *their own* Drive should use
[`deploy/PER_USER_GOOGLE_DRIVE.md`](PER_USER_GOOGLE_DRIVE.md) (`VITE_GOOGLE_CLIENT_ID`).
This document is only for optional **company** service-account storage of encrypted vault blobs.

S4 Family Finance can store encrypted document-vault blobs in a **company Google Drive** (service account), so VPS disk stays light.

## 1) Google Cloud

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Enable APIs** → enable **Google Drive API**.
3. **IAM & Admin → Service Accounts** → Create service account (e.g. `s4-family-vault`).
4. Open the SA → **Keys → Add key → JSON** → download the JSON file.
5. Note the SA email: `...@....iam.gserviceaccount.com`.

## 2) Drive folder

1. In Google Drive (the company account that owns storage), create a folder e.g. `S4-Family-Finance-Vault`.
2. Open the folder → **Share** → add the service account email as **Editor**.
3. Copy the folder ID from the URL:
   `https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID`

## 3) Env on VPS

Place the JSON on the server (never commit it):

```bash
sudo mkdir -p /opt/s4-family-finance/secrets
sudo cp ~/gdrive-sa.json /opt/s4-family-finance/secrets/gdrive.json
sudo chmod 600 /opt/s4-family-finance/secrets/gdrive.json
```

In `deploy/docker/.env.production`:

```env
DOCUMENT_VAULT_BACKEND=gdrive
GDRIVE_SERVICE_ACCOUNT_JSON=/secrets/gdrive.json
GDRIVE_ROOT_FOLDER_ID=THIS_IS_THE_FOLDER_ID
# Optional hard cap note for ops (app already limits file size to 10MB each)
# GDRIVE_FAMILY_SOFT_CAP_MB=500
```

Compose mounts `../../secrets` (or `/opt/s4-family-finance/secrets`) at `/secrets` in the backend container.

Restart:

```bash
cd /opt/s4-family-finance
SHARED_HOST_NGINX=1 SLIM=1 bash deploy/scripts/vps_go_live_deploy.sh
# or:
cd deploy/docker && docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.host-nginx.yml \
  -f docker-compose.vps-shared-slim.yml up -d backend
```

## 4) Verify

```bash
curl -sS http://127.0.0.1:8000/api/v1/...   # vault status endpoint used by app
docker exec s4-family-finance-backend python -c "from app.services.document_vault_service import object_storage_status; print(object_storage_status())"
```

Expect `"backend": "gdrive"` and `"gdrive_configured": true`.

Upload a small PDF/image from the app Document Vault UI, then confirm a new file under `families/{family_id}/` in the shared Drive folder.

## 5) Storage limits

- Free Google accounts: **15 GB shared** across Gmail/Drive/Photos for that company account.
- Many families fill this quickly — upgrade with **Google One** or later move to S3/B2.
- App still encrypts blobs before upload; Drive only sees ciphertext `.bin` files.

## 6) Fallback

Set `DOCUMENT_VAULT_BACKEND=s3` (MinIO) or `local` if Drive credentials are missing. Never leave production pretending Drive works without a valid SA + folder share.
