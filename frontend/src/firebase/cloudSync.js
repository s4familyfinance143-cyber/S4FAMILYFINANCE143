import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { buildBackupPayload, restoreBackupBlob } from "../lib/backupPayload";
import { getFirestoreDb } from "./config";

const SNAPSHOT_DOC_ID = "latest";
const MAX_PART_CHARS = 750_000;

function snapshotRef(uid) {
  const db = getFirestoreDb();
  if (!db) throw new Error("Firestore not available");
  return doc(db, "users", uid, "cloudSnapshots", SNAPSHOT_DOC_ID);
}

function partsCollection(uid) {
  const db = getFirestoreDb();
  if (!db) throw new Error("Firestore not available");
  return collection(db, "users", uid, "cloudSnapshots", SNAPSHOT_DOC_ID, "parts");
}

function chunkPayload(jsonText) {
  const parts = [];
  for (let i = 0; i < jsonText.length; i += MAX_PART_CHARS) {
    parts.push(jsonText.slice(i, i + MAX_PART_CHARS));
  }
  return parts.length ? parts : [""];
}

/**
 * Push local IndexedDB snapshots to Firestore (user-scoped, chunked).
 */
export async function pushCloudSnapshot({ uid, familyId, deviceLabel = "web" }) {
  if (!uid) throw new Error("Firebase user required");
  const payload = await buildBackupPayload(familyId, deviceLabel);
  const rows = payload.rows || [];
  const jsonText = JSON.stringify(payload);
  const parts = chunkPayload(jsonText);
  const db = getFirestoreDb();
  const metaRef = snapshotRef(uid);
  const batch = writeBatch(db);

  batch.set(metaRef, {
    updated_at: serverTimestamp(),
    exported_at: payload.exported_at,
    family_id: familyId || null,
    device: deviceLabel,
    part_count: parts.length,
    row_count: rows.length,
    bytes: jsonText.length,
  });

  const existingParts = await getDocs(partsCollection(uid));
  existingParts.forEach((snap) => {
    batch.delete(snap.ref);
  });

  parts.forEach((text, index) => {
    const partRef = doc(partsCollection(uid), String(index));
    batch.set(partRef, { index, data: text });
  });

  await batch.commit();
  return {
    partCount: parts.length,
    rowCount: rows.length,
    bytes: jsonText.length,
    exportedAt: payload.exported_at,
  };
}

/**
 * Pull latest cloud snapshot into local IndexedDB.
 */
export async function pullCloudSnapshot(uid) {
  if (!uid) throw new Error("Firebase user required");
  const metaSnap = await getDoc(snapshotRef(uid));
  if (!metaSnap.exists()) {
    return { restored: 0, message: "no_cloud_snapshot" };
  }
  const meta = metaSnap.data() || {};
  const partSnaps = await getDocs(partsCollection(uid));
  const ordered = partSnaps.docs
    .map((d) => d.data())
    .filter((row) => row && typeof row.data === "string")
    .sort((a, b) => Number(a.index) - Number(b.index));
  const jsonText = ordered.map((p) => p.data).join("");
  const result = await restoreBackupBlob(new Blob([jsonText], { type: "application/json" }));
  return {
    restored: result.restored,
    exportedAt: result.exportedAt || meta.exported_at || null,
    familyId: result.familyId || meta.family_id || null,
    rowCount: result.rowCount,
  };
}

export async function getCloudSnapshotMeta(uid) {
  if (!uid) return null;
  const metaSnap = await getDoc(snapshotRef(uid));
  if (!metaSnap.exists()) return null;
  const data = metaSnap.data() || {};
  return {
    exportedAt: data.exported_at || null,
    familyId: data.family_id || null,
    rowCount: data.row_count || 0,
    partCount: data.part_count || 0,
    bytes: data.bytes || 0,
    device: data.device || "",
  };
}

export async function ensureUserProfile(uid, user) {
  if (!uid || !user) return;
  const db = getFirestoreDb();
  if (!db) return;
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      email: user.email || null,
      display_name: user.displayName || null,
      photo_url: user.photoURL || null,
      last_seen_at: serverTimestamp(),
    },
    { merge: true },
  );
}
