# Alembic versions

Current head: `0022_clear_invite_raw_code_hint`

## Policy

- Production / staging: schema changes **only** via Alembic (`alembic upgrade head`).
- Do not rely on runtime `CREATE TABLE` / `ALTER TABLE` fallbacks in production.
- One linear chain; keep a single head (`alembic heads`).

## Verify

```bash
cd backend
alembic heads          # expect one revision
alembic current
alembic upgrade head
alembic history -v | head
```

## New migration

```bash
alembic revision -m "short_description"
# edit the new file under versions/
alembic upgrade head
```
