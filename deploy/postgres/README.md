# PostgreSQL cutover (local real drill)

## What this is
Real PostgreSQL cutover tooling for S4 Family Finance 143.
It does **not** fake data. It brings up Postgres, runs Alembic, then dump/restore drills.

## Prerequisites
- Docker Desktop running
- Backend venv with `psycopg` + `alembic`

## Commands

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL\deploy\postgres
docker compose up -d

cd S:\S4-FAMILY-FINANCE-143-FINAL\backend
.\.venv\Scripts\python.exe scripts\postgres_cutover_smoke.py

# Side-by-side API on :8001 (Postgres) — keeps live sqlite :8000 untouched
.\scripts\start_postgres_api_sidebyside.ps1

# In another terminal, after :8001 is up:
.\.venv\Scripts\python.exe scripts\postgres_api_verify_smoke.py
```

## Live switch checklist (do NOT flip casually)

1. Confirm cutover smoke PASS + `:8001` health shows `database=postgresql`
2. Confirm `postgres_api_verify_smoke.py` PASS
3. Stop sqlite uvicorn on `:8000` only when ready
4. Point live `.env` at Postgres (`copy .env.postgresql.local.cutover .env`) **or** run side-by-side launcher as the new primary port
5. Update frontend/mobile `API_BASE` if port changes
6. Re-test login + family + one finance write
7. Keep a sqlite DB file backup before any production/VPS cutover

## Connection (cutover only)
- Host: `127.0.0.1`
- Port: `5433` (keeps Windows PostgreSQL `:5432` free)
- DB: `s4_family_finance`
- User/Pass: see `backend/.env.postgresql.local.cutover`

## Live switch (local)

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL\backend
powershell -ExecutionPolicy Bypass -File scripts\switch_live_api_to_postgres.ps1
```

This backs up sqlite + `.env`, points live `.env` at Postgres `:5433`, runs Alembic, restarts `:8000`.
It does **not** copy sqlite rows into Postgres. Rollback from `backend/storage/live_switch_backups/<stamp>/`.
