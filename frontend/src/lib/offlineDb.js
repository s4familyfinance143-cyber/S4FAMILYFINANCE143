/** Minimal IndexedDB outbox for Offline-First web sync. */

const DB_NAME = "s4-offline-sync";
const DB_VERSION = 1;
const STORE = "outbox";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_family_status", ["familyId", "status"], { unique: false });
        store.createIndex("by_status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

function backoffMs(retryCount) {
  return Math.min(2000 * Math.pow(2, Math.max(0, retryCount || 0)), 60_000);
}

export async function enqueueOutboxChange(change) {
  const db = await openDb();
  const id =
    change.id ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const row = {
    id,
    familyId: String(change.familyId || ""),
    client_change_id: change.client_change_id || id,
    entity_type: change.entity_type,
    entity_id: change.entity_id || null,
    operation: String(change.operation || "UPSERT").toUpperCase(),
    payload: change.payload || {},
    status: "pending",
    retry_count: 0,
    next_retry_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    synced_at: null,
    last_error: null,
  };
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(row);
  await txDone(tx);
  db.close();
  return row;
}

export async function listPendingOutbox(familyId) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  const now = Date.now();
  return all.filter((row) => {
    if (row.status !== "pending") return false;
    if (familyId && row.familyId !== String(familyId)) return false;
    if (row.next_retry_at && new Date(row.next_retry_at).getTime() > now) return false;
    return true;
  });
}

export async function countPendingOutbox(familyId) {
  const rows = await listPendingOutbox(familyId);
  return rows.length;
}

export async function markOutboxSynced(ids) {
  if (!ids?.length) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const id of ids) {
    const existing = await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (existing) {
      existing.status = "done";
      existing.synced_at = new Date().toISOString();
      existing.updated_at = new Date().toISOString();
      existing.last_error = null;
      store.put(existing);
    }
  }
  await txDone(tx);
  db.close();
}

export async function markOutboxFailed(id, errorMessage) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) {
    const retry = Number(existing.retry_count || 0) + 1;
    existing.retry_count = retry;
    existing.last_error = String(errorMessage || "push failed");
    existing.updated_at = new Date().toISOString();
    existing.next_retry_at = new Date(Date.now() + backoffMs(retry)).toISOString();
    existing.status = retry >= 5 ? "failed" : "pending";
    store.put(existing);
  }
  await txDone(tx);
  db.close();
}

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}
