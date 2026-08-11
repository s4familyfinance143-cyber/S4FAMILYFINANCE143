S4 FAMILY FINANCE 143 - WINDOWS LOCAL RUN GUIDE

1. Backend local SQLite:
   deploy\windows\02_run_backend_local_sqlite.bat

2. Frontend preview:
   deploy\windows\04_run_frontend_preview.bat

3. PostgreSQL production mode:
   - Copy backend\.env.production.example to backend\.env.production
   - Edit DATABASE_URL and secret values
   - Run deploy\windows\03_run_backend_postgres_production.bat

Backend:
http://127.0.0.1:8000

Frontend preview:
http://127.0.0.1:4173
