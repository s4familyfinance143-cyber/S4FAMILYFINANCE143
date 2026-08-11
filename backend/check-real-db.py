from sqlalchemy import text
from app.core.database import engine

with engine.connect() as c:
    print("DB URL:", engine.url)
    r = c.execute(text("PRAGMA table_info(audit_logs)")).fetchall()
    print([x[1] for x in r])
