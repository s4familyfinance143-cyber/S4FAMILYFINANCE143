const HANDLE_KEY = "s4_local_backup_dir";
const NAME_KEY = "s4_local_backup_dir_name";

export function isLocalFolderBackupSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

async function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("s4-backup-handles", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("handles")) {
        req.result.createObjectStore("handles");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandle(handle) {
  const db = await openHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  try {
    localStorage.setItem(NAME_KEY, handle.name || "Backup folder");
  } catch {
    /* ignore */
  }
}

export async function loadDirectoryHandle() {
  const db = await openHandleDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle || null;
}

export function getStoredFolderLabel() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

export async function pickBackupFolder() {
  if (!isLocalFolderBackupSupported()) {
    throw new Error("Folder picker not supported in this browser");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveDirectoryHandle(handle);
  return handle;
}

async function verifyPermission(handle, write = true) {
  const opts = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export async function writeBackupToFolder(blob, fileName) {
  let handle = await loadDirectoryHandle();
  if (!handle) {
    handle = await pickBackupFolder();
  }
  const ok = await verifyPermission(handle, true);
  if (!ok) throw new Error("Folder permission denied");
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { folder: handle.name, fileName };
}

export async function readLatestBackupFromFolder() {
  const handle = await loadDirectoryHandle();
  if (!handle) throw new Error("No backup folder selected");
  const ok = await verifyPermission(handle, false);
  if (!ok) throw new Error("Folder permission denied");

  const backups = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && entry.name.startsWith("s4-backup-") && entry.name.endsWith(".json")) {
      backups.push(entry);
    }
  }
  if (!backups.length) throw new Error("No backup files in folder");
  backups.sort((a, b) => (a.name < b.name ? 1 : -1));
  const latest = backups[0];
  const file = await latest.getFile();
  return { blob: file, fileName: latest.name, folder: handle.name };
}

export async function downloadBackupFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
