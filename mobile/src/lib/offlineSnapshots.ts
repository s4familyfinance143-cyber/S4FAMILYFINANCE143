import { withMobileDb } from "./mobileDb";

async function ensureSnapshotTable() {
  return withMobileDb(async (db) => {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS offline_snapshots (
      key TEXT PRIMARY KEY NOT NULL,
      family_id TEXT NOT NULL,
      module TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_offline_snapshots_family_module ON offline_snapshots(family_id, module)`
    );
    return db;
  });
}

export async function saveModuleSnapshot(familyId: string, module: string, payload: unknown) {
  const db = await ensureSnapshotTable();
  const key = `${familyId}::${module}`;
  const now = new Date().toISOString();
  await withMobileDb(async (d) => {
    await d.runAsync(
      `INSERT OR REPLACE INTO offline_snapshots (key, family_id, module, payload, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [key, familyId, module, JSON.stringify(payload ?? null), now]
    );
  });
  return db;
}

export async function loadModuleSnapshot<T = unknown>(familyId: string, module: string): Promise<T | null> {
  await ensureSnapshotTable();
  const key = `${familyId}::${module}`;
  const row = await withMobileDb((d) =>
    d.getFirstAsync<{ payload: string }>("SELECT payload FROM offline_snapshots WHERE key = ? LIMIT 1", [key])
  );
  if (!row?.payload) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}
