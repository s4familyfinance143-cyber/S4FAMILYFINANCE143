import sqlite3
from pathlib import Path
from app.core.database import engine

def q(name):
    return '"' + name.replace('"', '""') + '"'

url = str(engine.url)
raw = url.replace("sqlite:///", "", 1)
db_path = Path(raw)
if not db_path.is_absolute():
    db_path = Path.cwd() / db_path
db_path = db_path.resolve()

print("ACTIVE_DB_URL:", url)
print("ACTIVE_DB_PATH:", db_path)
print("DB_EXISTS:", db_path.exists())
print("DB_SIZE_BYTES:", db_path.stat().st_size if db_path.exists() else 0)

conn = sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("\n=== SQLITE ===")
print("integrity_check:", cur.execute("PRAGMA integrity_check").fetchone()[0])
fk = cur.execute("PRAGMA foreign_key_check").fetchall()
print("foreign_key_check_count:", len(fk))

tables = [
    r["name"] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
]

print("\n=== ROW COUNTS ===")
for t in tables:
    c = cur.execute(f"SELECT COUNT(*) c FROM {q(t)}").fetchone()["c"]
    print(f"{t}: {c}")

print("\n=== DUPLICATES ===")
dup_total = 0
checks = [
    ("accounts", ["family_id", "name"]),
    ("categories", ["family_id", "name"]),
    ("family_members", ["family_id", "user_id"]),
    ("currencies", ["code"]),
    ("exchange_rates", ["from_currency", "to_currency", "rate_date"]),
]

for table, cols in checks:
    if table not in tables:
        continue
    tcols = [r["name"] for r in cur.execute(f"PRAGMA table_info({q(table)})")]
    if not all(c in tcols for c in cols):
        continue
    where = "WHERE deleted_at IS NULL" if "deleted_at" in tcols else ""
    group_cols = ", ".join(q(c) for c in cols)
    rows = cur.execute(f"""
        SELECT {group_cols}, COUNT(*) c
        FROM {q(table)}
        {where}
        GROUP BY {group_cols}
        HAVING COUNT(*) > 1
    """).fetchall()
    for r in rows:
        dup_total += r["c"]
        print("DUPLICATE:", table, dict(r))
print("duplicate_total:", dup_total)

print("\n=== NEGATIVE VALUES ===")
neg_total = 0
keywords = ("amount", "balance", "rate", "target", "current", "paid", "remaining", "opening")
for t in tables:
    tcols = [r["name"] for r in cur.execute(f"PRAGMA table_info({q(t)})")]
    for c in tcols:
        if any(k in c.lower() for k in keywords):
            try:
                n = cur.execute(f"SELECT COUNT(*) c FROM {q(t)} WHERE {q(c)} < 0").fetchone()["c"]
                if n:
                    neg_total += n
                    print(f"NEGATIVE: {t}.{c} = {n}")
            except Exception:
                pass
print("negative_total:", neg_total)

conn.close()
