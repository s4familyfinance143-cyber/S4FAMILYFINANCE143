# S4 Family Finance — Docker Infrastructure (100% architecture stack)
#
# WSL / local (root compose):
#   1. cp .env.example .env
#   2. docker compose up --build
#   3. docker exec s4_backend alembic upgrade head
#   4. http://localhost:8000/docs
#   5. Flower http://localhost:5555  |  MinIO http://localhost:9001
#
# VPS production:
#   cd deploy/docker
#   cp .env.production.example .env.production   # fill secrets
#   docker compose --env-file .env.production -f docker-compose.production.yml up -d --build

## Services (architecture)

| Service | Image | Port | Role | Volume |
|---------|-------|------|------|--------|
| postgres | postgres:16-alpine | 5432 | Main DB | postgres_data |
| redis | redis:7-alpine | 6379 | Cache + Celery broker | redis_data |
| backend | Custom Dockerfile | 8000 | FastAPI (--reload local) | ./backend (local) |
| celery_worker | Same as backend | — | Background tasks | ./backend (local) |
| celery_beat | Same as backend | — | Scheduled reminders | ./backend (local) |
| flower | mher/flower:2.0 | 5555 | Celery monitor UI | — |
| nginx | nginx:alpine / frontend image | 80/443 | Reverse proxy + SSL | ./nginx/conf |
| minio | minio/minio | 9000/9001 | Local S3 | minio_data |
