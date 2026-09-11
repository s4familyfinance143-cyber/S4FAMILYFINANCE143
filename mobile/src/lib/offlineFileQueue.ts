import { withMobileDb } from "./mobileDb";

type PendingUpload = {
  id: number;
  family_id: string;
  item_id: string;
  file_uri: string;
  file_name: string;
  mime_type: string;
  status: string;
};

async function ensureTables() {
  return withMobileDb(async (db) => {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS offline_file_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      file_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    )`);
    await db.execAsync(`CREATE TABLE IF NOT EXISTS offline_file_cache (
      key TEXT PRIMARY KEY NOT NULL,
      family_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      updated_at TEXT NOT NULL
    )`);
    return db;
  });
}

export async function queueMobileDocumentUpload(params: {
  familyId: string;
  itemId: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
}) {
  await ensureTables();
  const now = new Date().toISOString();
  await withMobileDb((db) =>
    db.runAsync(
      `INSERT INTO offline_file_uploads
      (family_id, item_id, file_uri, file_name, mime_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        params.familyId,
        params.itemId,
        params.fileUri,
        params.fileName,
        params.mimeType || "application/octet-stream",
        now,
        now,
      ]
    )
  );
}

export async function listPendingMobileUploads(familyId: string): Promise<PendingUpload[]> {
  await ensureTables();
  return withMobileDb((db) =>
    db.getAllAsync<PendingUpload>(
      `SELECT id, family_id, item_id, file_uri, file_name, mime_type, status
     FROM offline_file_uploads
     WHERE family_id = ? AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 20`,
      [familyId]
    )
  );
}

export async function markMobileUpload(id: number, status: "done" | "synced" | "failed", error?: string) {
  await ensureTables();
  const normalized = status === "synced" ? "done" : status;
  await withMobileDb((db) =>
    db.runAsync(
      `UPDATE offline_file_uploads
     SET status = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
      [normalized, error || null, new Date().toISOString(), id]
    )
  );
}

export async function flushMobileDocumentUploads(params: {
  familyId: string;
  apiBaseUrl: string;
  token: string;
  tunnelHeaders?: Record<string, string>;
}) {
  const rows = await listPendingMobileUploads(params.familyId);
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (String(row.item_id).startsWith("local-") || String(row.item_id).startsWith("web-p16-")) {
        continue;
      }
      const formData = new FormData();
      formData.append("family_id", params.familyId);
      formData.append("file", {
        uri: row.file_uri,
        name: row.file_name,
        type: row.mime_type || "application/octet-stream",
      } as any);
      const response = await fetch(`${params.apiBaseUrl}/api/v1/documents/${row.item_id}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.token}`,
          ...(params.tunnelHeaders || {}),
        },
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "upload failed");
      await markMobileUpload(row.id, "done");
      synced += 1;
    } catch (error) {
      failed += 1;
      await markMobileUpload(row.id, "failed", error instanceof Error ? error.message : "upload failed");
    }
  }
  return { synced, failed, total: rows.length };
}

export async function cacheMobileFile(params: {
  familyId: string;
  kind: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
}) {
  await ensureTables();
  const key = `${params.familyId}::${params.kind}`;
  await withMobileDb((db) =>
    db.runAsync(
      `INSERT OR REPLACE INTO offline_file_cache
      (key, family_id, kind, file_uri, file_name, mime_type, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        params.familyId,
        params.kind,
        params.fileUri,
        params.fileName,
        params.mimeType || "application/octet-stream",
        new Date().toISOString(),
      ]
    )
  );
}

export async function getCachedMobileFile(familyId: string, kind: string) {
  await ensureTables();
  const key = `${familyId}::${kind}`;
  return withMobileDb((db) =>
    db.getFirstAsync<{
      file_uri: string;
      file_name: string;
      mime_type: string;
    }>("SELECT file_uri, file_name, mime_type FROM offline_file_cache WHERE key = ? LIMIT 1", [key])
  );
}
