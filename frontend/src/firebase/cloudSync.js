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
import { ensureFamilyCloudShell, pullFamilyCloudSnapshot, pushFamilyCloudSnapshot } from "./familyCloud";

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
 * Push local IndexedDB snapshots to Firestore (user + shared family).
 */
export async function pushCloudSnapshot({ uid, familyId, deviceLabel = "web", email = null, displayName = null }) {
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

  // Shared family truth for multi-account members
  if (familyId) {
    try {
      await ensureFamilyCloudShell({
        familyId,
        uid,
        email,
        displayName,
        familyName: familyId,
        role: "OWNER",
      });
      await pushFamilyCloudSnapshot({ familyId, deviceLabel, ownerUid: uid });
    } catch {
      /* family shell may already exist with different owner role — still try snapshot */
      try {
        await pushFamilyCloudSnapshot({ familyId, deviceLabel, ownerUid: uid });
      } catch {
        /* ignore shared push failure; user snapshot already saved */
      }
    }
  }

  return {
    partCount: parts.length,
    rowCount: rows.length,
    bytes: jsonText.length,
    exportedAt: payload.exported_at,
  };
}

/**
 * Pull latest cloud snapshot into local IndexedDB.
 * Prefers shared family snapshot when family_id is known (multi-member truth).
 */
export async function pullCloudSnapshot(uid) {
  if (!uid) throw new Error("Firebase user required");

  let familyId = null;
  try {
    const profile = await getUserFamilyProfile(uid);
    familyId = profile?.family_id || null;
  } catch {
    /* ignore */
  }

  if (familyId) {
    try {
      const shared = await pullFamilyCloudSnapshot(familyId);
      if (shared.message !== "no_family_snapshot") {
        return shared;
      }
    } catch {
      /* fall through to user snapshot */
    }
  }

  const metaSnap = await getDoc(snapshotRef(uid));
  if (!metaSnap.exists()) {
    return { restored: 0, message: "no_cloud_snapshot" };
  }
  const meta = metaSnap.data() || {};
  if (!familyId && meta.family_id) {
    try {
      const shared = await pullFamilyCloudSnapshot(meta.family_id);
      if (shared.restored > 0) return shared;
    } catch {
      /* use personal */
    }
  }

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

export async function getUserFamilyProfile(uid) {
  if (!uid) return null;
  const db = getFirestoreDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return snap.data() || null;
}

export async function ensureUserProfile(uid, user) {
  if (!uid || !user) return;
  const db = getFirestoreDb();
  if (!db) return;
  const ref = doc(db, "users", uid);
  const payload = {
    email: user.email || null,
    display_name: user.displayName || null,
    last_seen_at: serverTimestamp(),
  };
  // Only write Auth photoURL when present — do not wipe Storage avatar uploads.
  if (user.photoURL) {
    payload.photo_url = user.photoURL;
  }
  await setDoc(ref, payload, { merge: true });
}

export async function getUserProfileDoc(uid) {
  if (!uid) return null;
  const db = getFirestoreDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
