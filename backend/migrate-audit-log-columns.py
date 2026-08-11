from sqlalchemy import text
from app.core.database import engine

with engine.begin() as conn:
    cols = conn.execute(text("PRAGMA table_info(audit_logs)")).fetchall()
    names = {c[1] for c in cols}

    if "user_agent" not in names:
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN user_agent VARCHAR(500)"))
        print("ADDED user_agent")
    else:
        print("user_agent already exists")

    if "ip_address" not in names:
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(100)"))
        print("ADDED ip_address")
    else:
        print("ip_address already exists")

    if "severity" not in names:
        conn.execute(text("ALTER TABLE audit_logs ADD COLUMN severity VARCHAR(30) DEFAULT 'INFO' NOT NULL"))
        print("ADDED severity")
    else:
        print("severity already exists")

print("AUDIT DB MIGRATION OK")
