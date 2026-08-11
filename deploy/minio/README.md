# Local MinIO cutover for S4 document vault

## Ports
- API: `http://127.0.0.1:9002` (mapped from container `:9000`)
- Console: `http://127.0.0.1:9003`
- User/pass: see `backend/.env.minio.local.cutover`

## Commands

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL\deploy\minio
docker compose up -d

cd S:\S4-FAMILY-FINANCE-143-FINAL\backend
.\.venv\Scripts\pip.exe install boto3
.\.venv\Scripts\python.exe scripts\object_storage_smoke.py
```

## Important
- Default document vault stays on **local encrypted disk** until S3_* is set in live `.env`.
- Production compose already includes MinIO (`deploy/docker/docker-compose.production.yml`).
- Do not commit real cloud secrets.
