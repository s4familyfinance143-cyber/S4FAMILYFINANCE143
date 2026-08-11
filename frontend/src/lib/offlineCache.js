/** Offline read-cache for life / zakat / reports (IndexedDB). */

const DB_NAME = "s4-offline-cache";
const DB_VERSION = 1;
const STORE = "snapshots";

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
        db.createObjectStore(STORE, { keyPath: "key" });
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

export function cacheKey(familyId, module, name = "default") {
  return `${familyId}::${module}::${name}`;
}

export async function saveOfflineSnapshot(familyId, module, name, data) {
  const db = await openDb();
  const key = cacheKey(familyId, module, name);
  const row = {
    key,
    familyId: String(familyId),
    module: String(module),
    name: String(name || "default"),
    data,
    updated_at: new Date().toISOString(),
  };
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(row);
  await txDone(tx);
  db.close();
  return row;
}

export async function loadOfflineSnapshot(familyId, module, name = "default") {
  const db = await openDb();
  const key = cacheKey(familyId, module, name);
  const tx = db.transaction(STORE, "readonly");
  const row = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return row;
}
