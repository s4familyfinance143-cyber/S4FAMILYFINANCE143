# S4 Family Finance — Docker Infrastructure (100% architecture stack)
#
# WSL / local (root compose):
#   1. cp .env.example .env
#   2. docker compose up --build
#   3. docker exec s4_backend alembic upgrade head
#   4. http://localhost:8000/docs
#   5. Flower http://localhost:5555  |  MinIO http://localhost:9001
#   6. Monitoring (optional): see deploy/monitoring/README_MONITORING.md
#      docker compose -f docker-compose.yml -f deploy/monitoring/docker-compose.monitoring.yml up -d
#      Grafana http://localhost:3000 | Prometheus http://localhost:9090
#
# VPS production:
#   cd deploy/docker
#   cp .env.production.example .env.production   # fill secrets
#   docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
#   # + monitoring:
#   docker compose --env-file .env.production -f docker-compose.production.yml \
#     -f ../monitoring/docker-compose.monitoring.prod.yml up -d

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
| prometheus | prom/prometheus | 9090 | Metrics scrape (overlay) | prometheus_data |
| grafana | grafana/grafana | 3000 | Dashboards (overlay) | grafana_data |
| alertmanager | prom/alertmanager | 9093 | Alert routing (overlay) | alertmanager_data |
