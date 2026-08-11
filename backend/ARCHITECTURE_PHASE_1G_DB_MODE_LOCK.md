# S4 FAMILY FINANCE 143 — Architecture Phase 1G Lock Note

## Phase
Production .env + Safe DB Mode Lock

## Locked rules

1. Development default can use SQLite:
   - DATABASE_URL=sqlite:///./s4_family_finance_dev.db
   - AUTO_CREATE_TABLES=true allowed only outside production

2. Production must use PostgreSQL:
   - DATABASE_URL must start with postgresql
   - SQLite is blocked in production

3. Production table creation must use Alembic:
   - AUTO_CREATE_TABLES=false required in production
   - Base.metadata.create_all is not allowed for production PostgreSQL

4. Production JWT safety:
   - Default development JWT secret is blocked
   - Production JWT secret must be at least 32 characters

5. PostgreSQL password notes:
   - Special characters in DATABASE_URL password must be URL encoded
   - Example: @ becomes %40

## Related files

- app/core/config.py
- app/core/database.py
- app/main.py
- alembic/env.py
- .env.example
- .env.sqlite.development.example
- .env.postgresql.production.example
