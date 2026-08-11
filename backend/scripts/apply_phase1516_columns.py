import sqlite3
from pathlib import Path

db_path = Path(__file__).resolve().parents[1] / "s4_family_finance_dev.db"
if not db_path.exists():
    db_path = Path(__file__).resolve().parents[2] / "s4_family_finance_dev.db"
print("DB:", db_path)
conn = sqlite3.connect(db_path)
cur = conn.cursor()


def ensure_columns(table, columns):
    cur.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cur.fetchall()}
    if not existing:
        print(f"SKIP missing table {table}")
        return
    for name, col_type in columns:
        if name not in existing:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")
            print(f"ADDED {table}.{name}")


phase15_cols = [
    ("member_id", "VARCHAR(36)"),
    ("sub_type", "VARCHAR(80)"),
    ("provider", "VARCHAR(200)"),
    ("secondary_date", "VARCHAR(30)"),
    ("secondary_amount", "NUMERIC(18,4)"),
]
phase16_cols = phase15_cols + [
    ("billing_cycle", "VARCHAR(20)"),
    ("payment_account_id", "VARCHAR(36)"),
]
ensure_columns("phase15_items", phase15_cols)
ensure_columns("phase16_items", phase16_cols)
conn.commit()
conn.close()
print("DONE")
