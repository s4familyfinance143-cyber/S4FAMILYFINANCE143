import { exportAllOfflineSnapshots, importOfflineSnapshots } from "./offlineCache";

export function backupFileName(familyId = "family") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const short = String(familyId || "family").slice(0, 8);
  return `s4-backup-${short}-${stamp}.json`;
}

export async function buildBackupPayload(familyId, deviceLabel = "web") {
  const rows = await exportAllOfflineSnapshots();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    family_id: familyId || null,
    device: deviceLabel,
    rows,
  };
}

export async function buildBackupBlob(familyId, deviceLabel = "web") {
  const payload = await buildBackupPayload(familyId, deviceLabel);
  return {
    blob: new Blob([JSON.stringify(payload)], { type: "application/json" }),
    payload,
    fileName: backupFileName(familyId),
  };
}

export async function restoreBackupBlob(blob) {
  const text = await blob.text();
  const payload = JSON.parse(text);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const restored = await importOfflineSnapshots(rows);
  return {
    restored,
    exportedAt: payload.exported_at || null,
    familyId: payload.family_id || null,
    rowCount: rows.length,
  };
}
