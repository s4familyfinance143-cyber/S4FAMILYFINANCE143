/**
 * SQLite-backed offline cache — same API as web IndexedDB offlineCache.js
 * so cloudApiShim / backupPayload can run on mobile.
 */
import { withMobileDb } from "./mobileDb";

async function ensureSnapshotTable() {
  await withMobileDb(async (db) => {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS offline_snapshots (
      key TEXT PRIMARY KEY NOT NULL,
      family_id TEXT NOT NULL,
      module TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'default',
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_offline_snapshots_family_module ON offline_snapshots(family_id, module)`
    );
  });
}

export function cacheKey(familyId: string, module: string, name = "default") {
  return `${familyId}::${module}::${name || "default"}`;
}

export async function saveOfflineSnapshot(
  familyId: string,
  module: string,
  name: string,
  data: unknown
) {
  await ensureSnapshotTable();
  const key = cacheKey(familyId, module, name);
  const now = new Date().toISOString();
  const row = {
    key,
    familyId: String(familyId),
    module: String(module),
    name: String(name || "default"),
    data,
    updated_at: now,
  };
  await withMobileDb(async (d) => {
    await d.runAsync(
      `INSERT OR REPLACE INTO offline_snapshots (key, family_id, module, name, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, row.familyId, row.module, row.name, JSON.stringify(data ?? null), now]
    );
  });
  return row;
}

export async function loadOfflineSnapshot(familyId: string, module: string, name = "default") {
  await ensureSnapshotTable();
  const key = cacheKey(familyId, module, name);
  const row = await withMobileDb((d) =>
    d.getFirstAsync<{ payload: string; updated_at: string; name: string }>(
      "SELECT payload, updated_at, name FROM offline_snapshots WHERE key = ? LIMIT 1",
      [key]
    )
  );
  if (!row?.payload) return null;
  try {
    return {
      key,
      familyId: String(familyId),
      module: String(module),
      name: row.name || name || "default",
      data: JSON.parse(row.payload),
      updated_at: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function exportAllOfflineSnapshots(familyId: string | null = null) {
  await ensureSnapshotTable();
  const rows = await withMobileDb((d) =>
    familyId
      ? d.getAllAsync<{
          key: string;
          family_id: string;
          module: string;
          name: string;
          payload: string;
          updated_at: string;
        }>("SELECT * FROM offline_snapshots WHERE family_id = ?", [String(familyId)])
      : d.getAllAsync<{
          key: string;
          family_id: string;
          module: string;
          name: string;
          payload: string;
          updated_at: string;
        }>("SELECT * FROM offline_snapshots")
  );
  return (rows || []).map((r) => {
    let data = null;
    try {
      data = JSON.parse(r.payload);
    } catch {
      data = null;
    }
    return {
      key: r.key,
      familyId: r.family_id,
      module: r.module,
      name: r.name || "default",
      data,
      updated_at: r.updated_at,
    };
  });
}

export async function importOfflineSnapshots(rows: any[]) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  await ensureSnapshotTable();
  let count = 0;
  for (const row of rows) {
    const familyId = row.familyId || row.family_id;
    const module = row.module;
    const name = row.name || "default";
    if (!familyId || !module) continue;
    await saveOfflineSnapshot(familyId, module, name, row.data);
    count += 1;
  }
  return count;
}

/** No-ops / light stubs used by web hydrate paths — safe on mobile. */
export async function reconcileWalletBalancesForFamily(_familyId: string) {
  return { ok: true };
}

export async function reconcileSavingsFromLedgerForFamily(_familyId: string) {
  return { ok: true };
}
