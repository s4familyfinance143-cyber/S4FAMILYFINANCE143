import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parents[1] / "s4_family_finance_dev.db"
conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute("DELETE FROM sync_conflicts WHERE entity_id = ?", ("demo-item-1",))
print("deleted_demo_conflicts", cur.rowcount)
cur.execute("DELETE FROM sync_conflicts WHERE entity_type = ? AND id LIKE ?", ("GROCERY_ITEM", "%"))
# Only remove clearly seeded demo rows by payload marker if any remain
cur.execute(
    "DELETE FROM sync_conflicts WHERE local_payload LIKE ? OR remote_payload LIKE ?",
    ('%"Local Rice"%', '%"Server Rice"%'),
)
print("deleted_payload_demos", cur.rowcount)
conn.commit()
conn.close()
print("OK")
