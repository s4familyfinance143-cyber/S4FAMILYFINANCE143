/** IndexedDB blob queue: document uploads + cached report exports. */

const DB_NAME = "s4-offline-blobs";
const DB_VERSION = 1;
const UPLOADS = "uploads";
const EXPORTS = "exports";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(UPLOADS)) {
        const store = db.createObjectStore(UPLOADS, { keyPath: "id" });
        store.createIndex("by_family_status", ["familyId", "status"], { unique: false });
      }
      if (!db.objectStoreNames.contains(EXPORTS)) {
        db.createObjectStore(EXPORTS, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("tx failed"));
    tx.onabort = () => reject(tx.error || new Error("tx aborted"));
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

export async function queueDocumentUpload({ familyId, itemId, file }) {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `upload-${Date.now()}`;
  const base64 = await fileToBase64(file);
  const row = {
    id,
    familyId: String(familyId),
    itemId: String(itemId),
    fileName: file.name || "document.bin",
    mime: file.type || "application/octet-stream",
    size: file.size || 0,
    base64,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  const db = await openDb();
  const tx = db.transaction(UPLOADS, "readwrite");
  tx.objectStore(UPLOADS).put(row);
  await txDone(tx);
  db.close();
  return row;
}

export async function listPendingUploads(familyId) {
  const db = await openDb();
  const tx = db.transaction(UPLOADS, "readonly");
  const all = await new Promise((resolve, reject) => {
    const req = tx.objectStore(UPLOADS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return all.filter(
    (row) => row.status === "pending" && (!familyId || row.familyId === String(familyId))
  );
}

export async function markUploadDone(id, status = "synced") {
  const db = await openDb();
  const tx = db.transaction(UPLOADS, "readwrite");
  const store = tx.objectStore(UPLOADS);
  const existing = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) {
    existing.status = status;
    existing.updated_at = new Date().toISOString();
    // Drop base64 after sync to save space
    if (status === "synced") existing.base64 = null;
    store.put(existing);
  }
  await txDone(tx);
  db.close();
}

/**
 * Flush queued document uploads via multipart POST.
 * uploadFn(itemId, file) should throw on failure.
 */
export async function flushPendingUploads({ familyId, uploadFn }) {
  const pending = await listPendingUploads(familyId);
  let synced = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      if (!row.base64) {
        await markUploadDone(row.id, "failed");
        failed += 1;
        continue;
      }
      const blob = base64ToBlob(row.base64, row.mime);
      const file = new File([blob], row.fileName, { type: row.mime });
      await uploadFn(row.itemId, file);
      await markUploadDone(row.id, "synced");
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { synced, failed, total: pending.length };
}

export function exportCacheKey(familyId, type, format) {
  return `${familyId}::${type}::${format}`;
}

export async function cacheReportExport(familyId, type, format, blob) {
  const buffer = await blob.arrayBuffer();
  const key = exportCacheKey(familyId, type, format);
  const row = {
    key,
    familyId: String(familyId),
    type: String(type),
    format: String(format),
    mime: blob.type || "application/octet-stream",
    buffer,
    fileName: `s4_${type}_report.${format === "excel" ? "xlsx" : "pdf"}`,
    updated_at: new Date().toISOString(),
  };
  const db = await openDb();
  const tx = db.transaction(EXPORTS, "readwrite");
  tx.objectStore(EXPORTS).put(row);
  await txDone(tx);
  db.close();
  return row;
}

export async function getCachedReportExport(familyId, type, format) {
  const db = await openDb();
  const tx = db.transaction(EXPORTS, "readonly");
  const key = exportCacheKey(familyId, type, format);
  const row = await new Promise((resolve, reject) => {
    const req = tx.objectStore(EXPORTS).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  if (!row?.buffer) return null;
  return {
    ...row,
    blob: new Blob([row.buffer], { type: row.mime || "application/octet-stream" }),
  };
}

export { base64ToBlob, fileToBase64 };
