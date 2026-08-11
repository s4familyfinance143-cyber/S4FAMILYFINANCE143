import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "s4_family_finance_dev.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()


def cols(table: str) -> set[str]:
    cur.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}


def add(table: str, name: str, ddl: str) -> None:
    existing = cols(table)
    if not existing:
        print(f"SKIP missing table {table}")
        return
    if name in existing:
        print(f"OK {table}.{name}")
        return
    cur.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
    print(f"ADDED {table}.{name}")


# 0005
add("grocery_items", "posted_transaction_id", "VARCHAR")
# 0006
add("grocery_lists", "mobile_sync_key", "VARCHAR(120)")
add("grocery_items", "mobile_sync_key", "VARCHAR(120)")
# 0007
add("grocery_lists", "sync_version", "INTEGER DEFAULT 1")
add("grocery_lists", "last_client_updated_at", "VARCHAR(40)")
add("grocery_items", "sync_version", "INTEGER DEFAULT 1")
add("grocery_items", "last_client_updated_at", "VARCHAR(40)")

conn.commit()
conn.close()
print("DONE", DB)
