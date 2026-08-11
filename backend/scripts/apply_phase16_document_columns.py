import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parents[1] / "s4_family_finance_dev.db"
conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute("PRAGMA table_info(phase16_items)")
existing = {row[1] for row in cur.fetchall()}
cols = [
    ("file_name", "VARCHAR(255)"),
    ("file_path", "VARCHAR(500)"),
    ("file_mime", "VARCHAR(120)"),
    ("file_size", "INTEGER"),
    ("file_sha256", "VARCHAR(64)"),
    ("file_encrypted", "BOOLEAN DEFAULT 0"),
]
for name, ddl in cols:
    if name not in existing:
        cur.execute(f"ALTER TABLE phase16_items ADD COLUMN {name} {ddl}")
        print("ADDED", name)
    else:
        print("OK", name)
conn.commit()
conn.close()
print("DONE")
